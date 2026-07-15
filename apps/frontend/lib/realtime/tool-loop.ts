import type { EvidenceLog } from "@/lib/pedagogy/evidence-log";
import type { GatewayContext, GatewayEnvelope, ToolGateway } from "@/lib/tools/gateway";
import type {
  OperationArbiter,
  OperationAuthority,
  OperationLease,
} from "@/lib/operations/arbiter";
import {
  LATENCY_BUDGETS,
  type LatencyBudgetMonitor,
} from "@/lib/reliability/latency-budget";

type ToolLoopEvent = {
  type: string;
  response?: {
    id?: unknown;
    status?: unknown;
    output?: unknown;
  };
};

type ClientEvent =
  {
    type: "conversation.item.create";
    item: { type: "function_call_output"; call_id: string; output: string };
  };

type ToolLoopDependencies = {
  gateway: ToolGateway;
  getContext(turnId: string): GatewayContext | undefined;
  send(event: ClientEvent): boolean;
  onContinuation(): boolean;
  onFailure(): void;
  timeoutMs?: number;
  maxIterationsPerTurn?: number;
  evidenceLog?: EvidenceLog;
  operationArbiter?: OperationArbiter;
  latencyMonitor?: LatencyBudgetMonitor;
  now?: () => number;
};

export type ToolLoopResult = {
  responseId: string;
  callIds: string[];
  outputCount: number;
  continued: boolean;
};

export class RealtimeToolLoop {
  private readonly handledResponses = new Set<string>();
  private readonly iterations = new Map<string, number>();
  private epoch = 0;
  private readonly inFlightResponses = new Set<string>();
  private readonly abortControllers = new Map<string, Set<AbortController>>();
  private readonly timeoutMs: number;
  private readonly maxIterationsPerTurn: number;

  constructor(private readonly dependencies: ToolLoopDependencies) {
    this.timeoutMs = dependencies.timeoutMs ?? 2_000;
    this.maxIterationsPerTurn = dependencies.maxIterationsPerTurn ?? 3;
  }

  canHandle(event: ToolLoopEvent): boolean {
    return extractBatch(event) !== undefined;
  }

  async handle(event: ToolLoopEvent, turnId: string): Promise<ToolLoopResult | undefined> {
    const batch = extractBatch(event);
    if (!batch || this.handledResponses.has(batch.responseId)) return undefined;
    const now = this.dependencies.now ?? Date.now;
    const startedAt = now();
    this.handledResponses.add(batch.responseId);
    this.inFlightResponses.add(batch.responseId);
    let operation: OperationLease | undefined;
    try {
      const iteration = (this.iterations.get(turnId) ?? 0) + 1;
      this.iterations.set(turnId, iteration);
      const context = this.dependencies.getContext(turnId);
      const revision = context?.revision ?? 0;
      const authority = {
        epoch: context?.epoch ?? 0,
        revision,
      } satisfies Required<OperationAuthority>;
      operation = this.dependencies.operationArbiter?.begin({
        kind: "tool",
        ...authority,
      });
      if (operation && !operation.accepted) return undefined;
      if (iteration > this.maxIterationsPerTurn) {
        const outputCount = this.publishOutputs(
          batch.calls.map(({ callId }) => ({
            callId,
            envelope: budgetEnvelope(callId, revision),
          })),
          operation,
          authority,
        );
        this.dependencies.onFailure();
        return {
          responseId: batch.responseId,
          callIds: batch.calls.map(({ callId }) => callId),
          outputCount,
          continued: false,
        };
      }

      const epoch = this.epoch;
      const envelopes: Array<{ callId: string; envelope: GatewayEnvelope }> = [];
      let terminalFailure = false;
      for (const call of batch.calls) {
        const elapsedMs = Math.max(0, now() - startedAt);
        if (elapsedMs > LATENCY_BUDGETS.tool.limitMs) {
          terminalFailure = true;
          break;
        }
        this.logCall("tool_call", batch.responseId, call.callId, context, {
          outcome: context ? "accepted" : "rejected",
          reason: context ? "guard_pending" : "missing_context",
        });
        const controller = new AbortController();
        const stopForwarding = operation
          ? forwardAbort(operation.token.abort, controller)
          : () => undefined;
        this.trackController(batch.responseId, controller);
        const existingAuthority = context?.isAuthorityCurrent;
        const execution = context
          ? await withTimeout(
              this.dependencies.gateway.execute(call, {
                ...context,
                signal: controller.signal,
                isAuthorityCurrent: () =>
                  (existingAuthority?.() ?? true) &&
                  (operation
                    ? operation.commit(
                        "geogebra_mutation",
                        authority,
                        () => true,
                      ) === true
                    : true),
              }),
              Math.max(
                1,
                Math.min(
                  this.timeoutMs,
                  LATENCY_BUDGETS.tool.limitMs - elapsedMs,
                ),
              ),
              controller,
              timeoutEnvelope(call.callId, context.revision),
              executionFailureEnvelope(call.callId, context.revision),
            )
          : {
              envelope: executionFailureEnvelope(call.callId, revision),
              timedOut: false,
            };
        stopForwarding();
        this.untrackController(batch.responseId, controller);
        if (epoch !== this.epoch) return undefined;
        if (
          operation &&
          !operation.isCurrent("geogebra_mutation", authority)
        ) {
          return undefined;
        }
        const envelope = execution.envelope;
        envelopes.push({ callId: call.callId, envelope });
        terminalFailure ||=
          execution.timedOut ||
          !envelope.ok ||
          Math.max(0, now() - startedAt) > LATENCY_BUDGETS.tool.limitMs;
        this.logCall("tool_result", batch.responseId, call.callId, context, {
          evidenceIds: envelope.evidenceIds,
          outcome: envelope.ok ? "accepted" : "rejected",
          reason: envelope.ok ? "handler_completed" : envelope.error.code,
        });
        if (terminalFailure) break;
      }

      const outputCount = this.publishOutputs(envelopes, operation, authority);
      const allOutputsPublished = outputCount === envelopes.length;
      const continued =
        !terminalFailure &&
        allOutputsPublished &&
        (operation
          ? operation.commit(
              "realtime_emit",
              authority,
              this.dependencies.onContinuation,
            ) === true
          : this.dependencies.onContinuation());
      if (terminalFailure || !allOutputsPublished) this.dependencies.onFailure();
      return {
        responseId: batch.responseId,
        callIds: batch.calls.map(({ callId }) => callId),
        outputCount,
        continued,
      };
    } finally {
      this.dependencies.latencyMonitor?.record(
        "tool",
        Math.max(0, now() - startedAt),
      );
      operation?.finish();
      this.abortControllers.delete(batch.responseId);
      this.inFlightResponses.delete(batch.responseId);
    }
  }

  cancel(): void {
    this.epoch += 1;
    for (const controllers of this.abortControllers.values()) {
      for (const controller of controllers) controller.abort();
    }
  }

  hasInFlight(): boolean {
    return this.inFlightResponses.size > 0;
  }

  private publishOutputs(
    envelopes: Array<{ callId: string; envelope: GatewayEnvelope }>,
    operation?: OperationLease,
    authority?: OperationAuthority,
  ): number {
    let outputCount = 0;
    for (const { callId, envelope } of envelopes) {
      const publish = () =>
        this.dependencies.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(envelope),
          },
        });
      const published = operation
        ? operation.commit("tool_publish", authority, publish) === true
        : publish();
      if (published) {
        outputCount += 1;
      }
    }
    return outputCount;
  }

  private trackController(responseId: string, controller: AbortController): void {
    const controllers = this.abortControllers.get(responseId) ?? new Set();
    controllers.add(controller);
    this.abortControllers.set(responseId, controllers);
  }

  private untrackController(responseId: string, controller: AbortController): void {
    const controllers = this.abortControllers.get(responseId);
    controllers?.delete(controller);
    if (controllers?.size === 0) this.abortControllers.delete(responseId);
  }

  private logCall(
    eventType: "tool_call" | "tool_result",
    responseId: string,
    callId: string,
    context: GatewayContext | undefined,
    detail: {
      evidenceIds?: readonly string[];
      outcome: string;
      reason: string;
    },
  ): void {
    this.dependencies.evidenceLog?.append({
      revision: context?.revision ?? 0,
      ...(context?.directive?.sourceActionId
        ? { actionId: context.directive.sourceActionId }
        : {}),
      kind: "tool",
      correlationIds: {
        ...(context?.directive
          ? { directiveId: context.directive.directiveId }
          : {}),
        responseId,
        callId,
        ...(detail.evidenceIds?.length
          ? { evidenceIds: detail.evidenceIds }
          : context?.directive?.evidenceIds?.length
            ? { evidenceIds: context.directive.evidenceIds }
            : {}),
      },
      status:
        eventType === "tool_call"
          ? detail.outcome === "accepted"
            ? "started"
            : "rejected"
          : detail.outcome === "accepted"
            ? "completed"
            : "failed",
    });
  }
}

function extractBatch(event: ToolLoopEvent) {
  if (
    event.type !== "response.done" ||
    event.response?.status !== "completed" ||
    typeof event.response.id !== "string" ||
    !Array.isArray(event.response.output)
  ) {
    return undefined;
  }
  const calls = event.response.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    return value.type === "function_call" &&
      value.status === "completed" &&
      typeof value.call_id === "string" &&
      typeof value.name === "string" &&
      typeof value.arguments === "string"
      ? [{ callId: value.call_id, name: value.name, arguments: value.arguments }]
      : [];
  });
  return calls.length > 0 ? { responseId: event.response.id, calls } : undefined;
}

function timeoutEnvelope(callId: string, revision: number): GatewayEnvelope {
  return {
    ok: false,
    callId,
    revision,
    error: { code: "execution_failed", message: "Tool execution timed out safely." },
    evidenceIds: [],
  };
}

function executionFailureEnvelope(callId: string, revision: number): GatewayEnvelope {
  return {
    ok: false,
    callId,
    revision,
    error: { code: "execution_failed", message: "Tool execution failed safely." },
    evidenceIds: [],
  };
}

function budgetEnvelope(callId: string, revision: number): GatewayEnvelope {
  return {
    ok: false,
    callId,
    revision,
    error: { code: "budget_exceeded", message: "Tool iteration budget is exhausted." },
    evidenceIds: [],
  };
}

async function withTimeout(
  promise: Promise<GatewayEnvelope>,
  timeoutMs: number,
  controller: AbortController,
  timeoutFallback: GatewayEnvelope,
  failureFallback: GatewayEnvelope,
): Promise<{ envelope: GatewayEnvelope; timedOut: boolean }> {
  const timeoutToken = Symbol("tool-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const guarded = promise.catch(() => failureFallback);
    const first = await Promise.race([
      guarded,
      new Promise<typeof timeoutToken>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(timeoutToken);
        }, timeoutMs);
      }),
    ]);
    if (first !== timeoutToken) {
      return { envelope: first, timedOut: false };
    }
    // The guarded promise keeps its rejection handled, but a non-cooperative
    // handler cannot keep the operation pending after authority was revoked.
    return { envelope: timeoutFallback, timedOut: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function forwardAbort(
  source: AbortSignal,
  target: AbortController,
): () => void {
  if (source.aborted) {
    target.abort();
    return () => undefined;
  }
  const abort = () => target.abort();
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

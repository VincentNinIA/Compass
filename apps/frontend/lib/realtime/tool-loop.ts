import type { EvidenceLog } from "@/lib/pedagogy/evidence-log";
import type { GatewayContext, GatewayEnvelope, ToolGateway } from "@/lib/tools/gateway";

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
    this.handledResponses.add(batch.responseId);
    this.inFlightResponses.add(batch.responseId);
    try {
      const iteration = (this.iterations.get(turnId) ?? 0) + 1;
      this.iterations.set(turnId, iteration);
      const context = this.dependencies.getContext(turnId);
      const revision = context?.revision ?? 0;
      if (iteration > this.maxIterationsPerTurn) {
        const outputCount = this.publishOutputs(
          batch.calls.map(({ callId }) => ({
            callId,
            envelope: budgetEnvelope(callId, revision),
          })),
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
      for (const call of batch.calls) {
        this.logCall("tool_call", batch.responseId, call.callId, context, {
          outcome: context ? "accepted" : "rejected",
          reason: context ? "guard_pending" : "missing_context",
        });
        const envelope = context
          ? await withTimeout(
              this.dependencies.gateway
                .execute(call, context)
                .catch(() => executionFailureEnvelope(call.callId, context.revision)),
              this.timeoutMs,
              timeoutEnvelope(call.callId, context.revision),
            )
          : executionFailureEnvelope(call.callId, revision);
        if (epoch !== this.epoch) return undefined;
        envelopes.push({ callId: call.callId, envelope });
        this.logCall("tool_result", batch.responseId, call.callId, context, {
          evidenceIds: envelope.evidenceIds,
          outcome: envelope.ok ? "accepted" : "rejected",
          reason: envelope.ok ? "handler_completed" : envelope.error.code,
        });
      }

      const outputCount = this.publishOutputs(envelopes);
      const allOutputsPublished = outputCount === envelopes.length;
      const continued = allOutputsPublished && this.dependencies.onContinuation();
      if (!allOutputsPublished) this.dependencies.onFailure();
      return {
        responseId: batch.responseId,
        callIds: batch.calls.map(({ callId }) => callId),
        outputCount,
        continued,
      };
    } finally {
      this.inFlightResponses.delete(batch.responseId);
    }
  }

  cancel(): void {
    this.epoch += 1;
  }

  hasInFlight(): boolean {
    return this.inFlightResponses.size > 0;
  }

  private publishOutputs(
    envelopes: Array<{ callId: string; envelope: GatewayEnvelope }>,
  ): number {
    let outputCount = 0;
    for (const { callId, envelope } of envelopes) {
      if (
        this.dependencies.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(envelope),
          },
        })
      ) {
        outputCount += 1;
      }
    }
    return outputCount;
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
      eventType,
      epoch: context?.epoch ?? 0,
      revision: context?.revision ?? 0,
      ...(context?.directive?.sourceActionId
        ? { actionId: context.directive.sourceActionId }
        : {}),
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
      outcome: detail.outcome,
      reason: detail.reason,
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

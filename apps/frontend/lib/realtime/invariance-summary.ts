import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_POSITION_VERSION,
  INVARIANCE_SAMPLE_PARAMETERS,
  type InvarianceRunCompleted,
} from "@/lib/invariance/contracts";
import {
  guardInvarianceGeneralizationDirective,
  invarianceGeneralizationDirectiveSchema,
  type InvarianceGeneralizationDirective,
  type InvarianceVerbalizationContext,
} from "@/lib/invariance/verbalization";

export const INVARIANCE_SUMMARY_METADATA_KIND =
  "geotutor_invariance_summary_v1" as const;
export const INVARIANCE_SUMMARY_MAX_OUTPUT_TOKENS = 180 as const;

const SAFE_EVENT_ID = /^[A-Za-z0-9_.:-]{1,512}$/;
const MAX_SUMMARY_TEXT_LENGTH = 2_000;

const SUMMARY_INSTRUCTIONS = [
  "Write a concise two-sentence synthesis in English.",
  "Use only the five measurements in the custom input.",
  "State that the measurements support an equidistance conjecture, not a universal proof.",
  "Do not call tools, ask a question, or mention hidden context.",
].join(" ");

export type InvarianceSummaryMetadata = Readonly<{
  kind: typeof INVARIANCE_SUMMARY_METADATA_KIND;
  runId: string;
  revision: string;
}>;

export type InvarianceSummaryClientEvent = Readonly<{
  type: "response.create";
  event_id: string;
  response: Readonly<{
    conversation: "none";
    output_modalities: readonly ["text"];
    tools: readonly [];
    tool_choice: "none";
    max_output_tokens: typeof INVARIANCE_SUMMARY_MAX_OUTPUT_TOKENS;
    metadata: InvarianceSummaryMetadata;
    instructions: string;
    input: readonly [
      Readonly<{
        type: "message";
        role: "user";
        content: readonly [
          Readonly<{
            type: "input_text";
            text: string;
          }>,
        ];
      }>,
    ];
  }>;
}>;

export type InvarianceSummaryRender = Readonly<{
  runId: string;
  revision: number;
  eventId: string;
  responseId: string | null;
  source: "realtime" | "deterministic";
  text: string;
  reason:
    | "completed"
    | "stale_authority"
    | "send_failed"
    | "timeout"
    | "realtime_error"
    | "response_not_completed"
    | "empty_text"
    | "invalid_payload"
    | "transport_closed";
}>;

export type InvarianceSummaryOutcome =
  | Readonly<{
      status: "rendered" | "fallback" | "render_failed";
      render: InvarianceSummaryRender;
    }>
  | Readonly<{
      status: "ignored";
      reason: "duplicate" | "invalid_request" | "cancelled";
      runId: string;
      revision: number;
    }>;

type PendingSummary = {
  key: string;
  eventId: string;
  responseId?: string;
  result: InvarianceRunCompleted;
  directive: InvarianceGeneralizationDirective;
  fallbackText: string;
  resolve(outcome: InvarianceSummaryOutcome): void;
  timer?: ReturnType<typeof setTimeout>;
};

type SummaryServerEvent = Readonly<{
  type: string;
  response?: unknown;
  error?: unknown;
}>;

export class InvarianceOobSummaryCoordinator {
  private readonly pendingByEventId = new Map<string, PendingSummary>();
  private readonly eventIdByResponseId = new Map<string, string>();
  private readonly inFlightKeys = new Set<string>();
  private readonly terminalKeys = new Set<string>();
  private readonly timeoutMs: number;
  private sequence = 0;

  constructor(
    private readonly dependencies: Readonly<{
      send(event: InvarianceSummaryClientEvent): boolean;
      getCurrentContext(): InvarianceVerbalizationContext;
      renderSummary(summary: InvarianceSummaryRender): void | Promise<void>;
      createEventId?(): string;
      timeoutMs?: number;
    }>,
  ) {
    this.timeoutMs = dependencies.timeoutMs ?? 8_000;
  }

  request(
    result: InvarianceRunCompleted,
    directive: InvarianceGeneralizationDirective,
  ): Promise<InvarianceSummaryOutcome> {
    if (!validSummaryRequest(result, directive)) {
      return Promise.resolve(
        ignoredOutcome("invalid_request", result.runId, result.revision),
      );
    }

    const key = summaryKey(result);
    if (this.inFlightKeys.has(key) || this.terminalKeys.has(key)) {
      return Promise.resolve(
        ignoredOutcome("duplicate", result.runId, result.revision),
      );
    }

    const eventId = this.createEventId();
    if (!eventId) {
      return Promise.resolve(
        ignoredOutcome("invalid_request", result.runId, result.revision),
      );
    }

    const fallbackText = createDeterministicInvarianceSummary(result);
    let resolveOutcome!: (outcome: InvarianceSummaryOutcome) => void;
    const outcome = new Promise<InvarianceSummaryOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    const pending: PendingSummary = {
      key,
      eventId,
      result,
      directive,
      fallbackText,
      resolve: resolveOutcome,
    };
    this.inFlightKeys.add(key);
    this.pendingByEventId.set(eventId, pending);

    if (!this.isAuthorityCurrent(pending)) {
      void this.finishWithFallback(pending, "stale_authority");
      return outcome;
    }

    const event = createSummaryEvent(eventId, result);
    let sent = false;
    try {
      sent = this.dependencies.send(event);
    } catch {
      sent = false;
    }
    if (!sent) {
      void this.finishWithFallback(pending, "send_failed");
      return outcome;
    }

    pending.timer = setTimeout(() => {
      void this.finishWithFallback(pending, "timeout");
    }, this.timeoutMs);
    return outcome;
  }

  handle(event: unknown): boolean {
    if (!isRecord(event) || typeof event.type !== "string") return false;
    const serverEvent = event as SummaryServerEvent;
    if (serverEvent.type === "response.created") {
      return this.handleResponseCreated(serverEvent.response);
    }
    if (serverEvent.type === "response.done") {
      return this.handleResponseDone(serverEvent.response);
    }
    if (serverEvent.type === "error") {
      return this.handleError(serverEvent.error);
    }
    return false;
  }

  async close(): Promise<void> {
    const pending = [...this.pendingByEventId.values()];
    await Promise.all(
      pending.map((entry) =>
        this.finishWithFallback(entry, "transport_closed"),
      ),
    );
  }

  cancelPending(): readonly Readonly<{
    eventId: string;
    responseId: string | null;
  }>[] {
    const cancelled = [...this.pendingByEventId.values()].map((pending) => {
      this.detach(pending);
      pending.resolve(
        ignoredOutcome("cancelled", pending.result.runId, pending.result.revision),
      );
      return Object.freeze({
        eventId: pending.eventId,
        responseId: pending.responseId ?? null,
      });
    });
    return Object.freeze(cancelled);
  }

  private handleResponseCreated(responseValue: unknown): boolean {
    const response = asRecord(responseValue);
    const pending = this.findPending(response);
    if (!pending) return false;
    const responseId = readNonEmptyString(response?.id);
    if (!response || !metadataMatches(response.metadata, pending) || !responseId) {
      void this.finishWithFallback(pending, "invalid_payload");
      return true;
    }

    if (pending.responseId) {
      if (pending.responseId !== responseId) {
        void this.finishWithFallback(pending, "invalid_payload");
      }
      return true;
    }
    const existingEventId = this.eventIdByResponseId.get(responseId);
    if (existingEventId && existingEventId !== pending.eventId) {
      const existing = this.pendingByEventId.get(existingEventId);
      if (existing) void this.finishWithFallback(existing, "invalid_payload");
      void this.finishWithFallback(pending, "invalid_payload");
      return true;
    }

    pending.responseId = responseId;
    this.eventIdByResponseId.set(responseId, pending.eventId);
    return true;
  }

  private handleResponseDone(responseValue: unknown): boolean {
    const response = asRecord(responseValue);
    const responseId = readNonEmptyString(response?.id);
    const mappedEventId = responseId
      ? this.eventIdByResponseId.get(responseId)
      : undefined;
    const pending = mappedEventId
      ? this.pendingByEventId.get(mappedEventId)
      : this.findPending(response);
    if (!pending) return false;

    if (
      !response ||
      !responseId ||
      !metadataMatches(response.metadata, pending) ||
      (pending.responseId !== undefined && pending.responseId !== responseId)
    ) {
      void this.finishWithFallback(pending, "invalid_payload");
      return true;
    }
    if (!pending.responseId) {
      const existingEventId = this.eventIdByResponseId.get(responseId);
      if (existingEventId && existingEventId !== pending.eventId) {
        void this.finishWithFallback(pending, "invalid_payload");
        return true;
      }
      pending.responseId = responseId;
      this.eventIdByResponseId.set(responseId, pending.eventId);
    }
    if (response.status !== "completed") {
      void this.finishWithFallback(pending, "response_not_completed");
      return true;
    }

    const extracted = extractCompletedText(response);
    if (!extracted.ok) {
      void this.finishWithFallback(pending, extracted.reason);
      return true;
    }
    if (!this.isAuthorityCurrent(pending)) {
      void this.finishWithFallback(pending, "stale_authority");
      return true;
    }
    void this.finish(pending, {
      runId: pending.result.runId,
      revision: pending.result.revision,
      eventId: pending.eventId,
      responseId,
      source: "realtime",
      text: extracted.text,
      reason: "completed",
    });
    return true;
  }

  private handleError(errorValue: unknown): boolean {
    const error = asRecord(errorValue);
    const clientEventId = readNonEmptyString(error?.event_id);
    if (!clientEventId) return false;
    const pending = this.pendingByEventId.get(clientEventId);
    if (!pending) return false;
    void this.finishWithFallback(pending, "realtime_error");
    return true;
  }

  private findPending(
    response: Readonly<Record<string, unknown>> | null,
  ): PendingSummary | undefined {
    if (!response) return undefined;
    const responseId = readNonEmptyString(response.id);
    if (responseId) {
      const eventId = this.eventIdByResponseId.get(responseId);
      if (eventId) return this.pendingByEventId.get(eventId);
    }
    const metadata = asRecord(response.metadata);
    if (metadata?.kind !== INVARIANCE_SUMMARY_METADATA_KIND) return undefined;
    const runId = readNonEmptyString(metadata.runId);
    if (!runId) return undefined;
    return [...this.pendingByEventId.values()].find(
      (pending) => pending.result.runId === runId,
    );
  }

  private isAuthorityCurrent(pending: PendingSummary): boolean {
    try {
      return guardInvarianceGeneralizationDirective(
        this.dependencies.getCurrentContext(),
        pending.directive,
      ).ok;
    } catch {
      return false;
    }
  }

  private async finishWithFallback(
    pending: PendingSummary,
    reason: Exclude<InvarianceSummaryRender["reason"], "completed">,
  ): Promise<void> {
    await this.finish(pending, {
      runId: pending.result.runId,
      revision: pending.result.revision,
      eventId: pending.eventId,
      responseId: pending.responseId ?? null,
      source: "deterministic",
      text: pending.fallbackText,
      reason,
    });
  }

  private async finish(
    pending: PendingSummary,
    render: InvarianceSummaryRender,
  ): Promise<void> {
    if (this.pendingByEventId.get(pending.eventId) !== pending) return;
    this.detach(pending);

    try {
      await this.dependencies.renderSummary(Object.freeze(render));
      pending.resolve(
        Object.freeze({
          status: render.source === "realtime" ? "rendered" : "fallback",
          render: Object.freeze(render),
        }),
      );
    } catch {
      pending.resolve(
        Object.freeze({
          status: "render_failed",
          render: Object.freeze(render),
        }),
      );
    }
  }

  private detach(pending: PendingSummary): void {
    this.pendingByEventId.delete(pending.eventId);
    this.inFlightKeys.delete(pending.key);
    this.terminalKeys.add(pending.key);
    if (pending.responseId) {
      this.eventIdByResponseId.delete(pending.responseId);
    }
    if (pending.timer) clearTimeout(pending.timer);
  }

  private createEventId(): string | null {
    let eventId: string;
    try {
      eventId =
        this.dependencies.createEventId?.() ??
        `invariance-summary-${++this.sequence}`;
    } catch {
      return null;
    }
    if (
      !SAFE_EVENT_ID.test(eventId) ||
      this.pendingByEventId.has(eventId)
    ) {
      return null;
    }
    return eventId;
  }
}

export function createDeterministicInvarianceSummary(
  result: InvarianceRunCompleted,
): string {
  const measurements = result.samples
    .map(
      ({ parameter, pa, pb }) =>
        `p=${formatNumber(parameter)} (PA=${formatNumber(pa)}, PB=${formatNumber(pb)})`,
    )
    .join("; ");
  return `Observed 5/5 tested positions within tolerance ${formatNumber(INVARIANCE_DISTANCE_TOLERANCE)}: ${measurements}. These five measurements support the conjecture that points on the perpendicular bisector are equidistant from A and B; they are numerical evidence, not a universal proof.`;
}

function createSummaryEvent(
  eventId: string,
  result: InvarianceRunCompleted,
): InvarianceSummaryClientEvent {
  const input = {
    samples: result.samples.map(
      ({ index, parameter, pa, pb, delta, tolerance, id }) => ({
        index,
        parameter,
        pa,
        pb,
        delta,
        tolerance,
        evidenceId: id,
      }),
    ),
  };
  return Object.freeze({
    type: "response.create",
    event_id: eventId,
    response: Object.freeze({
      conversation: "none",
      output_modalities: Object.freeze(["text"] as const),
      tools: Object.freeze([]) as readonly [],
      tool_choice: "none",
      max_output_tokens: INVARIANCE_SUMMARY_MAX_OUTPUT_TOKENS,
      metadata: Object.freeze({
        kind: INVARIANCE_SUMMARY_METADATA_KIND,
        runId: result.runId,
        revision: String(result.revision),
      }),
      instructions: SUMMARY_INSTRUCTIONS,
      input: Object.freeze([
        Object.freeze({
          type: "message",
          role: "user",
          content: Object.freeze([
            Object.freeze({
              type: "input_text",
              text: JSON.stringify(input),
            }),
          ] as const),
        }),
      ] as const),
    }),
  });
}

function validSummaryRequest(
  result: InvarianceRunCompleted,
  directive: InvarianceGeneralizationDirective,
): boolean {
  if (!invarianceGeneralizationDirectiveSchema.safeParse(directive).success) {
    return false;
  }
  return (
    result.status === "completed" &&
    result.pass &&
    Number.isSafeInteger(result.revision) &&
    result.revision >= 0 &&
    result.runId === directive.sourceRunId &&
    result.revision === directive.baseRevision &&
    sameIds(result.inputEvidenceIds, directive.inputEvidenceIds) &&
    sameIds(result.evidenceIds, directive.evidenceIds) &&
    result.samples.length === 5 &&
    result.evidenceIds.length === 5 &&
    new Set(result.evidenceIds).size === 5 &&
    result.samples.every((sample, index) => {
      const expectedParameter = INVARIANCE_SAMPLE_PARAMETERS[index];
      return (
        sample.id === result.evidenceIds[index] &&
        sample.index === index &&
        Object.is(sample.parameter, expectedParameter) &&
        sample.revision === result.revision &&
        sample.coords.length === 2 &&
        sample.coords.every(Number.isFinite) &&
        Number.isFinite(sample.pa) &&
        sample.pa >= 0 &&
        Number.isFinite(sample.pb) &&
        sample.pb >= 0 &&
        Number.isFinite(sample.delta) &&
        sample.delta >= 0 &&
        Object.is(sample.delta, Math.abs(sample.pa - sample.pb)) &&
        Object.is(sample.tolerance, INVARIANCE_DISTANCE_TOLERANCE) &&
        sample.toleranceVersion === INVARIANCE_DISTANCE_TOLERANCE_VERSION &&
        sample.positionVersion === INVARIANCE_POSITION_VERSION &&
        sample.pass &&
        sample.delta <= sample.tolerance
      );
    })
  );
}

function extractCompletedText(
  response: Readonly<Record<string, unknown>>,
):
  | Readonly<{ ok: true; text: string }>
  | Readonly<{ ok: false; reason: "empty_text" | "invalid_payload" }> {
  if (
    response.conversation_id !== null ||
    !Array.isArray(response.output_modalities) ||
    response.output_modalities.length !== 1 ||
    response.output_modalities[0] !== "text" ||
    !Array.isArray(response.output) ||
    response.output.length === 0
  ) {
    return { ok: false, reason: "invalid_payload" };
  }

  const parts: string[] = [];
  for (const outputItem of response.output) {
    const item = asRecord(outputItem);
    if (
      !item ||
      item.type !== "message" ||
      item.role !== "assistant" ||
      item.status !== "completed" ||
      !Array.isArray(item.content) ||
      item.content.length === 0
    ) {
      return { ok: false, reason: "invalid_payload" };
    }
    for (const contentPart of item.content) {
      const part = asRecord(contentPart);
      if (!part || part.type !== "output_text" || typeof part.text !== "string") {
        return { ok: false, reason: "invalid_payload" };
      }
      parts.push(part.text);
    }
  }
  const text = parts.join("").trim();
  if (text.length === 0) return { ok: false, reason: "empty_text" };
  if (text.length > MAX_SUMMARY_TEXT_LENGTH) {
    return { ok: false, reason: "invalid_payload" };
  }
  return { ok: true, text };
}

function metadataMatches(
  value: unknown,
  pending: PendingSummary,
): boolean {
  const metadata = asRecord(value);
  return (
    metadata?.kind === INVARIANCE_SUMMARY_METADATA_KIND &&
    metadata.runId === pending.result.runId &&
    metadata.revision === String(pending.result.revision)
  );
}

function summaryKey(result: InvarianceRunCompleted): string {
  return `${result.runId}|${result.revision}|${result.evidenceIds.join("|")}`;
}

function ignoredOutcome(
  reason: "duplicate" | "invalid_request" | "cancelled",
  runId: string,
  revision: number,
): InvarianceSummaryOutcome {
  return Object.freeze({ status: "ignored", reason, runId, revision });
}

function formatNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  );
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

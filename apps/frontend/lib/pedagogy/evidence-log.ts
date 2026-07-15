export const CANCELLATION_REASONS = [
  "student_drag",
  "student_speech",
  "application_stop",
  "stale_revision",
  "reset",
  "response_error",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const EVIDENCE_LOG_VERSION = "geotutor_evidence_log.v1" as const;
export const DEFAULT_EVIDENCE_LOG_CAPACITY = 512;

export const EVIDENCE_LOG_KINDS = [
  "action",
  "evidence",
  "decision_silent",
  "decision_queue",
  "decision_speak",
  "directive",
  "response",
  "tool",
  "cancellation",
  "capability_live_voice",
  "capability_typed_live",
  "capability_scripted_local",
  "geogebra_mutation",
  "ui_commit",
  "realtime_emit",
  "tool_publish",
] as const;

export type EvidenceLogKind = (typeof EVIDENCE_LOG_KINDS)[number];

export const EVIDENCE_LOG_STATUSES = [
  "started",
  "queued",
  "accepted",
  "completed",
  "cancelled",
  "rejected",
  "failed",
  "blocked",
  "degraded",
  "coherent",
  "quarantined",
] as const;

export type EvidenceLogStatus = (typeof EVIDENCE_LOG_STATUSES)[number];

export type EvidenceCorrelationIds = Readonly<{
  operationId?: string;
  directiveId?: string;
  responseId?: string;
  callId?: string;
  evidenceIds?: readonly string[];
}>;

/**
 * The exported event is deliberately closed. It contains only correlation and
 * lifecycle metadata; free text, media, transport payloads and tool arguments
 * have no representable field.
 */
export type EvidenceLogEntry = Readonly<{
  timestamp: number;
  runId: string;
  actionId?: string;
  revision: number;
  kind: EvidenceLogKind;
  correlationIds: EvidenceCorrelationIds;
  status: EvidenceLogStatus;
  durationMs: number;
}>;

export type EvidenceLogInput = Readonly<{
  actionId?: string;
  revision: number;
  kind: EvidenceLogKind;
  correlationIds?: EvidenceCorrelationIds;
  status: EvidenceLogStatus;
  durationMs?: number;
}>;

export type EvidenceLogDebugExport = Readonly<{
  version: typeof EVIDENCE_LOG_VERSION;
  runId: string;
  dropped: number;
  entries: readonly EvidenceLogEntry[];
}>;

export type EvidenceOperationTrace = Readonly<{
  tokenId: string;
  revision: number;
  event:
    | "started"
    | "rejected"
    | "preempted"
    | "committed"
    | "quarantined"
    | "completed";
  boundary?:
    | "geogebra_mutation"
    | "ui_commit"
    | "realtime_emit"
    | "tool_publish";
}>;

type EvidenceLogOptions = Readonly<{
  runId?: string;
  now?: () => number;
  capacity?: number;
  createRunId?: () => string;
}>;

type SpanStart = Readonly<{ timestamp: number }>;

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/;

/**
 * Bounded in-memory evidence journal. Inputs are projected through a strict
 * allowlist, so unknown properties can never reach an export. Invalid required
 * fields reject the event; invalid optional identifiers are redacted.
 */
export class EvidenceLog {
  private readonly entries: EvidenceLogEntry[] = [];
  private readonly spans = new Map<string, SpanStart>();
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly createRunId: () => string;
  private currentRunId: string;
  private droppedCount = 0;

  constructor(options: EvidenceLogOptions = {}) {
    this.createRunId = options.createRunId ?? createRunId;
    this.currentRunId = validId(options.runId)
      ? options.runId
      : nextRunId(this.createRunId);
    this.now = options.now ?? Date.now;
    this.capacity = positiveInteger(
      options.capacity,
      DEFAULT_EVIDENCE_LOG_CAPACITY,
    );
  }

  append(input: EvidenceLogInput): EvidenceLogEntry | null {
    if (!validRequiredInput(input)) return null;
    const timestamp = finiteNonNegative(this.now());
    const correlationIds = projectCorrelationIds(input.correlationIds);
    const actionId = validId(input.actionId) ? input.actionId : undefined;
    const spanKey = lifecycleSpanKey(
      input.kind,
      input.revision,
      actionId,
      correlationIds,
    );
    const durationMs = resolveDuration(
      input,
      timestamp,
      spanKey,
      this.spans,
    );
    const entry: EvidenceLogEntry = Object.freeze({
      timestamp,
      runId: this.currentRunId,
      ...(actionId ? { actionId } : {}),
      revision: input.revision,
      kind: input.kind,
      correlationIds,
      status: input.status,
      durationMs,
    });
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      const dropped = this.entries.shift();
      if (dropped?.status === "started") {
        this.spans.delete(
          lifecycleSpanKey(
            dropped.kind,
            dropped.revision,
            dropped.actionId,
            dropped.correlationIds,
          ),
        );
      }
      this.droppedCount += 1;
    }
    return entry;
  }

  appendOperationTrace(input: EvidenceOperationTrace): EvidenceLogEntry | null {
    if (!input.boundary || !validId(input.tokenId)) return null;
    return this.append({
      revision: input.revision,
      kind: input.boundary,
      correlationIds: { operationId: input.tokenId },
      status: operationStatus(input.event),
    });
  }

  export(): readonly EvidenceLogEntry[] {
    return cloneEntries(this.entries);
  }

  exportDebug(): EvidenceLogDebugExport {
    return Object.freeze({
      version: EVIDENCE_LOG_VERSION,
      runId: this.currentRunId,
      dropped: this.droppedCount,
      entries: cloneEntries(this.entries),
    });
  }

  clear(): void {
    this.entries.length = 0;
    this.spans.clear();
    this.droppedCount = 0;
    this.currentRunId = nextRunId(this.createRunId);
  }
}

function validRequiredInput(input: EvidenceLogInput): boolean {
  return (
    Boolean(input && typeof input === "object") &&
    EVIDENCE_LOG_KINDS.includes(input.kind) &&
    EVIDENCE_LOG_STATUSES.includes(input.status) &&
    Number.isSafeInteger(input.revision) &&
    input.revision >= 0 &&
    (input.durationMs === undefined ||
      (Number.isFinite(input.durationMs) && input.durationMs >= 0))
  );
}

function projectCorrelationIds(
  input: EvidenceCorrelationIds | undefined,
): EvidenceCorrelationIds {
  if (!input || typeof input !== "object") return Object.freeze({});
  const evidenceIds = Array.isArray(input.evidenceIds)
    ? [...new Set(input.evidenceIds.filter(validId))].slice(0, 32)
    : [];
  return Object.freeze({
    ...(validId(input.operationId) ? { operationId: input.operationId } : {}),
    ...(validId(input.directiveId) ? { directiveId: input.directiveId } : {}),
    ...(validId(input.responseId) ? { responseId: input.responseId } : {}),
    ...(validId(input.callId) ? { callId: input.callId } : {}),
    ...(evidenceIds.length > 0
      ? { evidenceIds: Object.freeze(evidenceIds) }
      : {}),
  });
}

function resolveDuration(
  input: EvidenceLogInput,
  timestamp: number,
  spanKey: string,
  spans: Map<string, SpanStart>,
): number {
  if (input.durationMs !== undefined) {
    if (input.status !== "started") spans.delete(spanKey);
    return finiteNonNegative(input.durationMs);
  }
  if (input.status === "started") {
    spans.set(spanKey, { timestamp });
    return 0;
  }
  const start = spans.get(spanKey);
  if (!start) return 0;
  spans.delete(spanKey);
  return finiteNonNegative(timestamp - start.timestamp);
}

function lifecycleSpanKey(
  kind: EvidenceLogKind,
  revision: number,
  actionId: string | undefined,
  correlationIds: EvidenceCorrelationIds,
): string {
  return [
    kind,
    revision,
    actionId ?? "-",
    correlationIds.operationId ?? "-",
    correlationIds.directiveId ?? "-",
    correlationIds.responseId ?? "-",
    correlationIds.callId ?? "-",
  ].join("|");
}

function operationStatus(
  event: EvidenceOperationTrace["event"],
): EvidenceLogStatus {
  if (event === "started") return "started";
  if (event === "committed" || event === "completed") return "completed";
  if (event === "quarantined") return "quarantined";
  if (event === "rejected") return "rejected";
  return "cancelled";
}

function cloneEntries(
  entries: readonly EvidenceLogEntry[],
): readonly EvidenceLogEntry[] {
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        ...entry,
        correlationIds: Object.freeze({
          ...entry.correlationIds,
          ...(entry.correlationIds.evidenceIds
            ? {
                evidenceIds: Object.freeze([
                  ...entry.correlationIds.evidenceIds,
                ]),
              }
            : {}),
        }),
      }),
    ),
  );
}

function validId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function createRunId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function nextRunId(factory: () => string): string {
  const candidate = `run-${factory()}`;
  return validId(candidate) ? candidate : `run-${createRunId()}`;
}

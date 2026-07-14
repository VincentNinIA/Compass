import type { PolicyDecisionType } from "./state";

export const CANCELLATION_REASONS = [
  "student_drag",
  "student_speech",
  "application_stop",
  "stale_revision",
  "reset",
  "response_error",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const EVIDENCE_LOG_EVENT_TYPES = [
  "action_committed",
  "policy_decision",
  "directive_queued",
  "directive_dispatched",
  "response_started",
  "response_finished",
  "tool_call",
  "tool_result",
  "evidence_committed",
  "cancellation",
  "send_blocked",
  "realtime_coherent",
] as const;

export type EvidenceLogEventType = (typeof EVIDENCE_LOG_EVENT_TYPES)[number];

export type EvidenceLogEntry = Readonly<{
  runId: string;
  sequence: number;
  at: number;
  eventType: EvidenceLogEventType;
  epoch: number;
  revision: number;
  actionId?: string;
  decision?: PolicyDecisionType;
  directiveId?: string;
  responseId?: string;
  callId?: string;
  evidenceIds?: readonly string[];
  outcome: string;
  reason: string;
}>;

export type EvidenceLogInput = Omit<
  EvidenceLogEntry,
  "runId" | "sequence" | "at"
>;

type EvidenceLogOptions = {
  runId?: string;
  now?: () => number;
};

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * An in-memory, append-only allowlist. Arbitrary payload fields are never
 * copied, so audio, text, SDP, images and credentials cannot enter exports.
 */
export class EvidenceLog {
  private readonly entries: EvidenceLogEntry[] = [];
  private readonly runId: string;
  private readonly now: () => number;

  constructor(options: EvidenceLogOptions = {}) {
    this.runId = validId(options.runId)
      ? options.runId
      : `run-${createRunId()}`;
    this.now = options.now ?? Date.now;
  }

  append(input: EvidenceLogInput): EvidenceLogEntry | null {
    if (!validInput(input)) return null;
    const entry: EvidenceLogEntry = Object.freeze({
      runId: this.runId,
      sequence: this.entries.length + 1,
      at: finiteTimestamp(this.now()),
      eventType: input.eventType,
      epoch: input.epoch,
      revision: input.revision,
      ...(validId(input.actionId) ? { actionId: input.actionId } : {}),
      ...(input.decision ? { decision: input.decision } : {}),
      ...(validId(input.directiveId)
        ? { directiveId: input.directiveId }
        : {}),
      ...(validId(input.responseId) ? { responseId: input.responseId } : {}),
      ...(validId(input.callId) ? { callId: input.callId } : {}),
      ...(input.evidenceIds
        ? { evidenceIds: Object.freeze([...input.evidenceIds]) }
        : {}),
      outcome: input.outcome,
      reason: input.reason,
    });
    this.entries.push(entry);
    return entry;
  }

  export(): readonly EvidenceLogEntry[] {
    return Object.freeze(
      this.entries.map((entry) =>
        Object.freeze({
          ...entry,
          ...(entry.evidenceIds
            ? { evidenceIds: Object.freeze([...entry.evidenceIds]) }
            : {}),
        }),
      ),
    );
  }

  clear(): void {
    this.entries.length = 0;
  }
}

function validInput(input: EvidenceLogInput): boolean {
  return (
    Boolean(input && typeof input === "object") &&
    EVIDENCE_LOG_EVENT_TYPES.includes(input.eventType) &&
    Number.isSafeInteger(input.epoch) &&
    input.epoch >= 0 &&
    Number.isSafeInteger(input.revision) &&
    input.revision >= 0 &&
    SAFE_TOKEN.test(input.outcome) &&
    SAFE_TOKEN.test(input.reason) &&
    (!input.decision || ["SILENT", "QUEUE", "SPEAK"].includes(input.decision)) &&
    (!input.evidenceIds ||
      (input.evidenceIds.length > 0 &&
        new Set(input.evidenceIds).size === input.evidenceIds.length &&
        input.evidenceIds.every((id) => validId(id))))
  );
}

function validId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function finiteTimestamp(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function createRunId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

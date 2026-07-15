export const OPERATION_KINDS = [
  "reset",
  "student_speech",
  "student_action",
  "tool",
] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number];

export const OPERATION_PRIORITY = Object.freeze({
  reset: 400,
  student_speech: 300,
  student_action: 200,
  tool: 100,
} as const satisfies Record<OperationKind, number>);

export const OPERATION_BOUNDARIES = [
  "geogebra_mutation",
  "ui_commit",
  "realtime_emit",
  "tool_publish",
] as const;

export type OperationBoundary = (typeof OPERATION_BOUNDARIES)[number];

export type OperationToken = Readonly<{
  id: string;
  kind: OperationKind;
  epoch: number;
  revision: number;
  priority: number;
  abort: AbortSignal;
}>;

export type OperationAuthority = Readonly<{
  epoch?: number;
  revision?: number;
}>;

export type OperationTraceEntry = Readonly<{
  sequence: number;
  tokenId: string;
  kind: OperationKind;
  epoch: number;
  revision: number;
  priority: number;
  event:
    | "started"
    | "rejected"
    | "preempted"
    | "committed"
    | "quarantined"
    | "completed";
  boundary?: OperationBoundary;
  reason: string;
}>;

export type OperationRegistrySnapshot = Readonly<{
  pending: readonly OperationToken[];
  trace: readonly OperationTraceEntry[];
}>;

export type OperationLease = Readonly<{
  token: OperationToken;
  accepted: boolean;
  isCurrent(
    boundary: OperationBoundary,
    authority?: OperationAuthority,
  ): boolean;
  commit<T>(
    boundary: OperationBoundary,
    authority: OperationAuthority | undefined,
    effect: () => T,
  ): T | undefined;
  quarantine(reason: string, boundary?: OperationBoundary): boolean;
  finish(reason?: string): boolean;
}>;

type OperationArbiterOptions = Readonly<{
  watchdogMs?: number;
  maxTraceEntries?: number;
  onTrace?(entry: OperationTraceEntry): void;
}>;

type ActiveOperation = {
  token: OperationToken;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_WATCHDOG_MS = 15_000;
const DEFAULT_MAX_TRACE_ENTRIES = 512;

/**
 * In-memory authority for the four demo operations. It never queues or resumes
 * work: a higher-priority operation preempts lower work, while lower work that
 * arrives under a higher authority is rejected and must be recomputed later.
 */
export class OperationArbiter {
  private readonly active = new Map<string, ActiveOperation>();
  private readonly entries: OperationTraceEntry[] = [];
  private readonly idleWaiters = new Set<() => void>();
  private readonly watchdogMs: number;
  private readonly maxTraceEntries: number;
  private readonly onTrace?: (entry: OperationTraceEntry) => void;
  private tokenSequence = 0;
  private traceSequence = 0;
  private closed = false;

  constructor(options: OperationArbiterOptions = {}) {
    this.watchdogMs = positiveInteger(
      options.watchdogMs,
      DEFAULT_WATCHDOG_MS,
    );
    this.maxTraceEntries = positiveInteger(
      options.maxTraceEntries,
      DEFAULT_MAX_TRACE_ENTRIES,
    );
    this.onTrace = options.onTrace;
  }

  begin(input: Readonly<{
    kind: OperationKind;
    epoch: number;
    revision: number;
  }>): OperationLease {
    assertAnchor(input.epoch, input.revision);
    const controller = new AbortController();
    const token = Object.freeze({
      id: `operation-${++this.tokenSequence}`,
      kind: input.kind,
      epoch: input.epoch,
      revision: input.revision,
      priority: OPERATION_PRIORITY[input.kind],
      abort: controller.signal,
    });

    const blocker = [...this.active.values()]
      .map(({ token: active }) => active)
      .filter((active) => active.priority > token.priority)
      .sort((left, right) => right.priority - left.priority)[0];
    if (this.closed || blocker) {
      controller.abort();
      this.record(token, "rejected", {
        reason: this.closed ? "arbiter_closed" : `blocked_by_${blocker!.kind}`,
      });
      return this.createLease(token, false);
    }

    for (const active of [...this.active.values()]) {
      if (active.token.priority <= token.priority) {
        this.preempt(active, `preempted_by_${token.kind}`, false);
      }
    }
    const timer = setTimeout(() => {
      this.quarantine(token, "watchdog_timeout");
    }, this.watchdogMs);
    this.active.set(token.id, { token, controller, timer });
    this.record(token, "started", { reason: "authority_acquired" });
    return this.createLease(token, true);
  }

  revalidate(
    token: OperationToken,
    boundary: OperationBoundary,
    authority: OperationAuthority = {},
  ): boolean {
    const active = this.active.get(token.id);
    if (!active || active.token !== token || token.abort.aborted) return false;
    if (
      (authority.epoch !== undefined && authority.epoch !== token.epoch) ||
      (authority.revision !== undefined &&
        authority.revision !== token.revision)
    ) {
      this.quarantine(token, "authority_changed", boundary);
      return false;
    }
    return true;
  }

  commit<T>(
    token: OperationToken,
    boundary: OperationBoundary,
    authority: OperationAuthority | undefined,
    effect: () => T,
  ): T | undefined {
    if (!this.revalidate(token, boundary, authority)) return undefined;
    const value = effect();
    this.record(token, "committed", { boundary, reason: "guard_passed" });
    return value;
  }

  quarantine(
    token: OperationToken,
    reason: string,
    boundary?: OperationBoundary,
  ): boolean {
    const active = this.active.get(token.id);
    if (!active || active.token !== token) return false;
    clearTimeout(active.timer);
    active.controller.abort();
    this.active.delete(token.id);
    this.record(token, "quarantined", { boundary, reason: safeReason(reason) });
    this.notifyIdle();
    return true;
  }

  finish(token: OperationToken, reason = "settled"): boolean {
    const active = this.active.get(token.id);
    if (!active || active.token !== token) return false;
    clearTimeout(active.timer);
    this.active.delete(token.id);
    this.record(token, "completed", { reason: safeReason(reason) });
    this.notifyIdle();
    return true;
  }

  hasPending(): boolean {
    return this.active.size > 0;
  }

  async waitForIdle(timeoutMs = this.watchdogMs + 1): Promise<boolean> {
    if (!this.hasPending()) return true;
    const boundedTimeout = positiveInteger(timeoutMs, this.watchdogMs + 1);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (idle: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.idleWaiters.delete(onIdle);
        resolve(idle);
      };
      const onIdle = () => finish(true);
      const timer = setTimeout(() => finish(!this.hasPending()), boundedTimeout);
      this.idleWaiters.add(onIdle);
    });
  }

  snapshot(): OperationRegistrySnapshot {
    return Object.freeze({
      pending: Object.freeze(
        [...this.active.values()]
          .map(({ token }) => token)
          .sort((left, right) => right.priority - left.priority),
      ),
      trace: Object.freeze([...this.entries]),
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const active of [...this.active.values()]) {
      this.preempt(active, "arbiter_closed");
    }
    this.notifyIdle();
  }

  private createLease(token: OperationToken, accepted: boolean): OperationLease {
    return Object.freeze({
      token,
      accepted,
      isCurrent: (boundary, authority) =>
        this.revalidate(token, boundary, authority),
      commit: (boundary, authority, effect) =>
        this.commit(token, boundary, authority, effect),
      quarantine: (reason, boundary) =>
        this.quarantine(token, reason, boundary),
      finish: (reason) => this.finish(token, reason),
    });
  }

  private preempt(
    active: ActiveOperation,
    reason: string,
    notify = true,
  ): void {
    clearTimeout(active.timer);
    active.controller.abort();
    this.active.delete(active.token.id);
    this.record(active.token, "preempted", { reason });
    if (notify) this.notifyIdle();
  }

  private record(
    token: OperationToken,
    event: OperationTraceEntry["event"],
    detail: Readonly<{ boundary?: OperationBoundary; reason: string }>,
  ): void {
    const entry = Object.freeze({
      sequence: ++this.traceSequence,
      tokenId: token.id,
      kind: token.kind,
      epoch: token.epoch,
      revision: token.revision,
      priority: token.priority,
      event,
      ...(detail.boundary ? { boundary: detail.boundary } : {}),
      reason: safeReason(detail.reason),
    });
    this.entries.push(entry);
    if (this.entries.length > this.maxTraceEntries) this.entries.shift();
    try {
      this.onTrace?.(entry);
    } catch {
      // Observability must never acquire operational authority.
    }
  }

  private notifyIdle(): void {
    if (this.hasPending()) return;
    for (const notify of [...this.idleWaiters]) notify();
  }
}

function assertAnchor(epoch: number, revision: number): void {
  if (
    !Number.isSafeInteger(epoch) ||
    epoch < 0 ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    throw new TypeError("Operation epoch and revision must be non-negative integers.");
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function safeReason(reason: string): string {
  return /^[a-z0-9_]{1,80}$/.test(reason) ? reason : "invalid_reason";
}

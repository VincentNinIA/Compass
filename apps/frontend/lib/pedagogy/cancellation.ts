import type { EvidenceLog, CancellationReason } from "./evidence-log";
import type { PedagogyEvent, PedagogyState } from "./state";

export type CancellationResult = Readonly<{
  reason: CancellationReason;
  status: "cancelled" | "noop";
  transportCancelled: boolean;
  pendingCleared: boolean;
  responseCleared: boolean;
  hintCancelled: boolean;
}>;

export class CancellationCoordinator {
  private readonly completed = new Set<string>();

  constructor(
    private readonly dependencies: {
      getState(): PedagogyState;
      dispatch(event: PedagogyEvent): PedagogyState;
      cancelTransport(reason: CancellationReason): boolean;
      cancelHint?(reason: CancellationReason): boolean;
      getScope?(): string;
      evidenceLog?: EvidenceLog;
    },
  ) {}

  cancel(reason: CancellationReason): CancellationResult {
    const initial = this.dependencies.getState();
    const key = cancellationKey(
      initial,
      reason,
      this.dependencies.getScope?.() ?? "-",
    );
    if (this.completed.has(key)) return noop(reason);

    const pendingId = initial.pendingIntervention?.directiveId;
    const responseId = initial.activeResponse?.responseId;
    const hintCancelled = this.dependencies.cancelHint?.(reason) ?? false;
    const transportCancelled = this.dependencies.cancelTransport(reason);

    let live = this.dependencies.getState();
    let pendingCleared = false;
    let responseCleared = false;
    if (pendingId && live.pendingIntervention?.directiveId === pendingId) {
      live = this.dependencies.dispatch({
        type: "directive_invalidated",
        directiveId: pendingId,
        ...anchor(live),
      });
      pendingCleared = live.pendingIntervention === null;
    }
    if (responseId && live.activeResponse?.responseId === responseId) {
      live = this.dependencies.dispatch({
        type: reason === "response_error" ? "response_failed" : "response_cancelled",
        responseId,
        ...anchor(live),
      });
      responseCleared = live.activeResponse === null;
    }

    const status =
      pendingId || responseId || hintCancelled || transportCancelled
        ? "cancelled"
        : "noop";
    this.completed.add(key);
    this.completed.add(
      cancellationKey(
        live,
        reason,
        this.dependencies.getScope?.() ?? "-",
      ),
    );
    this.dependencies.evidenceLog?.append({
      eventType: "cancellation",
      epoch: initial.epoch,
      revision: initial.revision,
      ...(pendingId ? { directiveId: pendingId } : {}),
      ...(responseId ? { responseId } : {}),
      evidenceIds: currentEvidenceIds(initial),
      outcome: status,
      reason,
    });
    return Object.freeze({
      reason,
      status,
      transportCancelled,
      pendingCleared,
      responseCleared,
      hintCancelled,
    });
  }
}

function cancellationKey(
  state: PedagogyState,
  reason: CancellationReason,
  scope: string,
): string {
  return [
    reason,
    state.epoch,
    state.revision,
    state.pendingIntervention?.directiveId ?? "-",
    state.activeResponse?.responseId ?? "-",
    state.activeHint?.hintId ?? "-",
    scope,
  ].join("|");
}

function anchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

function currentEvidenceIds(state: PedagogyState): readonly string[] | undefined {
  const ids = state.verifiedFacts.map(({ evidenceId }) => evidenceId).sort();
  return ids.length > 0 ? ids : undefined;
}

function noop(reason: CancellationReason): CancellationResult {
  return Object.freeze({
    reason,
    status: "noop",
    transportCancelled: false,
    pendingCleared: false,
    responseCleared: false,
    hintCancelled: false,
  });
}

import { decideIntervention, type PolicyDecision } from "./policy";
import {
  selectProgressViewModel,
  type ProgressViewModel,
} from "./progress-view-model";
import {
  pedagogyReducer,
  type PedagogyEvent,
  type PedagogyState,
} from "./state";
import type { EvidenceLog } from "./evidence-log";

type ValidatedActionEvent = Extract<
  PedagogyEvent,
  { type: "validated_action_committed" }
>;

export type LocalFirstMarker =
  | "validation_committed"
  | "progress_rendered"
  | "policy_evaluated"
  | "network_requested";

export type LocalFirstTrace = {
  marker: LocalFirstMarker;
  sequence: number;
  at: number;
};

export type LocalFirstActionResult = {
  state: PedagogyState;
  progress: ProgressViewModel;
  decision: PolicyDecision | null;
  accepted: boolean;
  policyStatus: "not_evaluated" | "evaluated" | "failed";
  networkStatus: "not_requested" | "requested" | "failed";
  trace: readonly LocalFirstTrace[];
};

export async function runLocalFirstAction(
  current: PedagogyState,
  event: ValidatedActionEvent,
  previousProgress: ProgressViewModel,
  dependencies: {
    renderProgress(model: ProgressViewModel): void | Promise<void>;
    requestNetwork?(decision: Extract<PolicyDecision, { type: "speak" }>):
      | void
      | Promise<void>;
    onNetworkFailure?(): void;
    decide?: typeof decideIntervention;
    now?: () => number;
    evidenceLog?: EvidenceLog;
  },
): Promise<LocalFirstActionResult> {
  const trace: LocalFirstTrace[] = [];
  const now = dependencies.now ?? Date.now;
  const state = pedagogyReducer(current, event);
  const accepted =
    state.attemptState.lastActionId === event.actionId &&
    state.revision === event.revision &&
    state.studentSnapshotHash === event.snapshotHash;
  const progress = selectProgressViewModel(state, previousProgress);

  if (!accepted) {
    return {
      state,
      progress,
      decision: null,
      accepted: false,
      policyStatus: "not_evaluated",
      networkStatus: "not_requested",
      trace,
    };
  }
  mark(trace, "validation_committed", now);
  dependencies.evidenceLog?.append({
    eventType: "action_committed",
    epoch: state.epoch,
    revision: state.revision,
    actionId: event.actionId,
    evidenceIds: event.evidence.map(({ id }) => id).sort(),
    outcome: "accepted",
    reason: event.meaningfulDelta.isMeaningful ? "meaningful" : "no_delta",
  });
  dependencies.evidenceLog?.append({
    eventType: "evidence_committed",
    epoch: state.epoch,
    revision: state.revision,
    actionId: event.actionId,
    evidenceIds: event.evidence.map(({ id }) => id).sort(),
    outcome: "accepted",
    reason: "deterministic_validation",
  });
  await dependencies.renderProgress(progress);
  mark(trace, "progress_rendered", now);

  const decide = dependencies.decide ?? decideIntervention;
  let decision: PolicyDecision;
  try {
    decision = decide(state, {
      type: "validated_action",
      actionId: event.actionId,
      delta: event.meaningfulDelta,
    });
    mark(trace, "policy_evaluated", now);
    dependencies.evidenceLog?.append({
      eventType: "policy_decision",
      epoch: state.epoch,
      revision: state.revision,
      actionId: event.actionId,
      decision: decisionType(decision),
      evidenceIds: event.evidence.map(({ id }) => id).sort(),
      outcome: "accepted",
      reason: decision.reason,
    });
  } catch {
    return {
      state,
      progress,
      decision: null,
      accepted: true,
      policyStatus: "failed",
      networkStatus: "not_requested",
      trace,
    };
  }
  if (decision.type === "speak" && dependencies.requestNetwork) {
    mark(trace, "network_requested", now);
    try {
      void Promise.resolve(dependencies.requestNetwork(decision)).catch(() => {
        dependencies.onNetworkFailure?.();
      });
      return {
        state,
        progress,
        decision,
        accepted: true,
        policyStatus: "evaluated",
        networkStatus: "requested",
        trace,
      };
    } catch {
      dependencies.onNetworkFailure?.();
      return {
        state,
        progress,
        decision,
        accepted: true,
        policyStatus: "evaluated",
        networkStatus: "failed",
        trace,
      };
    }
  }
  return {
    state,
    progress,
    decision,
    accepted: true,
    policyStatus: "evaluated",
    networkStatus: "not_requested",
    trace,
  };
}

function decisionType(decision: PolicyDecision): "SILENT" | "QUEUE" | "SPEAK" {
  if (decision.type === "silent") return "SILENT";
  if (decision.type === "queue") return "QUEUE";
  return "SPEAK";
}

function mark(
  trace: LocalFirstTrace[],
  marker: LocalFirstMarker,
  now: () => number,
): void {
  trace.push({ marker, sequence: trace.length + 1, at: now() });
}

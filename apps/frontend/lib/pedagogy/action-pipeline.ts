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
import type { LatencyBudgetMonitor } from "@/lib/reliability/latency-budget";

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
    latencyMonitor?: LatencyBudgetMonitor;
    latencyNow?: () => number;
  },
): Promise<LocalFirstActionResult> {
  const trace: LocalFirstTrace[] = [];
  const now = dependencies.now ?? Date.now;
  const latencyNow = dependencies.latencyNow ?? Date.now;
  const feedbackStartedAt = dependencies.latencyMonitor
    ? latencyNow()
    : undefined;
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
    revision: state.revision,
    actionId: event.actionId,
    kind: "action",
    correlationIds: {
      evidenceIds: event.evidence.map(({ id }) => id).sort(),
    },
    status: "accepted",
  });
  dependencies.evidenceLog?.append({
    revision: state.revision,
    actionId: event.actionId,
    kind: "evidence",
    correlationIds: {
      evidenceIds: event.evidence.map(({ id }) => id).sort(),
    },
    status: "completed",
  });
  await dependencies.renderProgress(progress);
  mark(trace, "progress_rendered", now);
  if (feedbackStartedAt !== undefined) {
    dependencies.latencyMonitor?.record(
      "feedback_local",
      Math.max(0, latencyNow() - feedbackStartedAt),
    );
  }

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
      revision: state.revision,
      actionId: event.actionId,
      kind: decisionKind(decision),
      correlationIds: {
        evidenceIds: event.evidence.map(({ id }) => id).sort(),
      },
      status: "accepted",
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

function decisionKind(
  decision: PolicyDecision,
): "decision_silent" | "decision_queue" | "decision_speak" {
  if (decision.type === "silent") return "decision_silent";
  if (decision.type === "queue") return "decision_queue";
  return "decision_speak";
}

function mark(
  trace: LocalFirstTrace[],
  marker: LocalFirstMarker,
  now: () => number,
): void {
  trace.push({ marker, sequence: trace.length + 1, at: now() });
}

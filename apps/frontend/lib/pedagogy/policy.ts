import { createFactSignature, type MeaningfulDelta } from "./meaningful-delta";
import { getHintLevelProfile, nextUsefulHelpLevel } from "./hint-assistance";
import {
  getPedagogyInvariantViolations,
  selectCurrentEvidence,
  selectHasOpenIntervention,
  selectIsFloorBusy,
  type HelpLevel,
  type PedagogyState,
} from "./state";

export type PolicyReason =
  | "step_completed"
  | "explicit_help_requested"
  | "repeated_block"
  | "local_visual_progress"
  | "first_incorrect_attempt"
  | "no_meaningful_delta"
  | "floor_busy"
  | "invalid_or_duplicate_context";

export type InterventionGoal =
  | "validate_and_elicit_explanation"
  | "provide_lowest_useful_help"
  | "ask_reflective_question";

export type DirectiveDraft = {
  kind: "explicit" | "proactive" | "completion";
  sourceActionId: string | null;
  sourceRequestId: string | null;
  helpLevel: Exclude<HelpLevel, 0>;
  goal: InterventionGoal;
  allowedTools: readonly string[];
};

export type PolicyDecision =
  | { type: "silent"; reason: PolicyReason }
  | {
      type: "queue";
      reason: "floor_busy";
      candidate: DirectiveDraft & { businessReason: PolicyReason };
    }
  | {
      type: "speak";
      reason: PolicyReason;
      directiveDraft: DirectiveDraft;
    };

export type PolicyTrigger =
  | {
      type: "validated_action";
      actionId: string;
      delta: MeaningfulDelta;
    }
  | { type: "explicit_help"; requestId: string };

export type InvarianceGeneralizationPolicyInput = Readonly<{
  runId: string;
  revision: number;
  inputEvidenceIds: readonly string[];
  evidenceIds: readonly string[];
  duplicate: boolean;
}>;

export type InvarianceGeneralizationPolicyDecision =
  | {
      type: "silent";
      reason:
        | "invalid_or_duplicate_context"
        | "higher_priority_intervention";
    }
  | { type: "queue"; reason: "floor_busy" }
  | { type: "speak"; reason: "invariance_completed" };

export function decideIntervention(
  state: PedagogyState,
  trigger: PolicyTrigger,
): PolicyDecision {
  if (
    getPedagogyInvariantViolations(state).length > 0 ||
    !isValidTrigger(state, trigger)
  ) {
    return { type: "silent", reason: "invalid_or_duplicate_context" };
  }

  const intent = businessIntent(state, trigger);
  if (intent.type === "silent") return intent;
  if (!selectIsFloorBusy(state)) return intent;
  return {
    type: "queue",
    reason: "floor_busy",
    candidate: {
      ...intent.directiveDraft,
      businessReason: intent.reason,
    },
  };
}

/**
 * Keeps the T5 generalization prompt behind the same local authority, priority,
 * and floor rules as the T4 intervention policy. A QUEUE result is deliberately
 * non-final: the caller must evaluate this function again against fresh state.
 */
export function decideInvarianceGeneralization(
  state: PedagogyState,
  input: InvarianceGeneralizationPolicyInput,
): InvarianceGeneralizationPolicyDecision {
  if (
    input.duplicate ||
    input.runId.length === 0 ||
    input.revision !== state.revision ||
    input.inputEvidenceIds.length !== 2 ||
    new Set(input.inputEvidenceIds).size !== 2 ||
    input.evidenceIds.length !== 5 ||
    new Set(input.evidenceIds).size !== 5 ||
    getPedagogyInvariantViolations(state).length > 0 ||
    !hasCurrentBisectorAuthority(state, input.inputEvidenceIds)
  ) {
    return { type: "silent", reason: "invalid_or_duplicate_context" };
  }

  if (
    selectHasOpenIntervention(state) ||
    hasUnfinalizedHigherPrioritySource(state)
  ) {
    return { type: "silent", reason: "higher_priority_intervention" };
  }
  if (selectIsFloorBusy(state)) {
    return { type: "queue", reason: "floor_busy" };
  }
  return { type: "speak", reason: "invariance_completed" };
}

function businessIntent(
  state: PedagogyState,
  trigger: PolicyTrigger,
): Extract<PolicyDecision, { type: "silent" | "speak" }> {
  const complete =
    state.verifiedFacts.length > 0 &&
    state.verifiedFacts.every((fact) => fact.status === "verified");

  if (trigger.type === "explicit_help") {
    if (complete) {
      return speak("step_completed", {
        kind: "completion",
        sourceActionId: state.attemptState.lastActionId,
        sourceRequestId: trigger.requestId,
        helpLevel: 1,
        goal: "validate_and_elicit_explanation",
        allowedTools: [],
      });
    }
    const helpLevel = nextUsefulHelpLevel(state.helpLevel);
    return speak("explicit_help_requested", {
      kind: "explicit",
      sourceActionId: state.attemptState.lastActionId,
      sourceRequestId: trigger.requestId,
      helpLevel,
      goal: "provide_lowest_useful_help",
      allowedTools: getHintLevelProfile(helpLevel).allowedTools,
    });
  }

  const delta = trigger.delta;
  if (
    complete &&
    delta.isMeaningful &&
    delta.factsChanged &&
    delta.missingRelationKeys.length === 0
  ) {
    return speak("step_completed", {
      kind: "completion",
      sourceActionId: trigger.actionId,
      sourceRequestId: null,
      helpLevel: 1,
      goal: "validate_and_elicit_explanation",
      allowedTools: [],
    });
  }

  if (
    delta.isMeaningful &&
    state.repeatedBlockState.count >= 2 &&
    state.repeatedBlockState.lastActionId === trigger.actionId &&
    delta.missingRelationKeys.length > 0
  ) {
    return speak("repeated_block", {
      kind: "proactive",
      sourceActionId: trigger.actionId,
      sourceRequestId: null,
      helpLevel: 1,
      goal: "ask_reflective_question",
      allowedTools: [],
    });
  }

  const hasVerified = state.verifiedFacts.some(
    (fact) => fact.status === "verified",
  );
  const hasMissing = state.verifiedFacts.some(
    (fact) => fact.status === "missing" || fact.status === "unknown",
  );
  if (delta.isMeaningful && hasVerified && hasMissing) {
    return { type: "silent", reason: "local_visual_progress" };
  }
  if (delta.isMeaningful && hasMissing) {
    return { type: "silent", reason: "first_incorrect_attempt" };
  }
  return { type: "silent", reason: "no_meaningful_delta" };
}

function isValidTrigger(
  state: PedagogyState,
  trigger: PolicyTrigger,
): boolean {
  if (trigger.type === "explicit_help") {
    return (
      trigger.requestId.length > 0 &&
      trigger.requestId === state.attemptState.lastHelpRequestId &&
      state.attemptState.helpRequestIds.includes(trigger.requestId) &&
      !state.policyState.finalizedHelpRequestIds.includes(trigger.requestId)
    );
  }
  return (
    trigger.actionId.length > 0 &&
    trigger.actionId === state.attemptState.lastActionId &&
    state.attemptState.processedActionIds.includes(trigger.actionId) &&
    state.repeatedBlockState.processedActionIds.includes(trigger.actionId) &&
    !state.policyState.finalizedActionIds.includes(trigger.actionId) &&
    trigger.delta.currentFactSignature ===
      createFactSignature(state.verifiedFacts) &&
    (!trigger.delta.isMeaningful ||
      trigger.delta.missingRelationKeys.join("|") ===
        state.repeatedBlockState.missingRelationSignature)
  );
}

function hasCurrentBisectorAuthority(
  state: PedagogyState,
  expectedEvidenceIds: readonly string[],
): boolean {
  const expectedRelations = new Set(["perpendicular", "passes_midpoint"]);
  const factEvidenceIds = state.verifiedFacts.map(({ evidenceId }) => evidenceId);
  const currentEvidence = selectCurrentEvidence(state);
  return (
    state.verifiedFacts.length === 2 &&
    state.verifiedFacts.every(
      (fact) =>
        fact.status === "verified" && expectedRelations.has(fact.relationKey),
    ) &&
    currentEvidence.length === 2 &&
    currentEvidence.every(({ id, pass }) => pass && factEvidenceIds.includes(id)) &&
    sameIdSet(factEvidenceIds, expectedEvidenceIds)
  );
}

function hasUnfinalizedHigherPrioritySource(state: PedagogyState): boolean {
  const lastActionId = state.attemptState.lastActionId;
  const lastHelpRequestId = state.attemptState.lastHelpRequestId;
  return (
    (lastActionId !== null &&
      !state.policyState.finalizedActionIds.includes(lastActionId)) ||
    (lastHelpRequestId !== null &&
      !state.policyState.finalizedHelpRequestIds.includes(lastHelpRequestId))
  );
}

function sameIdSet(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((id) => expected.includes(id))
  );
}

function speak(
  reason: PolicyReason,
  directiveDraft: DirectiveDraft,
): Extract<PolicyDecision, { type: "speak" }> {
  return { type: "speak", reason, directiveDraft };
}

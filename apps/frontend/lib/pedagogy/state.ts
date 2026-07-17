import type { ExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import type { RelationEvidence } from "@/types/geogebra";
import {
  createFactSignature,
  createRepeatedBlockState,
  deriveMissingRelationKeys,
  reduceRepeatedBlockState,
  type MeaningfulDelta,
  type RepeatedBlockState,
} from "./meaningful-delta";

export type HelpLevel = 0 | 1 | 2 | 3 | 4;
export type PedagogyRelationKey = RelationEvidence["relation"];
export type VerifiedFactStatus = "unknown" | "missing" | "verified";
export type PolicyDecisionType = "SILENT" | "QUEUE" | "SPEAK";

export type PedagogyEvidence = RelationEvidence & { snapshotHash: string };

export type VerifiedFact = {
  relationKey: PedagogyRelationKey;
  status: VerifiedFactStatus;
  evidenceId: string;
};

export type AttemptState = {
  actionCount: number;
  explicitHelpRequestCount: number;
  lastActionId: string | null;
  lastHelpRequestId: string | null;
  processedActionIds: readonly string[];
  helpRequestIds: readonly string[];
};

export type PolicyState = {
  finalizedActionIds: readonly string[];
  finalizedHelpRequestIds: readonly string[];
};

export type PendingIntervention = {
  directiveId: string;
  sourceActionId: string | null;
  baseRevision: number;
  snapshotHash: string;
  status: "queued" | "dispatched";
};

export type ActiveResponse = {
  responseId: string;
  directiveId: string | null;
};

export type ActiveHint = {
  hintId: string;
  level: Exclude<HelpLevel, 0>;
};

export type RejectedTransitionReason =
  | "stale_epoch"
  | "stale_revision"
  | "snapshot_mismatch"
  | "exercise_mismatch"
  | "revision_regression"
  | "invalid_evidence"
  | "duplicate_action"
  | "pending_intervention_exists"
  | "directive_mismatch"
  | "active_response_exists"
  | "response_mismatch"
  | "hint_mismatch"
  | "invalid_payload"
  | "invariant_violation";

export type RejectedTransition = {
  eventType: PedagogyEvent["type"];
  reason: RejectedTransitionReason;
};

export type PedagogyState = {
  epoch: number;
  exerciseId: ExercisePlanV1["exerciseId"];
  stepId: string;
  revision: number;
  studentSnapshotHash: string;
  verifiedFacts: readonly VerifiedFact[];
  evidenceById: Readonly<Record<string, PedagogyEvidence>>;
  attemptState: AttemptState;
  repeatedBlockState: RepeatedBlockState;
  policyState: PolicyState;
  helpLevel: HelpLevel;
  interaction: {
    studentIsDragging: boolean;
    studentIsSpeaking: boolean;
    tutorIsSpeaking: boolean;
  };
  pendingIntervention: PendingIntervention | null;
  activeResponse: ActiveResponse | null;
  activeHint: ActiveHint | null;
  lastPolicyDecision: PolicyDecisionType | null;
  rejectedTransitions: readonly RejectedTransition[];
};

type EpochEvent = { epoch: number };
type StateAnchor = EpochEvent & { revision: number; snapshotHash: string };

export type PedagogyEvent =
  | (StateAnchor & {
      type: "exercise_started";
      plan: ExercisePlanV1;
      stepId: string;
    })
  | (EpochEvent & {
      type: "validated_action_committed";
      exerciseId: ExercisePlanV1["exerciseId"];
      stepId: string;
      actionId: string;
      revision: number;
      snapshotHash: string;
      facts: readonly VerifiedFact[];
      evidence: readonly PedagogyEvidence[];
      meaningfulDelta: MeaningfulDelta;
    })
  | (StateAnchor & {
      type: "student_drag_started" | "student_drag_ended";
    })
  | (StateAnchor & {
      type: "student_speech_started" | "student_speech_ended";
    })
  | (StateAnchor & { type: "explicit_help_requested"; requestId: string })
  | (StateAnchor & {
      type: "policy_evaluated";
      decision: PolicyDecisionType;
      sourceActionId: string | null;
      sourceRequestId: string | null;
    })
  | (StateAnchor & {
      type: "directive_queued";
      intervention: Omit<PendingIntervention, "status">;
    })
  | (StateAnchor & { type: "directive_dispatched"; directiveId: string })
  | (StateAnchor & { type: "directive_invalidated"; directiveId: string })
  | (StateAnchor & {
      type: "response_started";
      responseId: string;
      directiveId?: string;
    })
  | (StateAnchor & {
      type:
        | "response_finished"
        | "response_cancelled"
        | "response_failed";
      responseId: string;
    })
  | (StateAnchor & {
      type: "hint_applied";
      hintId: string;
      level: Exclude<HelpLevel, 0>;
    })
  | (StateAnchor & { type: "hint_restored"; hintId: string })
  | (StateAnchor & {
      type: "assistance_delivered";
      directiveId: string;
      level: Exclude<HelpLevel, 0>;
      source: "proactive" | "explicit";
    })
  | {
      type: "epoch_reset";
      epoch: number;
      plan: ExercisePlanV1;
      stepId: string;
      revision: number;
      snapshotHash: string;
    };

export type InitialPedagogyStateOptions = {
  epoch?: number;
  stepId?: string;
  revision?: number;
  snapshotHash?: string;
};

const INITIAL_STEP_ID = "construct_perpendicular_bisector";

export function createInitialPedagogyState(
  plan: ExercisePlanV1,
  options: InitialPedagogyStateOptions = {},
): PedagogyState {
  const state: PedagogyState = {
    epoch: options.epoch ?? 0,
    exerciseId: plan.exerciseId,
    stepId: options.stepId ?? INITIAL_STEP_ID,
    revision: options.revision ?? 0,
    studentSnapshotHash: options.snapshotHash ?? "",
    verifiedFacts: [],
    evidenceById: {},
    attemptState: {
      actionCount: 0,
      explicitHelpRequestCount: 0,
      lastActionId: null,
      lastHelpRequestId: null,
      processedActionIds: [],
      helpRequestIds: [],
    },
    repeatedBlockState: createRepeatedBlockState(
      options.stepId ?? INITIAL_STEP_ID,
    ),
    policyState: {
      finalizedActionIds: [],
      finalizedHelpRequestIds: [],
    },
    helpLevel: 0,
    interaction: {
      studentIsDragging: false,
      studentIsSpeaking: false,
      tutorIsSpeaking: false,
    },
    pendingIntervention: null,
    activeResponse: null,
    activeHint: null,
    lastPolicyDecision: null,
    rejectedTransitions: [],
  };
  if (getPedagogyInvariantViolations(state).length > 0) {
    throw new Error("Invalid initial pedagogy state.");
  }
  return state;
}

export function pedagogyReducer(
  state: PedagogyState,
  event: PedagogyEvent,
): PedagogyState {
  if (event.type === "epoch_reset") {
    if (event.epoch <= state.epoch) return reject(state, event, "stale_epoch");
    if (event.revision < 0) return reject(state, event, "invalid_payload");
    return createInitialPedagogyState(event.plan, {
      epoch: event.epoch,
      stepId: event.stepId,
      revision: event.revision,
      snapshotHash: event.snapshotHash,
    });
  }

  if (event.epoch !== state.epoch) return reject(state, event, "stale_epoch");

  if (event.type === "exercise_started") {
    if (event.plan.exerciseId !== state.exerciseId) {
      return reject(state, event, "exercise_mismatch");
    }
    if (event.revision < state.revision) {
      return reject(state, event, "revision_regression");
    }
    if (
      event.revision !== state.revision ||
      event.snapshotHash !== state.studentSnapshotHash ||
      event.stepId !== state.stepId
    ) {
      return reject(state, event, "invalid_payload");
    }
    return state;
  }

  if (event.type === "validated_action_committed") {
    return reduceValidatedAction(state, event);
  }

  const staleReason = anchorRejection(state, event);
  if (staleReason) return reject(state, event, staleReason);

  switch (event.type) {
    case "student_drag_started":
      if (state.interaction.studentIsDragging) {
        return reject(state, event, "invalid_payload");
      }
      return transition(
        state,
        event,
        withInteraction(
          { ...state, pendingIntervention: null },
          { studentIsDragging: true },
        ),
      );
    case "student_drag_ended":
      if (!state.interaction.studentIsDragging) {
        return reject(state, event, "invalid_payload");
      }
      return transition(state, event, withInteraction(state, { studentIsDragging: false }));
    case "student_speech_started":
      if (state.interaction.studentIsSpeaking) {
        return reject(state, event, "invalid_payload");
      }
      return transition(
        state,
        event,
        withInteraction(
          { ...state, pendingIntervention: null },
          { studentIsSpeaking: true },
        ),
      );
    case "student_speech_ended":
      if (!state.interaction.studentIsSpeaking) {
        return reject(state, event, "invalid_payload");
      }
      return transition(state, event, withInteraction(state, { studentIsSpeaking: false }));

    case "explicit_help_requested":
      if (
        event.requestId.length === 0 ||
        state.attemptState.helpRequestIds.includes(event.requestId)
      ) {
        return reject(state, event, "invalid_payload");
      }
      return transition(state, event, {
        ...state,
        attemptState: {
          ...state.attemptState,
          explicitHelpRequestCount:
            state.attemptState.explicitHelpRequestCount + 1,
          lastHelpRequestId: event.requestId,
          helpRequestIds: [
            ...state.attemptState.helpRequestIds,
            event.requestId,
          ],
        },
      });

    case "policy_evaluated": {
      if (
        (event.sourceActionId === null) ===
          (event.sourceRequestId === null) ||
        (event.sourceActionId !== null &&
          !state.attemptState.processedActionIds.includes(
            event.sourceActionId,
          )) ||
        (event.sourceRequestId !== null &&
          !state.attemptState.helpRequestIds.includes(event.sourceRequestId))
      ) {
        return reject(state, event, "invalid_payload");
      }
      const finalizedActionIds =
        event.decision !== "QUEUE" && event.sourceActionId !== null
          ? [...state.policyState.finalizedActionIds, event.sourceActionId]
          : state.policyState.finalizedActionIds;
      const finalizedHelpRequestIds =
        event.decision !== "QUEUE" && event.sourceRequestId !== null
          ? [
              ...state.policyState.finalizedHelpRequestIds,
              event.sourceRequestId,
            ]
          : state.policyState.finalizedHelpRequestIds;
      if (
        new Set(finalizedActionIds).size !== finalizedActionIds.length ||
        new Set(finalizedHelpRequestIds).size !==
          finalizedHelpRequestIds.length
      ) {
        return reject(state, event, "duplicate_action");
      }
      return transition(state, event, {
        ...state,
        lastPolicyDecision: event.decision,
        policyState: { finalizedActionIds, finalizedHelpRequestIds },
      });
    }

    case "directive_queued":
      if (state.pendingIntervention) {
        return reject(state, event, "pending_intervention_exists");
      }
      if (state.activeResponse) {
        return reject(state, event, "active_response_exists");
      }
      if (!isInterventionCurrent(state, event.intervention)) {
        return reject(state, event, "invalid_payload");
      }
      return transition(state, event, {
        ...state,
        pendingIntervention: { ...event.intervention, status: "queued" },
      });

    case "directive_dispatched":
      if (
        state.pendingIntervention?.directiveId !== event.directiveId ||
        state.pendingIntervention.status !== "queued" ||
        event.directiveId.length === 0
      ) {
        return reject(state, event, "directive_mismatch");
      }
      return transition(state, event, {
        ...state,
        pendingIntervention: {
          ...state.pendingIntervention,
          status: "dispatched",
        },
      });

    case "directive_invalidated":
      if (state.pendingIntervention?.directiveId !== event.directiveId) {
        return reject(state, event, "directive_mismatch");
      }
      return transition(state, event, { ...state, pendingIntervention: null });

    case "response_started": {
      if (event.responseId.length === 0) {
        return reject(state, event, "invalid_payload");
      }
      if (state.activeResponse) {
        return reject(state, event, "active_response_exists");
      }
      if (event.directiveId) {
        if (
          state.pendingIntervention?.directiveId !== event.directiveId ||
          state.pendingIntervention.status !== "dispatched"
        ) {
          return reject(state, event, "directive_mismatch");
        }
      } else if (state.pendingIntervention) {
        return reject(state, event, "pending_intervention_exists");
      }
      return transition(state, event, {
        ...state,
        interaction: { ...state.interaction, tutorIsSpeaking: true },
        pendingIntervention: null,
        activeResponse: {
          responseId: event.responseId,
          directiveId: event.directiveId ?? null,
        },
      });
    }

    case "response_finished":
    case "response_cancelled":
    case "response_failed":
      if (state.activeResponse?.responseId !== event.responseId) {
        return reject(state, event, "response_mismatch");
      }
      return transition(state, event, {
        ...state,
        interaction: { ...state.interaction, tutorIsSpeaking: false },
        activeResponse: null,
      });

    case "hint_applied":
      if (state.activeHint || event.hintId.length === 0) {
        return reject(state, event, "invalid_payload");
      }
      return transition(state, event, {
        ...state,
        activeHint: { hintId: event.hintId, level: event.level },
      });

    case "hint_restored":
      if (state.activeHint?.hintId !== event.hintId) {
        return reject(state, event, "hint_mismatch");
      }
      return transition(state, event, { ...state, activeHint: null });

    case "assistance_delivered": {
      const validProactive = event.source === "proactive" && event.level === 1;
      const expectedExplicit =
        event.source === "explicit" &&
        event.level === nextExplicitHelpLevel(state.helpLevel);
      if (
        event.directiveId.length === 0 ||
        (!validProactive && !expectedExplicit)
      ) {
        return reject(state, event, "invalid_payload");
      }
      return transition(state, event, {
        ...state,
        helpLevel: Math.max(state.helpLevel, event.level) as HelpLevel,
      });
    }
  }
}

export function getPedagogyInvariantViolations(
  state: PedagogyState,
): readonly string[] {
  const violations: string[] = [];
  if (state.epoch < 0 || state.revision < 0) violations.push("negative_version");
  if (state.pendingIntervention && state.activeResponse) {
    violations.push("pending_and_active_response");
  }
  if (state.interaction.tutorIsSpeaking !== (state.activeResponse !== null)) {
    violations.push("tutor_speech_without_active_response");
  }
  const actionIds = state.attemptState.processedActionIds;
  if (new Set(actionIds).size !== actionIds.length) {
    violations.push("duplicate_processed_action");
  }
  if (state.attemptState.actionCount !== actionIds.length) {
    violations.push("action_count_mismatch");
  }
  if (
    state.attemptState.lastActionId !==
    (actionIds.length > 0 ? actionIds[actionIds.length - 1] : null)
  ) {
    violations.push("last_action_mismatch");
  }
  const helpRequestIds = state.attemptState.helpRequestIds;
  if (
    new Set(helpRequestIds).size !== helpRequestIds.length ||
    state.attemptState.explicitHelpRequestCount !== helpRequestIds.length
  ) {
    violations.push("help_request_history_mismatch");
  }
  if (
    state.attemptState.lastHelpRequestId !==
    (helpRequestIds.length > 0
      ? helpRequestIds[helpRequestIds.length - 1]
      : null)
  ) {
    violations.push("last_help_request_mismatch");
  }
  if (
    new Set(state.policyState.finalizedActionIds).size !==
      state.policyState.finalizedActionIds.length ||
    state.policyState.finalizedActionIds.some(
      (actionId) => !actionIds.includes(actionId),
    )
  ) {
    violations.push("invalid_finalized_policy_action");
  }
  if (
    new Set(state.policyState.finalizedHelpRequestIds).size !==
      state.policyState.finalizedHelpRequestIds.length ||
    state.policyState.finalizedHelpRequestIds.some(
      (requestId) => !helpRequestIds.includes(requestId),
    )
  ) {
    violations.push("invalid_finalized_help_request");
  }
  if (state.repeatedBlockState.stepId !== state.stepId) {
    violations.push("repeated_block_step_mismatch");
  }
  const repeatedActionIds = state.repeatedBlockState.processedActionIds;
  if (new Set(repeatedActionIds).size !== repeatedActionIds.length) {
    violations.push("duplicate_repeated_block_action");
  }
  if (
    state.repeatedBlockState.count < 0 ||
    (state.repeatedBlockState.count > 0 &&
      state.repeatedBlockState.missingRelationSignature.length === 0)
  ) {
    violations.push("invalid_repeated_block_count");
  }
  if (
    state.repeatedBlockState.lastActionId !== null &&
    !repeatedActionIds.includes(state.repeatedBlockState.lastActionId)
  ) {
    violations.push("repeated_block_last_action_mismatch");
  }
  for (const fact of state.verifiedFacts) {
    const evidence = state.evidenceById[fact.evidenceId];
    if (
      !evidence ||
      evidence.relation !== fact.relationKey ||
      evidence.revision !== state.revision ||
      evidence.snapshotHash !== state.studentSnapshotHash
    ) {
      violations.push(`fact_without_current_evidence:${fact.relationKey}`);
    }
  }
  return violations;
}

export function selectIsFloorBusy(state: PedagogyState): boolean {
  return (
    state.interaction.studentIsDragging ||
    state.interaction.studentIsSpeaking ||
    state.interaction.tutorIsSpeaking ||
    state.activeResponse !== null
  );
}

export function selectCurrentEvidence(
  state: PedagogyState,
): readonly PedagogyEvidence[] {
  return Object.values(state.evidenceById).filter(
    (evidence) =>
      evidence.revision === state.revision &&
      evidence.snapshotHash === state.studentSnapshotHash,
  );
}

export function selectHasOpenIntervention(state: PedagogyState): boolean {
  return state.pendingIntervention !== null || state.activeResponse !== null;
}

function reduceValidatedAction(
  state: PedagogyState,
  event: Extract<PedagogyEvent, { type: "validated_action_committed" }>,
): PedagogyState {
  if (event.exerciseId !== state.exerciseId || event.stepId !== state.stepId) {
    return reject(state, event, "exercise_mismatch");
  }
  if (state.attemptState.processedActionIds.includes(event.actionId)) {
    return reject(state, event, "duplicate_action");
  }
  if (event.revision <= state.revision) {
    return reject(state, event, "revision_regression");
  }
  if (
    event.snapshotHash.length === 0 ||
    event.snapshotHash === state.studentSnapshotHash
  ) {
    return reject(state, event, "invalid_payload");
  }
  if (!hasValidEvidence(event)) {
    return reject(state, event, "invalid_evidence");
  }
  if (
    event.meaningfulDelta.previousFactSignature !==
      createFactSignature(state.verifiedFacts) ||
    event.meaningfulDelta.currentFactSignature !==
      createFactSignature(event.facts) ||
    event.meaningfulDelta.factsChanged !==
      (event.meaningfulDelta.previousFactSignature !==
        event.meaningfulDelta.currentFactSignature) ||
    event.meaningfulDelta.missingRelationKeys.join("|") !==
      deriveMissingRelationKeys(event.facts).join("|") ||
    event.meaningfulDelta.constructionChanged !==
      (event.meaningfulDelta.changedStudentObjects.length > 0) ||
    (event.meaningfulDelta.isMeaningful &&
      !event.meaningfulDelta.constructionChanged &&
      !event.meaningfulDelta.factsChanged)
  ) {
    return reject(state, event, "invalid_payload");
  }
  const evidenceById = Object.fromEntries(
    event.evidence.map((evidence) => [
      evidence.id,
      { ...evidence, objects: [...evidence.objects] },
    ]),
  );
  const processedActionIds = [
    ...state.attemptState.processedActionIds,
    event.actionId,
  ];
  return transition(state, event, {
    ...state,
    revision: event.revision,
    studentSnapshotHash: event.snapshotHash,
    verifiedFacts: event.facts.map((fact) => ({ ...fact })),
    evidenceById,
    attemptState: {
      ...state.attemptState,
      actionCount: processedActionIds.length,
      lastActionId: event.actionId,
      processedActionIds,
    },
    repeatedBlockState: reduceRepeatedBlockState(state.repeatedBlockState, {
      stepId: event.stepId,
      actionId: event.actionId,
      delta: event.meaningfulDelta,
    }),
    interaction: { ...state.interaction, tutorIsSpeaking: false },
    pendingIntervention: null,
    activeResponse: null,
    activeHint: null,
  });
}

function anchorRejection(
  state: PedagogyState,
  event: Exclude<
    PedagogyEvent,
    { type: "epoch_reset" | "exercise_started" | "validated_action_committed" }
  >,
): RejectedTransitionReason | null {
  if (event.revision !== state.revision) return "stale_revision";
  if (event.snapshotHash !== state.studentSnapshotHash) {
    return "snapshot_mismatch";
  }
  return null;
}

function withInteraction(
  state: PedagogyState,
  patch: Partial<PedagogyState["interaction"]>,
): PedagogyState {
  return { ...state, interaction: { ...state.interaction, ...patch } };
}

function isInterventionCurrent(
  state: PedagogyState,
  intervention: Omit<PendingIntervention, "status">,
): boolean {
  return (
    intervention.directiveId.length > 0 &&
    intervention.baseRevision === state.revision &&
    intervention.snapshotHash === state.studentSnapshotHash
  );
}

function hasValidEvidence(
  event: Extract<PedagogyEvent, { type: "validated_action_committed" }>,
): boolean {
  if (
    event.revision < 0 ||
    event.actionId.length === 0 ||
    event.facts.length === 0 ||
    event.evidence.length === 0
  ) {
    return false;
  }
  const evidenceById = new Map(
    event.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const referencedIds = new Set(event.facts.map((fact) => fact.evidenceId));
  if (
    evidenceById.size !== event.evidence.length ||
    referencedIds.size !== event.facts.length ||
    referencedIds.size !== evidenceById.size
  ) {
    return false;
  }
  return event.facts.every((fact) => {
    const evidence = evidenceById.get(fact.evidenceId);
    return (
      fact.evidenceId.length > 0 &&
      evidence !== undefined &&
      evidence.id.length > 0 &&
      evidence.objects.length > 0 &&
      evidence.relation === fact.relationKey &&
      evidence.revision === event.revision &&
      evidence.snapshotHash === event.snapshotHash &&
      fact.status === (evidence.pass ? "verified" : "missing")
    );
  });
}

function transition(
  state: PedagogyState,
  event: PedagogyEvent,
  next: PedagogyState,
): PedagogyState {
  return getPedagogyInvariantViolations(next).length === 0
    ? next
    : reject(state, event, "invariant_violation");
}

function reject(
  state: PedagogyState,
  event: PedagogyEvent,
  reason: RejectedTransitionReason,
): PedagogyState {
  return {
    ...state,
    rejectedTransitions: [
      ...state.rejectedTransitions,
      { eventType: event.type, reason },
    ],
  };
}

function nextExplicitHelpLevel(current: HelpLevel): Exclude<HelpLevel, 0> {
  if (current <= 0) return 1;
  if (current === 1) return 2;
  if (current === 2) return 3;
  return 4;
}

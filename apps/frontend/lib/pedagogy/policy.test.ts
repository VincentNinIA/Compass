import { describe, expect, it } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import {
  createFactSignature,
  type MeaningfulDelta,
} from "./meaningful-delta";
import { decideIntervention } from "./policy";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvidence,
  type PedagogyEvent,
  type PedagogyState,
  type VerifiedFact,
} from "./state";

const PLAN = deriveExercisePlanV1({
  schemaVersion: "exercise_extraction.v1",
  outcome: "ready",
  language: "en",
  instruction: "Construct the perpendicular bisector of AB.",
  pointLabels: ["A", "B"],
  segmentEndpoints: ["A", "B"],
  requestedConstruction: "perpendicular_bisector",
  learningObjective: "perpendicular_bisector_equidistance",
  ambiguityCode: null,
  clarificationQuestion: null,
  unsupportedReason: null,
});

const STEP = "construct_perpendicular_bisector";

function actionState(input: {
  actionId?: string;
  revision?: number;
  statuses: readonly [VerifiedFact["status"], VerifiedFact["status"]];
  previousStatuses?: readonly [VerifiedFact["status"], VerifiedFact["status"]];
  meaningful?: boolean;
  previous?: PedagogyState;
}): { state: PedagogyState; delta: MeaningfulDelta } {
  const actionId = input.actionId ?? "action-1";
  const revision = input.revision ?? 1;
  const facts = factsFor(revision, input.statuses);
  const previousFacts = input.previous
    ? input.previous.verifiedFacts
    : input.previousStatuses
      ? factsFor(Math.max(0, revision - 1), input.previousStatuses)
      : [];
  const missingRelationKeys = facts
    .filter((fact) => fact.status !== "verified")
    .map((fact) => fact.relationKey)
    .sort();
  const meaningful = input.meaningful ?? true;
  const delta: MeaningfulDelta = {
    isMeaningful: meaningful,
    constructionChanged: meaningful,
    factsChanged:
      createFactSignature(previousFacts) !== createFactSignature(facts),
    changedStudentObjects: meaningful ? ["d"] : [],
    previousFactSignature: createFactSignature(previousFacts),
    currentFactSignature: createFactSignature(facts),
    missingRelationKeys,
    reason: meaningful
      ? "construction_and_facts_changed"
      : "no_semantic_change",
  };
  const event: Extract<
    PedagogyEvent,
    { type: "validated_action_committed" }
  > = {
    type: "validated_action_committed",
    epoch: 1,
    exerciseId: PLAN.exerciseId,
    stepId: STEP,
    actionId,
    revision,
    snapshotHash: `hash-${revision}`,
    facts,
    evidence: evidenceFor(revision, facts),
    meaningfulDelta: delta,
  };
  const initial =
    input.previous ?? createInitialPedagogyState(PLAN, { epoch: 1 });
  return { state: pedagogyReducer(initial, event), delta };
}

function factsFor(
  revision: number,
  statuses: readonly [VerifiedFact["status"], VerifiedFact["status"]],
): VerifiedFact[] {
  return (["perpendicular", "passes_midpoint"] as const).map(
    (relationKey, index) => ({
      relationKey,
      status: statuses[index],
      evidenceId: `evidence-${revision}-${relationKey}`,
    }),
  );
}

function evidenceFor(
  revision: number,
  facts: readonly VerifiedFact[],
): PedagogyEvidence[] {
  return facts.map((fact) => ({
    id: fact.evidenceId,
    relation: fact.relationKey,
    pass: fact.status === "verified",
    observed: fact.status === "verified" ? 0 : 1,
    tolerance: 0.000001,
    revision,
    objects: ["d", "AB"],
    snapshotHash: `hash-${revision}`,
  }));
}

function anchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

describe("T4-C03 pure intervention policy", () => {
  it("keeps the first incorrect meaningful attempt silent", () => {
    const { state, delta } = actionState({ statuses: ["missing", "missing"] });
    expect(
      decideIntervention(state, {
        type: "validated_action",
        actionId: "action-1",
        delta,
      }),
    ).toEqual({ type: "silent", reason: "first_incorrect_attempt" });
  });

  it("keeps partial progress local and silent", () => {
    const { state, delta } = actionState({ statuses: ["verified", "missing"] });
    expect(
      decideIntervention(state, {
        type: "validated_action",
        actionId: "action-1",
        delta,
      }),
    ).toEqual({ type: "silent", reason: "local_visual_progress" });
  });

  it("returns one proactive L1 reflective question after the repeated block", () => {
    const first = actionState({ statuses: ["verified", "missing"] });
    expect(
      decideIntervention(first.state, {
        type: "validated_action",
        actionId: "action-1",
        delta: first.delta,
      }),
    ).toEqual({ type: "silent", reason: "local_visual_progress" });
    const second = actionState({
      actionId: "action-2",
      revision: 2,
      statuses: ["verified", "missing"],
      previous: first.state,
    });
    expect(
      decideIntervention(second.state, {
        type: "validated_action",
        actionId: "action-2",
        delta: second.delta,
      }),
    ).toEqual({
      type: "speak",
      reason: "repeated_block",
      directiveDraft: {
        kind: "proactive",
        sourceActionId: "action-2",
        sourceRequestId: null,
        helpLevel: 1,
        goal: "ask_reflective_question",
        allowedTools: [],
      },
    });
  });

  it.each([
    ["student drag", { studentIsDragging: true }],
    ["student speech", { studentIsSpeaking: true }],
    ["tutor response", { tutorIsSpeaking: true }],
  ] as const)("queues a speak intent when the floor is occupied by %s", (_, patch) => {
    const first = actionState({ statuses: ["verified", "missing"] });
    const second = actionState({
      actionId: "action-2",
      revision: 2,
      statuses: ["verified", "missing"],
      previous: first.state,
    });
    const busy: PedagogyState = {
      ...second.state,
      interaction: { ...second.state.interaction, ...patch },
      activeResponse:
        "tutorIsSpeaking" in patch && patch.tutorIsSpeaking
        ? { responseId: "response-1", directiveId: null }
        : null,
    };
    const decision = decideIntervention(busy, {
      type: "validated_action",
      actionId: "action-2",
      delta: second.delta,
    });
    expect(decision).toMatchObject({
      type: "queue",
      reason: "floor_busy",
      candidate: { businessReason: "repeated_block", helpLevel: 1 },
    });
  });

  it("does not finalize QUEUE and re-evaluates it against current state", () => {
    const first = actionState({ statuses: ["verified", "missing"] });
    const second = actionState({
      actionId: "action-2",
      revision: 2,
      statuses: ["verified", "missing"],
      previous: first.state,
    });
    const busy = pedagogyReducer(second.state, {
      type: "student_drag_started",
      ...anchor(second.state),
    });
    expect(
      decideIntervention(busy, {
        type: "validated_action",
        actionId: "action-2",
        delta: second.delta,
      }).type,
    ).toBe("queue");
    const queued = pedagogyReducer(busy, {
      type: "policy_evaluated",
      decision: "QUEUE",
      sourceActionId: "action-2",
      sourceRequestId: null,
      ...anchor(busy),
    });
    expect(queued.policyState.finalizedActionIds).toEqual([]);
    const idle = pedagogyReducer(queued, {
      type: "student_drag_ended",
      ...anchor(queued),
    });
    expect(
      decideIntervention(idle, {
        type: "validated_action",
        actionId: "action-2",
        delta: second.delta,
      }).type,
    ).toBe("speak");
  });

  it("finalizes a source action once and rejects duplicate re-evaluation", () => {
    const first = actionState({ statuses: ["verified", "missing"] });
    const second = actionState({
      actionId: "action-2",
      revision: 2,
      statuses: ["verified", "missing"],
      previous: first.state,
    });
    const finalized = pedagogyReducer(second.state, {
      type: "policy_evaluated",
      decision: "SPEAK",
      sourceActionId: "action-2",
      sourceRequestId: null,
      ...anchor(second.state),
    });
    expect(
      decideIntervention(finalized, {
        type: "validated_action",
        actionId: "action-2",
        delta: second.delta,
      }),
    ).toEqual({
      type: "silent",
      reason: "invalid_or_duplicate_context",
    });
  });

  it("prioritizes explicit help while keeping C03 assistance at L1", () => {
    const current = actionState({ statuses: ["verified", "missing"] }).state;
    const requested = pedagogyReducer(current, {
      type: "explicit_help_requested",
      requestId: "help-1",
      ...anchor(current),
    });
    expect(
      decideIntervention(requested, {
        type: "explicit_help",
        requestId: "help-1",
      }),
    ).toMatchObject({
      type: "speak",
      reason: "explicit_help_requested",
      directiveDraft: { kind: "explicit", helpLevel: 1 },
    });
  });

  it("prioritizes verified completion over an explicit help request", () => {
    const complete = actionState({ statuses: ["verified", "verified"] }).state;
    const requested = pedagogyReducer(complete, {
      type: "explicit_help_requested",
      requestId: "help-complete",
      ...anchor(complete),
    });

    expect(
      decideIntervention(requested, {
        type: "explicit_help",
        requestId: "help-complete",
      }),
    ).toMatchObject({
      type: "speak",
      reason: "step_completed",
      directiveDraft: { kind: "completion", helpLevel: 1 },
    });
  });

  it.each([
    ["explicit help", "explicit_help_requested"],
    ["verified completion", "step_completed"],
  ] as const)("queues %s while the student is speaking", (kind, reason) => {
    const current = actionState({
      statuses:
        kind === "verified completion"
          ? ["verified", "verified"]
          : ["verified", "missing"],
    }).state;
    const requested = pedagogyReducer(current, {
      type: "explicit_help_requested",
      requestId: `help-${kind}`,
      ...anchor(current),
    });
    const busy = pedagogyReducer(requested, {
      type: "student_speech_started",
      ...anchor(requested),
    });

    expect(
      decideIntervention(busy, {
        type: "explicit_help",
        requestId: `help-${kind}`,
      }),
    ).toMatchObject({
      type: "queue",
      reason: "floor_busy",
      candidate: { businessReason: reason },
    });
  });

  it("rejects an explicit help request after its policy decision is final", () => {
    const current = actionState({ statuses: ["verified", "missing"] }).state;
    const requested = pedagogyReducer(current, {
      type: "explicit_help_requested",
      requestId: "help-once",
      ...anchor(current),
    });
    const finalized = pedagogyReducer(requested, {
      type: "policy_evaluated",
      decision: "SPEAK",
      sourceActionId: null,
      sourceRequestId: "help-once",
      ...anchor(requested),
    });

    expect(
      decideIntervention(finalized, {
        type: "explicit_help",
        requestId: "help-once",
      }),
    ).toEqual({
      type: "silent",
      reason: "invalid_or_duplicate_context",
    });
  });

  it("prioritizes verified completion and asks for explanation", () => {
    const first = actionState({ statuses: ["verified", "missing"] });
    const complete = actionState({
      actionId: "action-2",
      revision: 2,
      statuses: ["verified", "verified"],
      previous: first.state,
    });
    expect(
      decideIntervention(complete.state, {
        type: "validated_action",
        actionId: "action-2",
        delta: complete.delta,
      }),
    ).toMatchObject({
      type: "speak",
      reason: "step_completed",
      directiveDraft: { kind: "completion" },
    });
  });

  it("stays silent for no delta regardless of elapsed wall time", () => {
    const { state, delta } = actionState({
      statuses: ["missing", "missing"],
      meaningful: false,
    });
    const originalDateNow = Date.now;
    Date.now = () => Number.MAX_SAFE_INTEGER;
    try {
      expect(
        decideIntervention(state, {
          type: "validated_action",
          actionId: "action-1",
          delta,
        }),
      ).toEqual({ type: "silent", reason: "no_meaningful_delta" });
    } finally {
      Date.now = originalDateNow;
    }
  });

  it.each([
    { name: "unknown action", actionId: "unknown", mutate: (state: PedagogyState) => state },
    {
      name: "stale action",
      actionId: "action-1",
      mutate: (state: PedagogyState) => ({
        ...state,
        attemptState: { ...state.attemptState, lastActionId: "newer" },
      }),
    },
  ])("fails silent for $name", ({ actionId, mutate }) => {
    const current = actionState({ statuses: ["missing", "missing"] });
    expect(
      decideIntervention(mutate(current.state), {
        type: "validated_action",
        actionId,
        delta: current.delta,
      }),
    ).toEqual({
      type: "silent",
      reason: "invalid_or_duplicate_context",
    });
  });

  it("fails closed when current fact evidence is incomplete", () => {
    const current = actionState({ statuses: ["verified", "missing"] });
    const [removedEvidenceId] = Object.keys(current.state.evidenceById);
    const evidenceById = { ...current.state.evidenceById };
    delete evidenceById[removedEvidenceId];

    expect(
      decideIntervention(
        { ...current.state, evidenceById },
        {
          type: "validated_action",
          actionId: "action-1",
          delta: current.delta,
        },
      ),
    ).toEqual({
      type: "silent",
      reason: "invalid_or_duplicate_context",
    });
  });
});

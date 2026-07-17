import { describe, expect, it } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import {
  createInitialPedagogyState,
  getPedagogyInvariantViolations,
  pedagogyReducer,
  selectCurrentEvidence,
  selectHasOpenIntervention,
  selectIsFloorBusy,
  type PedagogyEvent,
  type PedagogyEvidence,
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

const EVIDENCE: readonly PedagogyEvidence[] = [
  {
    id: "ev-perpendicular-r1",
    relation: "perpendicular",
    pass: true,
    observed: 1,
    tolerance: 0,
    revision: 1,
    objects: ["d", "AB"],
    snapshotHash: "hash-r1",
  },
  {
    id: "ev-midpoint-r1",
    relation: "passes_midpoint",
    pass: false,
    observed: 1,
    tolerance: 0.000001,
    revision: 1,
    objects: ["d", "A", "B"],
    snapshotHash: "hash-r1",
  },
] as const;

const FACTS: readonly VerifiedFact[] = [
  {
    relationKey: "perpendicular",
    status: "verified",
    evidenceId: "ev-perpendicular-r1",
  },
  {
    relationKey: "passes_midpoint",
    status: "missing",
    evidenceId: "ev-midpoint-r1",
  },
] as const;

const STEP_ID = "construct_perpendicular_bisector";

function anchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

function validatedAction(
  overrides: Partial<
    Extract<PedagogyEvent, { type: "validated_action_committed" }>
  > = {},
): Extract<PedagogyEvent, { type: "validated_action_committed" }> {
  return {
    type: "validated_action_committed",
    epoch: 1,
    exerciseId: PLAN.exerciseId,
    stepId: STEP_ID,
    actionId: "action-1",
    revision: 1,
    snapshotHash: "hash-r1",
    facts: FACTS,
    evidence: EVIDENCE,
    meaningfulDelta: {
      isMeaningful: true,
      constructionChanged: true,
      factsChanged: true,
      changedStudentObjects: ["d"],
      previousFactSignature: "",
      currentFactSignature:
        "passes_midpoint:missing|perpendicular:verified",
      missingRelationKeys: ["passes_midpoint"],
      reason: "construction_and_facts_changed",
    },
    ...overrides,
  };
}

function validatedState(): PedagogyState {
  return pedagogyReducer(
    createInitialPedagogyState(PLAN, { epoch: 1 }),
    validatedAction(),
  );
}

describe("T4-C01 pedagogy reducer", () => {
  it("is deterministic for a complete event sequence", () => {
    const initial = validatedState();
    const a = anchor(initial);
    const events: PedagogyEvent[] = [
      { type: "explicit_help_requested", requestId: "help-1", ...a },
      {
        type: "policy_evaluated",
        decision: "QUEUE",
        sourceActionId: "action-1",
        sourceRequestId: null,
        ...a,
      },
      {
        type: "directive_queued",
        intervention: {
          directiveId: "directive-1",
          sourceActionId: "action-1",
          baseRevision: 1,
          snapshotHash: "hash-r1",
        },
        ...a,
      },
      { type: "directive_dispatched", directiveId: "directive-1", ...a },
      {
        type: "response_started",
        responseId: "response-1",
        directiveId: "directive-1",
        ...a,
      },
      { type: "response_finished", responseId: "response-1", ...a },
    ];
    const reduce = () => events.reduce(pedagogyReducer, initial);
    expect(JSON.stringify(reduce())).toBe(JSON.stringify(reduce()));
    expect(getPedagogyInvariantViolations(reduce())).toEqual([]);
  });

  it("commits revision, hash, facts and deep-copied evidence atomically", () => {
    const initial = createInitialPedagogyState(PLAN, { epoch: 1 });
    const mutableObjects = ["d", "AB"];
    const event = validatedAction({
      evidence: [{ ...EVIDENCE[0], objects: mutableObjects }, EVIDENCE[1]],
    });
    const before = structuredClone(initial);
    const next = pedagogyReducer(initial, event);
    mutableObjects.push("mutated-after-reduce");

    expect(initial).toEqual(before);
    expect(next.revision).toBe(1);
    expect(next.studentSnapshotHash).toBe("hash-r1");
    expect(next.verifiedFacts).toEqual(FACTS);
    expect(selectCurrentEvidence(next)).toHaveLength(2);
    expect(next.evidenceById["ev-perpendicular-r1"].objects).toEqual(["d", "AB"]);
  });

  it.each([
    ["old epoch", validatedAction({ epoch: 0 }), "stale_epoch"],
    ["equal revision", validatedAction({ actionId: "action-2" }), "revision_regression"],
    [
      "same hash at a newer revision",
      validatedAction({ actionId: "action-2", revision: 2 }),
      "invalid_payload",
    ],
    [
      "missing evidence",
      validatedAction({
        actionId: "action-2",
        revision: 2,
        snapshotHash: "hash-r2",
        facts: [{ ...FACTS[0], evidenceId: "absent" }],
      }),
      "invalid_evidence",
    ],
    [
      "unreferenced extra evidence",
      validatedAction({
        actionId: "action-2",
        revision: 2,
        snapshotHash: "hash-r2",
        evidence: [
          ...EVIDENCE.map((evidence) => ({
            ...evidence,
            revision: 2,
            snapshotHash: "hash-r2",
          })),
          {
            ...EVIDENCE[0],
            id: "extra",
            revision: 2,
            snapshotHash: "hash-r2",
          },
        ],
      }),
      "invalid_evidence",
    ],
  ] as const)("rejects %s without changing current facts", (_, event, reason) => {
    const current = validatedState();
    const next = pedagogyReducer(current, event);
    expect(next.revision).toBe(current.revision);
    expect(next.studentSnapshotHash).toBe(current.studentSnapshotHash);
    expect(next.verifiedFacts).toEqual(current.verifiedFacts);
    expect(next.rejectedTransitions.at(-1)).toEqual({
      eventType: event.type,
      reason,
    });
  });

  it("deduplicates every processed action id, including A to B to A", () => {
    const first = validatedState();
    const evidenceR2 = EVIDENCE.map((evidence) => ({
      ...evidence,
      id: `${evidence.id}-r2`,
      revision: 2,
      snapshotHash: "hash-r2",
    }));
    const factsR2 = FACTS.map((fact, index) => ({
      ...fact,
      evidenceId: evidenceR2[index].id,
    }));
    const second = pedagogyReducer(
      first,
      validatedAction({
        actionId: "action-2",
        revision: 2,
        snapshotHash: "hash-r2",
        facts: factsR2,
        evidence: evidenceR2,
        meaningfulDelta: {
          ...validatedAction().meaningfulDelta,
          factsChanged: false,
          previousFactSignature:
            "passes_midpoint:missing|perpendicular:verified",
          reason: "student_construction_changed",
        },
      }),
    );
    const repeated = pedagogyReducer(
      second,
      validatedAction({
        actionId: "action-1",
        revision: 3,
        snapshotHash: "hash-r3",
      }),
    );
    expect(second.attemptState.processedActionIds).toEqual(["action-1", "action-2"]);
    expect(repeated.attemptState.actionCount).toBe(2);
    expect(repeated.rejectedTransitions.at(-1)?.reason).toBe("duplicate_action");
  });

  it("makes exercise_started idempotent and forbids same-epoch reset/regression", () => {
    const current = validatedState();
    const same = pedagogyReducer(current, {
      type: "exercise_started",
      plan: PLAN,
      stepId: STEP_ID,
      ...anchor(current),
    });
    const resetAttempt = pedagogyReducer(current, {
      type: "exercise_started",
      plan: PLAN,
      stepId: STEP_ID,
      epoch: 1,
      revision: 0,
      snapshotHash: "",
    });
    expect(same).toBe(current);
    expect(resetAttempt.revision).toBe(1);
    expect(resetAttempt.rejectedTransitions.at(-1)?.reason).toBe("revision_regression");
  });

  it("rejects stale revision/hash anchors and out-of-order interaction endings", () => {
    const current = validatedState();
    const staleRevision = pedagogyReducer(current, {
      type: "student_drag_started",
      epoch: 1,
      revision: 0,
      snapshotHash: "hash-r1",
    });
    const staleHash = pedagogyReducer(current, {
      type: "student_drag_started",
      epoch: 1,
      revision: 1,
      snapshotHash: "old-hash",
    });
    const outOfOrder = pedagogyReducer(current, {
      type: "student_drag_ended",
      ...anchor(current),
    });
    expect(staleRevision.rejectedTransitions.at(-1)?.reason).toBe("stale_revision");
    expect(staleHash.rejectedTransitions.at(-1)?.reason).toBe("snapshot_mismatch");
    expect(outOfOrder.rejectedTransitions.at(-1)?.reason).toBe("invalid_payload");
  });

  it("tracks drag and speech start/end without repeated transitions", () => {
    const initial = validatedState();
    const dragging = pedagogyReducer(initial, {
      type: "student_drag_started",
      ...anchor(initial),
    });
    const speaking = pedagogyReducer(dragging, {
      type: "student_speech_started",
      ...anchor(dragging),
    });
    const endingEvents: PedagogyEvent[] = [
      { type: "student_drag_ended", ...anchor(speaking) },
      { type: "student_speech_ended", ...anchor(speaking) },
    ];
    const ended = endingEvents.reduce(pedagogyReducer, speaking);
    expect(selectIsFloorBusy(dragging)).toBe(true);
    expect(speaking.interaction.studentIsSpeaking).toBe(true);
    expect(selectIsFloorBusy(ended)).toBe(false);
  });

  it("requires a directive to be dispatched before response start", () => {
    const current = validatedState();
    const queued = pedagogyReducer(current, {
      type: "directive_queued",
      intervention: {
        directiveId: "directive-1",
        sourceActionId: "action-1",
        baseRevision: 1,
        snapshotHash: "hash-r1",
      },
      ...anchor(current),
    });
    const tooSoon = pedagogyReducer(queued, {
      type: "response_started",
      responseId: "response-1",
      directiveId: "directive-1",
      ...anchor(queued),
    });
    const dispatched = pedagogyReducer(queued, {
      type: "directive_dispatched",
      directiveId: "directive-1",
      ...anchor(queued),
    });
    const active = pedagogyReducer(dispatched, {
      type: "response_started",
      responseId: "response-1",
      directiveId: "directive-1",
      ...anchor(dispatched),
    });
    expect(tooSoon.activeResponse).toBeNull();
    expect(tooSoon.rejectedTransitions.at(-1)?.reason).toBe("directive_mismatch");
    expect(active.pendingIntervention).toBeNull();
    expect(active.activeResponse?.responseId).toBe("response-1");
  });

  it("forbids an explicit response while a directive is pending", () => {
    const current = validatedState();
    const queued = pedagogyReducer(current, {
      type: "directive_queued",
      intervention: {
        directiveId: "directive-1",
        sourceActionId: "action-1",
        baseRevision: 1,
        snapshotHash: "hash-r1",
      },
      ...anchor(current),
    });
    const rejected = pedagogyReducer(queued, {
      type: "response_started",
      responseId: "explicit-response",
      ...anchor(queued),
    });
    expect(rejected.pendingIntervention).not.toBeNull();
    expect(rejected.activeResponse).toBeNull();
    expect(rejected.rejectedTransitions.at(-1)?.reason).toBe(
      "pending_intervention_exists",
    );
  });

  it.each(["response_finished", "response_cancelled", "response_failed"] as const)(
    "closes the matching response with %s and rejects a duplicate terminal",
    (type) => {
      const current = validatedState();
      const active = pedagogyReducer(current, {
        type: "response_started",
        responseId: "response-1",
        ...anchor(current),
      });
      const closed = pedagogyReducer(active, {
        type,
        responseId: "response-1",
        ...anchor(active),
      });
      const duplicate = pedagogyReducer(closed, {
        type,
        responseId: "response-1",
        ...anchor(closed),
      });
      expect(closed.activeResponse).toBeNull();
      expect(closed.interaction.tutorIsSpeaking).toBe(false);
      expect(duplicate.rejectedTransitions.at(-1)?.reason).toBe("response_mismatch");
    },
  );

  it("invalidates only the matching pending directive", () => {
    const current = validatedState();
    const queued = pedagogyReducer(current, {
      type: "directive_queued",
      intervention: {
        directiveId: "directive-1",
        sourceActionId: "action-1",
        baseRevision: 1,
        snapshotHash: "hash-r1",
      },
      ...anchor(current),
    });
    const wrong = pedagogyReducer(queued, {
      type: "directive_invalidated",
      directiveId: "other",
      ...anchor(queued),
    });
    const cleared = pedagogyReducer(queued, {
      type: "directive_invalidated",
      directiveId: "directive-1",
      ...anchor(queued),
    });
    expect(wrong.pendingIntervention).not.toBeNull();
    expect(cleared.pendingIntervention).toBeNull();
    expect(selectHasOpenIntervention(cleared)).toBe(false);
  });

  it("applies and restores one matching hint", () => {
    const current = validatedState();
    const applied = pedagogyReducer(current, {
      type: "hint_applied",
      hintId: "hint-1",
      level: 3,
      ...anchor(current),
    });
    const wrong = pedagogyReducer(applied, {
      type: "hint_restored",
      hintId: "other",
      ...anchor(applied),
    });
    const restored = pedagogyReducer(applied, {
      type: "hint_restored",
      hintId: "hint-1",
      ...anchor(applied),
    });
    expect(applied.helpLevel).toBe(0);
    expect(wrong.activeHint?.hintId).toBe("hint-1");
    expect(restored.activeHint).toBeNull();
  });

  it("resets into a higher epoch and ignores every late event", () => {
    const current = validatedState();
    const reset = pedagogyReducer(current, {
      type: "epoch_reset",
      epoch: 2,
      plan: PLAN,
      stepId: STEP_ID,
      revision: 0,
      snapshotHash: "reset-hash",
    });
    const late = pedagogyReducer(reset, {
      type: "response_started",
      epoch: 1,
      revision: 1,
      snapshotHash: "hash-r1",
      responseId: "late-response",
    });
    expect(reset).toMatchObject({
      epoch: 2,
      revision: 0,
      studentSnapshotHash: "reset-hash",
      pendingIntervention: null,
      activeResponse: null,
      helpLevel: 0,
    });
    expect(late.activeResponse).toBeNull();
    expect(late.rejectedTransitions).toEqual([
      { eventType: "response_started", reason: "stale_epoch" },
    ]);
  });

  it("reports explicit invariant violations for externally corrupted state", () => {
    const current = validatedState();
    const corrupted: PedagogyState = {
      ...current,
      interaction: { ...current.interaction, tutorIsSpeaking: true },
      attemptState: {
        ...current.attemptState,
        actionCount: 2,
        processedActionIds: ["action-1", "action-1"],
      },
    };
    expect(getPedagogyInvariantViolations(corrupted)).toEqual(
      expect.arrayContaining([
        "tutor_speech_without_active_response",
        "duplicate_processed_action",
      ]),
    );
  });
});

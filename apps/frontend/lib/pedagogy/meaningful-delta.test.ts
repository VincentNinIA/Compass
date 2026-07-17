import { describe, expect, it } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import type {
  CompletedConstructionAction,
  ConstructionSnapshot,
  RelationEvidence,
  SceneObjectOwner,
  SnapshotObject,
} from "@/types/geogebra";
import {
  createFactSignature,
  createMissingRelationSignature,
  createRepeatedBlockState,
  deriveMeaningfulDelta,
  deriveMissingRelationKeys,
  reduceRepeatedBlockState,
  type FactForDelta,
  type MeaningfulDelta,
} from "./meaningful-delta";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvidence,
  type PedagogyEvent,
  type VerifiedFact,
} from "./state";

const FACTS_MISSING: readonly FactForDelta[] = [
  { relationKey: "perpendicular", status: "verified" },
  { relationKey: "passes_midpoint", status: "missing" },
];

const EXERCISE_OBJECT = object(
  "AB",
  "exercise",
  "Segment(A,B)",
  "segment",
);
const STUDENT_LINE = object("d", "student", "x=1", "line");

function object(
  name: string,
  owner: SceneObjectOwner,
  command: string,
  kind: SnapshotObject["kind"] = "point",
): SnapshotObject {
  return { name, owner, command, kind };
}

function snapshot(
  revision: number,
  hash: string,
  objects: SnapshotObject[],
  complete = true,
): ConstructionSnapshot {
  return { revision, hash, objects, complete };
}

function action(
  current: ConstructionSnapshot,
  overrides: Partial<CompletedConstructionAction> = {},
): CompletedConstructionAction {
  return {
    id: "action-1",
    kind: "drag",
    affectedNames: ["d"],
    studentAffectedNames: ["d"],
    revision: current.revision,
    snapshotHash: current.hash,
    ...overrides,
  };
}

function deltaFor(
  previousSnapshot: ConstructionSnapshot,
  currentSnapshot: ConstructionSnapshot,
  overrides: {
    action?: Partial<CompletedConstructionAction>;
    previousFacts?: readonly FactForDelta[];
    currentFacts?: readonly FactForDelta[];
  } = {},
) {
  return deriveMeaningfulDelta({
    action: action(currentSnapshot, overrides.action),
    previousSnapshot,
    currentSnapshot,
    previousFacts: overrides.previousFacts ?? FACTS_MISSING,
    currentFacts: overrides.currentFacts ?? FACTS_MISSING,
  });
}

describe("T4-C02 meaningful delta", () => {
  it.each([
    {
      name: "add",
      before: snapshot(1, "before", [EXERCISE_OBJECT]),
      after: snapshot(2, "after", [EXERCISE_OBJECT, STUDENT_LINE]),
      action: { kind: "add" as const },
    },
    {
      name: "remove",
      before: snapshot(1, "before", [EXERCISE_OBJECT, STUDENT_LINE]),
      after: snapshot(2, "after", [EXERCISE_OBJECT]),
      action: { kind: "remove" as const },
    },
    {
      name: "drag",
      before: snapshot(1, "before", [EXERCISE_OBJECT, STUDENT_LINE]),
      after: snapshot(2, "after", [
        EXERCISE_OBJECT,
        { ...STUDENT_LINE, command: "x=2" },
      ]),
      action: { kind: "drag" as const },
    },
  ])("detects a student $name by canonical object diff", (fixture) => {
    const delta = deltaFor(fixture.before, fixture.after, {
      action: fixture.action,
    });
    expect(delta).toMatchObject({
      isMeaningful: true,
      constructionChanged: true,
      factsChanged: false,
      changedStudentObjects: ["d"],
      reason: "student_construction_changed",
    });
  });

  it("filters canonical numeric noise below the T1 threshold", () => {
    const before = snapshot(1, "raw-before", [
      EXERCISE_OBJECT,
      { ...STUDENT_LINE, command: "x=2.00000000001" },
    ]);
    const after = snapshot(2, "raw-after", [
      EXERCISE_OBJECT,
      { ...STUDENT_LINE, command: "x=2.00000000002" },
    ]);
    expect(deltaFor(before, after)).toMatchObject({
      isMeaningful: false,
      constructionChanged: false,
      factsChanged: false,
      reason: "no_semantic_change",
    });
  });

  it("filters hint/temporary and exercise-only mutations", () => {
    const before = snapshot(1, "before", [EXERCISE_OBJECT, STUDENT_LINE]);
    const withHint = snapshot(2, "hint", [
      EXERCISE_OBJECT,
      STUDENT_LINE,
      object("gtHint1", "temporary", "Midpoint(A,B)"),
    ]);
    const hint = deltaFor(before, withHint, {
      action: {
        kind: "add",
        affectedNames: ["gtHint1"],
        studentAffectedNames: [],
      },
    });
    const exerciseChanged = snapshot(2, "exercise", [
      { ...EXERCISE_OBJECT, command: "Segment(B,A)" },
      STUDENT_LINE,
    ]);
    const exercise = deltaFor(before, exerciseChanged, {
      action: { affectedNames: ["AB"], studentAffectedNames: [] },
    });
    expect(hint).toMatchObject({
      isMeaningful: false,
      changedStudentObjects: [],
      reason: "non_student_change",
    });
    expect(exercise).toMatchObject({
      isMeaningful: false,
      changedStudentObjects: [],
      reason: "non_student_change",
    });
  });

  it.each([
    [
      "incomplete snapshot",
      snapshot(1, "before", [STUDENT_LINE], false),
      snapshot(2, "after", [STUDENT_LINE]),
      {},
      "snapshot_unstable",
    ],
    [
      "action/snapshot mismatch",
      snapshot(1, "before", [STUDENT_LINE]),
      snapshot(2, "after", [{ ...STUDENT_LINE, command: "x=2" }]),
      { snapshotHash: "stale" },
      "action_snapshot_mismatch",
    ],
    [
      "missing ownership",
      snapshot(1, "before", [STUDENT_LINE]),
      snapshot(2, "after", [{ ...STUDENT_LINE, command: "x=2" }]),
      { affectedNames: ["ghost"], studentAffectedNames: [] },
      "ownership_missing",
    ],
    [
      "forged student ownership",
      snapshot(1, "before", [EXERCISE_OBJECT, STUDENT_LINE]),
      snapshot(2, "after", [EXERCISE_OBJECT, STUDENT_LINE]),
      { affectedNames: ["AB"], studentAffectedNames: ["AB"] },
      "ownership_missing",
    ],
  ])("fails closed for %s", (_, before, after, actionOverride, reason) => {
    expect(
      deltaFor(before, after, { action: { ...actionOverride } }),
    ).toMatchObject({ isMeaningful: false, reason });
  });

  it("fails closed when deterministic facts are unavailable", () => {
    const before = snapshot(1, "before", [STUDENT_LINE]);
    const after = snapshot(2, "after", [{ ...STUDENT_LINE, command: "x=2" }]);
    expect(deltaFor(before, after, { currentFacts: [] })).toMatchObject({
      isMeaningful: false,
      reason: "facts_unavailable",
    });
  });

  it("detects a facts-only change and ignores evidence identity/order", () => {
    const before = snapshot(1, "same", [STUDENT_LINE]);
    const after = snapshot(2, "same", [STUDENT_LINE]);
    const currentFacts: readonly FactForDelta[] = [
      { relationKey: "passes_midpoint", status: "verified" },
      { relationKey: "perpendicular", status: "verified" },
    ];
    const delta = deltaFor(before, after, { currentFacts });
    expect(delta).toMatchObject({
      isMeaningful: true,
      constructionChanged: false,
      factsChanged: true,
      missingRelationKeys: [],
      reason: "facts_changed",
    });
    expect(createFactSignature(currentFacts)).toBe(
      "passes_midpoint:verified|perpendicular:verified",
    );
  });

  it("sorts and deduplicates missing/unknown relation keys", () => {
    const facts: readonly FactForDelta[] = [
      { relationKey: "zeta", status: "unknown" },
      { relationKey: "alpha", status: "missing" },
      { relationKey: "alpha", status: "unknown" },
      { relationKey: "done", status: "verified" },
    ];
    expect(deriveMissingRelationKeys(facts)).toEqual(["alpha", "zeta"]);
    expect(createMissingRelationSignature(["zeta", "alpha", "alpha"])).toBe(
      "alpha|zeta",
    );
  });
});

function repeatedDelta(
  missingRelationKeys: readonly string[],
  isMeaningful = true,
): MeaningfulDelta {
  return {
    isMeaningful,
    constructionChanged: isMeaningful,
    factsChanged: false,
    changedStudentObjects: isMeaningful ? ["d"] : [],
    previousFactSignature: "",
    currentFactSignature: "",
    missingRelationKeys,
    reason: isMeaningful
      ? "student_construction_changed"
      : "no_semantic_change",
  };
}

describe("T4-C02 repeated block state", () => {
  it("counts the same sorted missing signature after two meaningful actions", () => {
    const initial = createRepeatedBlockState("step-1");
    const first = reduceRepeatedBlockState(initial, {
      stepId: "step-1",
      actionId: "action-1",
      delta: repeatedDelta(["b", "a"]),
    });
    const second = reduceRepeatedBlockState(first, {
      stepId: "step-1",
      actionId: "action-2",
      delta: repeatedDelta(["a", "b"]),
    });
    expect(first).toMatchObject({ missingRelationSignature: "a|b", count: 1 });
    expect(second).toMatchObject({
      missingRelationSignature: "a|b",
      count: 2,
      lastActionId: "action-2",
    });
  });

  it("is idempotent for every action id, including A then B then A", () => {
    const initial = createRepeatedBlockState("step-1");
    const first = reduceRepeatedBlockState(initial, {
      stepId: "step-1",
      actionId: "A",
      delta: repeatedDelta(["missing"]),
    });
    const second = reduceRepeatedBlockState(first, {
      stepId: "step-1",
      actionId: "B",
      delta: repeatedDelta(["missing"]),
    });
    const duplicate = reduceRepeatedBlockState(second, {
      stepId: "step-1",
      actionId: "A",
      delta: repeatedDelta(["missing"]),
    });
    expect(duplicate).toBe(second);
    expect(duplicate.count).toBe(2);
    expect(duplicate.processedActionIds).toEqual(["A", "B"]);
  });

  it("does not count noise, resets a changed signature to one, and success to zero", () => {
    const first = reduceRepeatedBlockState(createRepeatedBlockState("step-1"), {
      stepId: "step-1",
      actionId: "action-1",
      delta: repeatedDelta(["a"]),
    });
    const noise = reduceRepeatedBlockState(first, {
      stepId: "step-1",
      actionId: "noise",
      delta: repeatedDelta(["a"], false),
    });
    const changed = reduceRepeatedBlockState(noise, {
      stepId: "step-1",
      actionId: "action-2",
      delta: repeatedDelta(["b"]),
    });
    const unavailable = reduceRepeatedBlockState(changed, {
      stepId: "step-1",
      actionId: "unavailable",
      delta: {
        ...repeatedDelta([], false),
        reason: "facts_unavailable",
      },
    });
    const success = reduceRepeatedBlockState(unavailable, {
      stepId: "step-1",
      actionId: "action-3",
      delta: repeatedDelta([]),
    });
    expect(noise.count).toBe(1);
    expect(changed).toMatchObject({ missingRelationSignature: "b", count: 1 });
    expect(unavailable.count).toBe(1);
    expect(success).toMatchObject({ missingRelationSignature: "", count: 0 });
  });

  it("resets history when the step changes", () => {
    const first = reduceRepeatedBlockState(createRepeatedBlockState("step-1"), {
      stepId: "step-1",
      actionId: "same-id",
      delta: repeatedDelta(["missing"]),
    });
    const nextStep = reduceRepeatedBlockState(first, {
      stepId: "step-2",
      actionId: "same-id",
      delta: repeatedDelta(["other"]),
    });
    expect(nextStep).toMatchObject({
      stepId: "step-2",
      missingRelationSignature: "other",
      count: 1,
      processedActionIds: ["same-id"],
    });
  });
});

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

function committedEvent(
  actionId: string,
  revision: number,
  missingRelations: readonly RelationEvidence["relation"][],
): Extract<PedagogyEvent, { type: "validated_action_committed" }> {
  const relations: readonly RelationEvidence["relation"][] = [
    "perpendicular",
    "passes_midpoint",
  ];
  const facts: VerifiedFact[] = relations.map((relationKey) => ({
    relationKey,
    status: missingRelations.includes(relationKey) ? "missing" : "verified",
    evidenceId: `evidence-${revision}-${relationKey}`,
  }));
  const evidence: PedagogyEvidence[] = facts.map((fact) => ({
    id: fact.evidenceId,
    relation: fact.relationKey,
    pass: fact.status === "verified",
    observed: fact.status === "verified" ? 0 : 1,
    tolerance: 0.000001,
    revision,
    objects: ["d", "AB"],
    snapshotHash: `hash-${revision}`,
  }));
  const currentFactSignature = createFactSignature(facts);
  const previousFactSignature =
    revision === 1
      ? ""
      : missingRelations.length === 0
        ? createFactSignature(FACTS_MISSING)
        : currentFactSignature;
  return {
    type: "validated_action_committed",
    epoch: 1,
    exerciseId: PLAN.exerciseId,
    stepId: "construct_perpendicular_bisector",
    actionId,
    revision,
    snapshotHash: `hash-${revision}`,
    facts,
    evidence,
    meaningfulDelta: {
      ...repeatedDelta(missingRelations),
      factsChanged: previousFactSignature !== currentFactSignature,
      previousFactSignature,
      currentFactSignature,
      missingRelationKeys: [...missingRelations].sort(),
    },
  };
}

describe("T4-C02 reducer integration", () => {
  it("increments once per meaningful validated action and resets on success/epoch", () => {
    const initial = createInitialPedagogyState(PLAN, { epoch: 1 });
    const firstEvent = committedEvent("action-1", 1, ["passes_midpoint"]);
    const first = pedagogyReducer(initial, firstEvent);
    const second = pedagogyReducer(
      first,
      committedEvent("action-2", 2, ["passes_midpoint"]),
    );
    const duplicate = pedagogyReducer(
      second,
      committedEvent("action-1", 3, ["passes_midpoint"]),
    );
    const success = pedagogyReducer(
      second,
      committedEvent("action-3", 3, []),
    );
    const reset = pedagogyReducer(success, {
      type: "epoch_reset",
      epoch: 2,
      plan: PLAN,
      stepId: "construct_perpendicular_bisector",
      revision: 0,
      snapshotHash: "reset",
    });

    expect(first.repeatedBlockState.count).toBe(1);
    expect(second.repeatedBlockState.count).toBe(2);
    expect(duplicate.repeatedBlockState.count).toBe(2);
    expect(duplicate.rejectedTransitions.at(-1)?.reason).toBe("duplicate_action");
    expect(success.repeatedBlockState.count).toBe(0);
    expect(reset.repeatedBlockState).toEqual(
      createRepeatedBlockState("construct_perpendicular_bisector"),
    );
  });
});

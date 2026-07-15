import { expect, test } from "@playwright/test";

import { deriveExercisePlanV1 } from "../lib/exercise/exercise-contracts";
import { CancellationCoordinator } from "../lib/pedagogy/cancellation";
import { runLocalFirstAction } from "../lib/pedagogy/action-pipeline";
import { EvidenceLog } from "../lib/pedagogy/evidence-log";
import {
  createFactSignature,
  deriveMissingRelationKeys,
} from "../lib/pedagogy/meaningful-delta";
import { initialProgressViewModel } from "../lib/pedagogy/progress-view-model";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvent,
  type PedagogyState,
  type VerifiedFact,
} from "../lib/pedagogy/state";
import { ToolGateway, type ToolHandlers } from "../lib/tools/gateway";

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

test("T4 golden first block is SILENT and repeated block is SPEAK with evidence", async () => {
  const log = new EvidenceLog({ runId: "run-e2e-golden", now: () => 1 });
  let state = createInitialPedagogyState(PLAN, {
    epoch: 1,
    revision: 0,
    snapshotHash: "hash-0",
  });
  const firstEvent = blockedAction(state, "action-first");
  const first = await runLocalFirstAction(
    state,
    firstEvent,
    initialProgressViewModel(),
    { renderProgress: () => undefined, evidenceLog: log },
  );
  expect(first.accepted).toBe(true);
  expect(first.decision).toMatchObject({
    type: "silent",
    reason: "first_incorrect_attempt",
  });
  state = first.state;

  const secondEvent = blockedAction(state, "action-repeated");
  const second = await runLocalFirstAction(
    state,
    secondEvent,
    first.progress,
    { renderProgress: () => undefined, evidenceLog: log },
  );

  expect(second.decision).toMatchObject({
    type: "speak",
    reason: "repeated_block",
    directiveDraft: { helpLevel: 1, allowedTools: [] },
  });
  const decisions = log
    .export()
    .filter(({ kind }) => kind.startsWith("decision_"));
  expect(decisions).toEqual([
    expect.objectContaining({
      actionId: "action-first",
      kind: "decision_silent",
      correlationIds: expect.objectContaining({
        evidenceIds: expect.arrayContaining([
          "evidence-r1-perpendicular",
          "evidence-r1-passes_midpoint",
        ]),
      }),
    }),
    expect.objectContaining({
      actionId: "action-repeated",
      kind: "decision_speak",
      correlationIds: expect.objectContaining({
        evidenceIds: expect.arrayContaining([
          "evidence-r2-perpendicular",
          "evidence-r2-passes_midpoint",
        ]),
      }),
    }),
  ]);
});

test("T4 pending intervention is null before drag ownership starts", () => {
  let state = queuedState();
  const coordinator = new CancellationCoordinator({
    getState: () => state,
    dispatch: (event) => {
      state = pedagogyReducer(state, event);
      return state;
    },
    cancelTransport: () => false,
  });

  expect(coordinator.cancel("student_drag").pendingCleared).toBe(true);
  state = pedagogyReducer(state, {
    type: "student_drag_started",
    ...anchor(state),
  });
  expect(state.pendingIntervention).toBeNull();
  expect(state.interaction.studentIsDragging).toBe(true);
});

test("T4 barge-in cancels active tutor audio once and returns the floor", () => {
  let state = speakingState("response-barge");
  const transport: string[] = [];
  let localAudioMuted = false;
  const coordinator = new CancellationCoordinator({
    getState: () => state,
    dispatch: (event) => {
      state = pedagogyReducer(state, event);
      return state;
    },
    cancelTransport: () => {
      transport.push("response.cancel", "output_audio_buffer.clear");
      localAudioMuted = true;
      return true;
    },
  });

  expect(coordinator.cancel("student_speech").responseCleared).toBe(true);
  expect(coordinator.cancel("student_speech").status).toBe("noop");
  expect(transport).toEqual(["response.cancel", "output_audio_buffer.clear"]);
  expect(localAudioMuted).toBe(true);
  expect(state.activeResponse).toBeNull();
  expect(state.interaction.tutorIsSpeaking).toBe(false);
});

test("T4 application Stop orders cancel before clear and is idempotent", () => {
  let state = speakingState("response-stop");
  const transport: string[] = [];
  const coordinator = new CancellationCoordinator({
    getState: () => state,
    dispatch: (event) => {
      state = pedagogyReducer(state, event);
      return state;
    },
    cancelTransport: () => {
      transport.push("response.cancel", "output_audio_buffer.clear");
      return true;
    },
  });

  coordinator.cancel("application_stop");
  coordinator.cancel("application_stop");
  expect(transport).toEqual(["response.cancel", "output_audio_buffer.clear"]);
  expect(state.pendingIntervention).toBeNull();
  expect(state.activeResponse).toBeNull();
});

test("T4 stale tool and stale directive leave the GeoGebra hash unchanged", async () => {
  let constructionHash = "fnv1a32:before";
  let mutationCount = 0;
  const handlers: ToolHandlers = {
    read_construction: () => ({ data: {} }),
    initialize_exercise: () => ({ data: {} }),
    check_relation: () => ({ data: {} }),
    highlight_objects: () => {
      mutationCount += 1;
      constructionHash = "fnv1a32:mutated";
      return { data: {} };
    },
  };
  const gateway = new ToolGateway(handlers);
  const staleRevision = await gateway.execute(
    {
      callId: "call-stale-revision",
      name: "highlight_objects",
      arguments:
        '{"names":["A"],"style":"hint","ttlMs":500,"revision":1}',
    },
    { turnId: "turn-stale", phase: "constructing", epoch: 5, revision: 2 },
  );
  const staleDirective = await gateway.execute(
    {
      callId: "call-stale-directive",
      name: "highlight_objects",
      arguments:
        '{"names":["A"],"style":"hint","ttlMs":500,"revision":2}',
    },
    {
      turnId: "turn-stale",
      phase: "constructing",
      epoch: 5,
      revision: 2,
      directive: {
        directiveId: "directive-old",
        authorize: () => false,
      },
    },
  );

  expect(staleRevision).toMatchObject({
    ok: false,
    error: { code: "stale_revision" },
  });
  expect(staleDirective).toMatchObject({
    ok: false,
    error: { code: "rejected_stale" },
  });
  expect(mutationCount).toBe(0);
  expect(constructionHash).toBe("fnv1a32:before");
});

function blockedAction(
  state: PedagogyState,
  actionId: string,
): Extract<PedagogyEvent, { type: "validated_action_committed" }> {
  const revision = state.revision + 1;
  const snapshotHash = `hash-${revision}`;
  const facts: VerifiedFact[] = ["perpendicular", "passes_midpoint"].map(
    (relationKey) => ({
      relationKey: relationKey as VerifiedFact["relationKey"],
      status: "missing",
      evidenceId: `evidence-r${revision}-${relationKey}`,
    }),
  );
  const previousFactSignature = createFactSignature(state.verifiedFacts);
  const currentFactSignature = createFactSignature(facts);
  return {
    type: "validated_action_committed",
    epoch: state.epoch,
    exerciseId: state.exerciseId,
    stepId: state.stepId,
    actionId,
    revision,
    snapshotHash,
    facts,
    evidence: facts.map((fact) => ({
      id: fact.evidenceId,
      relation: fact.relationKey,
      pass: false,
      observed: 1,
      tolerance: 0.000001,
      revision,
      objects: ["d", "AB"],
      snapshotHash,
    })),
    meaningfulDelta: {
      isMeaningful: true,
      constructionChanged: true,
      factsChanged: previousFactSignature !== currentFactSignature,
      changedStudentObjects: ["d"],
      previousFactSignature,
      currentFactSignature,
      missingRelationKeys: deriveMissingRelationKeys(facts),
      reason:
        previousFactSignature === currentFactSignature
          ? "student_construction_changed"
          : "construction_and_facts_changed",
    },
  };
}

function queuedState(): PedagogyState {
  return {
    ...createInitialPedagogyState(PLAN, {
      epoch: 3,
      revision: 1,
      snapshotHash: "hash-1",
    }),
    pendingIntervention: {
      directiveId: "directive-pending",
      sourceActionId: null,
      baseRevision: 1,
      snapshotHash: "hash-1",
      status: "queued",
    },
  };
}

function speakingState(responseId: string): PedagogyState {
  return {
    ...createInitialPedagogyState(PLAN, {
      epoch: 3,
      revision: 1,
      snapshotHash: "hash-1",
    }),
    interaction: {
      studentIsDragging: false,
      studentIsSpeaking: false,
      tutorIsSpeaking: true,
    },
    activeResponse: { responseId, directiveId: null },
  };
}

function anchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

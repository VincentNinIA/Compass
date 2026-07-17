import { describe, expect, it, vi } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import { decideInvarianceGeneralization } from "@/lib/pedagogy/policy";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvent,
  type PedagogyState,
  type VerifiedFact,
} from "@/lib/pedagogy/state";
import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_POSITION_VERSION,
  INVARIANCE_SAMPLE_PARAMETERS,
  type InvarianceRunCancelled,
  type InvarianceRunCompleted,
  type InvarianceRunFailed,
} from "./contracts";
import {
  InvarianceVerbalizationCoordinator,
  guardInvarianceGeneralizationDirective,
  invarianceGeneralizationDirectiveSchema,
  type InvarianceGeneralizationDirective,
  type InvarianceVerbalizationContext,
} from "./verbalization";

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

describe("T5-C04 invariance verbalization", () => {
  it.each([0, 1, 2, 3, 4, 5])(
    "renders the %i/5 result locally and only readies a directive for 5/5",
    async (passCount) => {
      const harness = createHarness(completedResult(passCount));

      const outcome = await harness.coordinator.receive(harness.result);

      expect(harness.renderMeasurements).toHaveBeenCalledOnce();
      expect(outcome.view).toMatchObject({
        passCount,
        expectedCount: 5,
        status: passCount === 5 ? "completed" : "not_passed",
      });
      if (passCount === 5) {
        expect(outcome).toMatchObject({
          status: "ready",
          reason: "invariance_completed",
          directive: {
            kind: "completion",
            helpLevel: 1,
            goal: "generalize_invariance",
            sourceRunId: "run-1",
            inputEvidenceIds: [
              "evidence-11-perpendicular",
              "evidence-11-passes_midpoint",
            ],
            evidenceIds: [
              "invariance-run-1-0",
              "invariance-run-1-1",
              "invariance-run-1-2",
              "invariance-run-1-3",
              "invariance-run-1-4",
            ],
            allowedTools: [],
          },
        });
        expect(harness.onDirectiveReady).toHaveBeenCalledOnce();
      } else {
        expect(outcome).toMatchObject({
          status: "silent",
          reason: "not_5_of_5",
          directive: null,
        });
        expect(harness.onDirectiveReady).not.toHaveBeenCalled();
      }
    },
  );

  it("awaits the local render acknowledgement before policy and directive readiness", async () => {
    const result = completedResult(5);
    const context = contextFor(result);
    const order: string[] = [];
    let acknowledge!: () => void;
    const renderAcknowledged = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const onDirectiveReady = vi.fn(() => {
      order.push("directive");
    });
    const coordinator = new InvarianceVerbalizationCoordinator({
      getCurrentContext: () => context,
      renderMeasurements: async () => {
        order.push("render");
        await renderAcknowledged;
        order.push("render_ack");
      },
      onDirectiveReady,
      createDirectiveId: () => "directive-1",
      decide: (...args) => {
        order.push("policy");
        return decideInvarianceGeneralization(...args);
      },
    });

    const pending = coordinator.receive(result);
    await vi.waitFor(() => expect(order).toEqual(["render"]));
    expect(onDirectiveReady).not.toHaveBeenCalled();
    acknowledge();
    const outcome = await pending;

    expect(order).toEqual(["render", "render_ack", "policy", "directive"]);
    expect(outcome.trace.map(({ marker }) => marker)).toEqual([
      "measurements_rendered",
      "policy_evaluated",
      "directive_ready",
    ]);
  });

  it("keeps QUEUE non-final and recalculates against a fresh idle floor", async () => {
    const result = completedResult(5);
    let context = contextFor(result);
    context = {
      ...context,
      state: {
        ...context.state,
        interaction: {
          ...context.state.interaction,
          studentIsDragging: true,
        },
      },
    };
    const onDirectiveReady = vi.fn();
    const coordinator = new InvarianceVerbalizationCoordinator({
      getCurrentContext: () => context,
      renderMeasurements: vi.fn(),
      onDirectiveReady,
      createDirectiveId: () => "directive-queue-retry",
    });

    const queued = await coordinator.receive(result);
    expect(queued).toMatchObject({
      status: "queued",
      reason: "floor_busy",
      directive: null,
    });
    expect(onDirectiveReady).not.toHaveBeenCalled();

    context = {
      ...context,
      state: {
        ...context.state,
        interaction: {
          ...context.state.interaction,
          studentIsDragging: false,
        },
      },
    };
    const ready = await coordinator.receive(result);
    expect(ready.status).toBe("ready");
    expect(onDirectiveReady).toHaveBeenCalledOnce();
  });

  it("gives an existing intervention priority and permits a later retry", async () => {
    const result = completedResult(5);
    let context = contextFor(result);
    context = {
      ...context,
      state: {
        ...context.state,
        pendingIntervention: {
          directiveId: "higher-priority",
          sourceActionId: "action-11",
          baseRevision: 11,
          snapshotHash: "hash-11",
          status: "queued",
        },
      },
    };
    const onDirectiveReady = vi.fn();
    const coordinator = new InvarianceVerbalizationCoordinator({
      getCurrentContext: () => context,
      renderMeasurements: vi.fn(),
      onDirectiveReady,
      createDirectiveId: () => "directive-after-priority",
    });

    expect(await coordinator.receive(result)).toMatchObject({
      status: "silent",
      reason: "higher_priority_intervention",
    });
    expect(onDirectiveReady).not.toHaveBeenCalled();

    context = { ...context, state: { ...context.state, pendingIntervention: null } };
    expect((await coordinator.receive(result)).status).toBe("ready");
    expect(onDirectiveReady).toHaveBeenCalledOnce();
  });

  it.each([
    ["failed", failedResult()],
    ["cancelled", cancelledResult()],
  ] as const)("renders a %s run and remains locally silent", async (_, result) => {
    const harness = createHarness(result);
    const outcome = await harness.coordinator.receive(result);

    expect(outcome).toMatchObject({
      status: "silent",
      reason: result.status,
      directive: null,
    });
    expect(harness.renderMeasurements).toHaveBeenCalledOnce();
    expect(harness.onDirectiveReady).not.toHaveBeenCalled();
  });

  it("rejects stale authority before readiness and rechecks after render", async () => {
    const result = completedResult(5);
    let context = contextFor(result);
    const renderMeasurements = vi.fn(async () => {
      context = { ...context, currentRevision: 12 };
    });
    const onDirectiveReady = vi.fn();
    const coordinator = new InvarianceVerbalizationCoordinator({
      getCurrentContext: () => context,
      renderMeasurements,
      onDirectiveReady,
      createDirectiveId: () => "directive-stale",
    });

    const outcome = await coordinator.receive(result);

    expect(outcome).toMatchObject({
      status: "silent",
      reason: "stale_authority",
      directive: null,
      view: { status: "stale" },
    });
    expect(renderMeasurements).toHaveBeenCalledTimes(2);
    expect(onDirectiveReady).not.toHaveBeenCalled();
  });

  it("rejects stale revision, current proof mismatch, and duplicated sample IDs", async () => {
    const result = completedResult(5);
    const staleContext = { ...contextFor(result), currentRevision: 12 };
    const wrongEvidenceContext = {
      ...contextFor(result),
      evidenceIds: ["other-0", "other-1", "other-2", "other-3", "other-4"],
    };
    const duplicated = {
      ...result,
      evidenceIds: [
        "invariance-run-1-0",
        "invariance-run-1-1",
        "invariance-run-1-2",
        "invariance-run-1-3",
        "invariance-run-1-3",
      ],
    } as unknown as InvarianceRunCompleted;

    for (const [candidate, context] of [
      [result, staleContext],
      [result, wrongEvidenceContext],
      [duplicated, contextFor(duplicated)],
    ] as const) {
      const onDirectiveReady = vi.fn();
      const coordinator = new InvarianceVerbalizationCoordinator({
        getCurrentContext: () => context,
        renderMeasurements: vi.fn(),
        onDirectiveReady,
        createDirectiveId: () => "directive-invalid",
      });
      const outcome = await coordinator.receive(candidate);
      expect(outcome.status).toBe("silent");
      expect(onDirectiveReady).not.toHaveBeenCalled();
    }
  });

  it("deduplicates a run and its five-proof signature", async () => {
    const result = completedResult(5);
    const context = contextFor(result);
    const onDirectiveReady = vi.fn();
    const coordinator = new InvarianceVerbalizationCoordinator({
      getCurrentContext: () => context,
      renderMeasurements: vi.fn(),
      onDirectiveReady,
      createDirectiveId: () => "directive-once",
    });

    expect((await coordinator.receive(result)).status).toBe("ready");
    expect(await coordinator.receive(result)).toMatchObject({
      status: "silent",
      reason: "invalid_or_duplicate_context",
      directive: null,
    });
    expect(onDirectiveReady).toHaveBeenCalledOnce();
  });

  it("creates a strict deeply immutable L1 directive", async () => {
    const harness = createHarness(completedResult(5));
    const outcome = await harness.coordinator.receive(harness.result);
    const directive = requireDirective(outcome.directive);

    expect(invarianceGeneralizationDirectiveSchema.safeParse(directive).success).toBe(
      true,
    );
    expect(
      invarianceGeneralizationDirectiveSchema.safeParse({
        ...directive,
        rogue: true,
      }).success,
    ).toBe(false);
    expect(Object.isFrozen(directive)).toBe(true);
    expect(Object.isFrozen(directive.evidenceIds)).toBe(true);
    expect(() => {
      (directive.evidenceIds as unknown as string[]).push("forged");
    }).toThrow();
  });

  it("replays the dedicated guard before dispatch", async () => {
    const harness = createHarness(completedResult(5));
    const outcome = await harness.coordinator.receive(harness.result);
    const directive = requireDirective(outcome.directive);
    const current = contextFor(harness.result);

    expect(guardInvarianceGeneralizationDirective(current, directive)).toEqual({
      ok: true,
    });
    expect(
      guardInvarianceGeneralizationDirective(
        { ...current, currentRevision: 12 },
        directive,
      ),
    ).toEqual({ ok: false, reason: "stale_authority" });
    expect(
      guardInvarianceGeneralizationDirective(
        {
          ...current,
          state: {
            ...current.state,
            interaction: {
              ...current.state.interaction,
              studentIsSpeaking: true,
            },
          },
        },
        directive,
      ),
    ).toEqual({ ok: false, reason: "floor_busy" });
    expect(
      guardInvarianceGeneralizationDirective(
        {
          ...current,
          state: {
            ...current.state,
            pendingIntervention: {
              directiveId: "other-directive",
              sourceActionId: "action-11",
              baseRevision: 11,
              snapshotHash: "hash-11",
              status: "queued",
            },
          },
        },
        directive,
      ),
    ).toEqual({ ok: false, reason: "higher_priority_intervention" });
  });
});

function createHarness(
  result:
    | InvarianceRunCompleted
    | InvarianceRunFailed
    | InvarianceRunCancelled,
) {
  const context = contextFor(result);
  const renderMeasurements = vi.fn();
  const onDirectiveReady = vi.fn();
  return {
    result,
    renderMeasurements,
    onDirectiveReady,
    coordinator: new InvarianceVerbalizationCoordinator({
      getCurrentContext: () => context,
      renderMeasurements,
      onDirectiveReady,
      createDirectiveId: () => "directive-1",
    }),
  };
}

function completedResult(passCount: number): InvarianceRunCompleted {
  const samples = INVARIANCE_SAMPLE_PARAMETERS.map((parameter, index) => {
    const pass = index < passCount;
    const pa = 3 + index;
    const pb = pass ? pa : pa + 0.1;
    return Object.freeze({
      id: `invariance-run-1-${index}`,
      index: index as 0 | 1 | 2 | 3 | 4,
      parameter,
      coords: Object.freeze([parameter, 0]) as readonly [number, number],
      pa,
      pb,
      delta: Math.abs(pa - pb),
      tolerance: INVARIANCE_DISTANCE_TOLERANCE,
      toleranceVersion: INVARIANCE_DISTANCE_TOLERANCE_VERSION,
      positionVersion: INVARIANCE_POSITION_VERSION,
      pass,
      revision: 11,
    });
  }) as unknown as InvarianceRunCompleted["samples"];
  return Object.freeze({
    status: "completed",
    runId: "run-1",
    revision: 11,
    inputEvidenceIds: Object.freeze([
      "evidence-11-perpendicular",
      "evidence-11-passes_midpoint",
    ]),
    samples: Object.freeze(samples),
    pass: passCount === 5,
    evidenceIds: Object.freeze(
      samples.map(({ id }) => id),
    ) as InvarianceRunCompleted["evidenceIds"],
  });
}

function failedResult(): InvarianceRunFailed {
  return Object.freeze({
    status: "failed",
    runId: "run-failed",
    revision: 11,
    inputEvidenceIds: Object.freeze([
      "evidence-11-perpendicular",
      "evidence-11-passes_midpoint",
    ]),
    samples: Object.freeze([]) as readonly [],
    pass: false,
    evidenceIds: Object.freeze([]) as readonly [],
    error: Object.freeze({ code: "sample_execution_failed" }),
  });
}

function cancelledResult(): InvarianceRunCancelled {
  return Object.freeze({
    status: "cancelled",
    runId: "run-cancelled",
    revision: 11,
    inputEvidenceIds: Object.freeze([
      "evidence-11-perpendicular",
      "evidence-11-passes_midpoint",
    ]),
    samples: Object.freeze([]) as readonly [],
    pass: false,
    evidenceIds: Object.freeze([]) as readonly [],
    reason: "application_stop",
  });
}

function contextFor(
  result:
    | InvarianceRunCompleted
    | InvarianceRunFailed
    | InvarianceRunCancelled,
): InvarianceVerbalizationContext {
  return {
    state: completedPedagogyState(),
    currentRunId: result.runId,
    currentRevision: result.revision,
    inputEvidenceIds: [...result.inputEvidenceIds],
    evidenceIds:
      result.status === "completed" ? [...result.evidenceIds] : [],
  };
}

function completedPedagogyState(): PedagogyState {
  const initial = createInitialPedagogyState(PLAN, { epoch: 4 });
  const facts: VerifiedFact[] = (
    ["perpendicular", "passes_midpoint"] as const
  ).map((relationKey) => ({
    relationKey,
    status: "verified",
    evidenceId: `evidence-11-${relationKey}`,
  }));
  const committed = pedagogyReducer(initial, {
    type: "validated_action_committed",
    epoch: initial.epoch,
    exerciseId: initial.exerciseId,
    stepId: initial.stepId,
    actionId: "action-11",
    revision: 11,
    snapshotHash: "hash-11",
    facts,
    evidence: facts.map((fact) => ({
      id: fact.evidenceId,
      relation: fact.relationKey,
      pass: true,
      observed: 0,
      tolerance: 0.000001,
      revision: 11,
      objects:
        fact.relationKey === "perpendicular"
          ? ["d", "AB"]
          : ["d", "A", "B"],
      snapshotHash: "hash-11",
    })),
    meaningfulDelta: {
      isMeaningful: true,
      constructionChanged: true,
      factsChanged: true,
      changedStudentObjects: ["d"],
      previousFactSignature: "",
      currentFactSignature:
        "passes_midpoint:verified|perpendicular:verified",
      missingRelationKeys: [],
      reason: "construction_and_facts_changed",
    },
  } satisfies Extract<PedagogyEvent, { type: "validated_action_committed" }>);
  return pedagogyReducer(committed, {
    type: "policy_evaluated",
    decision: "SPEAK",
    sourceActionId: "action-11",
    sourceRequestId: null,
    epoch: committed.epoch,
    revision: committed.revision,
    snapshotHash: committed.studentSnapshotHash,
  });
}

function requireDirective(
  directive: InvarianceGeneralizationDirective | null,
): InvarianceGeneralizationDirective {
  if (!directive) throw new Error("Expected a generalization directive.");
  return directive;
}

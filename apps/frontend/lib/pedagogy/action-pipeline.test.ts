import { describe, expect, it, vi } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import {
  createFactSignature,
  deriveMissingRelationKeys,
} from "./meaningful-delta";
import { decideIntervention } from "./policy";
import { runLocalFirstAction } from "./action-pipeline";
import {
  initialProgressViewModel,
  selectProgressViewModel,
} from "./progress-view-model";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvent,
  type PedagogyState,
  type VerifiedFact,
} from "./state";
import { LatencyBudgetMonitor } from "@/lib/reliability/latency-budget";

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

function actionEvent(
  state: PedagogyState,
  statuses: readonly [VerifiedFact["status"], VerifiedFact["status"]],
): Extract<PedagogyEvent, { type: "validated_action_committed" }> {
  const revision = state.revision + 1;
  const snapshotHash = `hash-${revision}`;
  const facts: VerifiedFact[] = (
    ["perpendicular", "passes_midpoint"] as const
  ).map((relationKey, index) => ({
    relationKey,
    status: statuses[index],
    evidenceId: `evidence-${revision}-${relationKey}`,
  }));
  const previousFactSignature = createFactSignature(state.verifiedFacts);
  const currentFactSignature = createFactSignature(facts);
  return {
    type: "validated_action_committed",
    epoch: state.epoch,
    exerciseId: state.exerciseId,
    stepId: state.stepId,
    actionId: `action-${revision}`,
    revision,
    snapshotHash,
    facts,
    evidence: facts.map((fact) => ({
      id: fact.evidenceId,
      relation: fact.relationKey,
      pass: fact.status === "verified",
      observed: fact.status === "verified" ? 0 : 1,
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
        previousFactSignature !== currentFactSignature
          ? "construction_and_facts_changed"
          : "student_construction_changed",
    },
  };
}

describe("T4-C04 local-first action pipeline", () => {
  it("commits and renders local progress before policy and network", async () => {
    const initial = createInitialPedagogyState(PLAN, { epoch: 2 });
    const firstEvent = actionEvent(initial, ["verified", "missing"]);
    const first = pedagogyReducer(initial, firstEvent);
    const previousProgress = selectProgressViewModel(first);
    const secondEvent = actionEvent(first, ["verified", "missing"]);
    const order: string[] = [];
    const networkPending = new Promise<void>(() => undefined);

    const result = await runLocalFirstAction(first, secondEvent, previousProgress, {
      renderProgress: (model) => {
        order.push(`render:${model.score}/2`);
      },
      decide: (...args) => {
        order.push("policy");
        return decideIntervention(...args);
      },
      requestNetwork: () => {
        order.push("network");
        return networkPending;
      },
      now: () => 10,
    });

    expect(order).toEqual(["render:1/2", "policy", "network"]);
    expect(result.decision).toMatchObject({
      type: "speak",
      reason: "repeated_block",
    });
    expect(result.trace.map(({ marker }) => marker)).toEqual([
      "validation_committed",
      "progress_rendered",
      "policy_evaluated",
      "network_requested",
    ]);
    expect(result.networkStatus).toBe("requested");

    const nextRendered: number[] = [];
    await runLocalFirstAction(
      result.state,
      actionEvent(result.state, ["verified", "verified"]),
      result.progress,
      {
        renderProgress: (model) => {
          nextRendered.push(model.score);
        },
      },
    );
    expect(nextRendered).toEqual([2]);
  });

  it("keeps committed progress when Realtime rejects the request", async () => {
    const initial = createInitialPedagogyState(PLAN, { epoch: 2 });
    const first = pedagogyReducer(
      initial,
      actionEvent(initial, ["verified", "missing"]),
    );
    const progress = selectProgressViewModel(first);
    const rendered: number[] = [];
    const onNetworkFailure = vi.fn();
    const result = await runLocalFirstAction(
      first,
      actionEvent(first, ["verified", "missing"]),
      progress,
      {
        renderProgress: (model) => {
          rendered.push(model.score);
        },
        requestNetwork: () => Promise.reject(new Error("Realtime unavailable")),
        onNetworkFailure,
      },
    );

    expect(rendered).toEqual([1]);
    expect(result.progress.score).toBe(1);
    expect(result.networkStatus).toBe("requested");
    expect(result.state.verifiedFacts[0]?.status).toBe("verified");
    await vi.waitFor(() => expect(onNetworkFailure).toHaveBeenCalledOnce());
  });

  it("never requests network for a silent first attempt", async () => {
    const initial = createInitialPedagogyState(PLAN, { epoch: 2 });
    const requestNetwork = vi.fn();
    const result = await runLocalFirstAction(
      initial,
      actionEvent(initial, ["missing", "missing"]),
      initialProgressViewModel(),
      { renderProgress: vi.fn(), requestNetwork },
    );

    expect(result.decision).toEqual({
      type: "silent",
      reason: "first_incorrect_attempt",
    });
    expect(requestNetwork).not.toHaveBeenCalled();
  });

  it("keeps rendered proof usable when policy evaluation throws", async () => {
    const initial = createInitialPedagogyState(PLAN, { epoch: 2 });
    const rendered: number[] = [];
    const requestNetwork = vi.fn();
    const result = await runLocalFirstAction(
      initial,
      actionEvent(initial, ["verified", "missing"]),
      initialProgressViewModel(),
      {
        renderProgress: (model) => {
          rendered.push(model.score);
        },
        decide: () => {
          throw new Error("policy unavailable");
        },
        requestNetwork,
      },
    );

    expect(result).toMatchObject({
      accepted: true,
      policyStatus: "failed",
      networkStatus: "not_requested",
      progress: { score: 1 },
    });
    expect(rendered).toEqual([1]);
    expect(requestNetwork).not.toHaveBeenCalled();
  });

  it("rejects a stale action before render, policy, or network", async () => {
    const initial = createInitialPedagogyState(PLAN, { epoch: 2 });
    const event = { ...actionEvent(initial, ["verified", "missing"]), epoch: 1 };
    const renderProgress = vi.fn();
    const decide = vi.fn(decideIntervention);
    const requestNetwork = vi.fn();
    const result = await runLocalFirstAction(
      initial,
      event,
      initialProgressViewModel(),
      { renderProgress, decide, requestNetwork },
    );

    expect(result.accepted).toBe(false);
    expect(result.trace).toEqual([]);
    expect(renderProgress).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(requestNetwork).not.toHaveBeenCalled();
  });

  it("measures validation-to-render feedback and exposes its closed fallback", async () => {
    const initial = createInitialPedagogyState(PLAN, { epoch: 2 });
    const monitor = new LatencyBudgetMonitor({ now: () => 9 });
    const clock = [0, 251];

    await runLocalFirstAction(
      initial,
      actionEvent(initial, ["verified", "missing"]),
      initialProgressViewModel(),
      {
        renderProgress: vi.fn(),
        latencyMonitor: monitor,
        latencyNow: () => clock.shift() ?? 251,
      },
    );

    expect(
      monitor.exportDebug().distributions.find(
        ({ name }) => name === "feedback_local",
      ),
    ).toMatchObject({
      sampleCount: 1,
      latestMs: 251,
      status: "degraded",
      fallback: "local_feedback_delayed",
    });
  });
});

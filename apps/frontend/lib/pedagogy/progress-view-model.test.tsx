import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProgressFeedback } from "@/components/progress-feedback";
import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import { createFactSignature, deriveMissingRelationKeys } from "./meaningful-delta";
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

afterEach(cleanup);

describe("T4-C04 progress view model", () => {
  it("renders the initial 0/2 state without announcing unchanged unknown facts", () => {
    const model = initialProgressViewModel();
    render(<ProgressFeedback model={model} />);

    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.getAllByText(/checking your latest move/)).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("derives and announces 1/2 solely from current local evidence", () => {
    const initial = createInitialPedagogyState(PLAN, { epoch: 4 });
    const state = commit(initial, ["verified", "missing"]);
    const model = selectProgressViewModel(state, initialProgressViewModel());
    render(<ProgressFeedback model={model} />);

    expect(model.score).toBe(1);
    expect(model.properties).toEqual([
      expect.objectContaining({
        relationKey: "perpendicular",
        status: "verified",
        evidenceId: "evidence-1-perpendicular",
      }),
      expect.objectContaining({
        relationKey: "passes_midpoint",
        status: "missing",
        evidenceId: "evidence-1-passes_midpoint",
      }),
    ]);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /Construction progress 1 of 2/,
    );
  });

  it("renders 2/2 after both independently evidenced properties verify", () => {
    const partial = commit(
      createInitialPedagogyState(PLAN, { epoch: 4 }),
      ["verified", "missing"],
    );
    const previous = selectProgressViewModel(partial);
    const complete = commit(partial, ["verified", "verified"]);
    const model = selectProgressViewModel(complete, previous);
    render(<ProgressFeedback model={model} />);

    expect(model.score).toBe(2);
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getAllByText(/: you got it$/)).toHaveLength(2);
  });

  it("does not repeat aria-live text when the fact statuses are unchanged", () => {
    const first = commit(
      createInitialPedagogyState(PLAN, { epoch: 4 }),
      ["verified", "missing"],
    );
    const previous = selectProgressViewModel(first);
    const second = commit(first, ["verified", "missing"]);

    expect(selectProgressViewModel(second, previous).announcement).toBe("");
  });

  it("fails closed to unknown when evidence no longer matches the current hash", () => {
    const current = commit(
      createInitialPedagogyState(PLAN, { epoch: 4 }),
      ["verified", "verified"],
    );
    const previous = selectProgressViewModel(current);
    const stale: PedagogyState = {
      ...current,
      studentSnapshotHash: "different-current-hash",
    };
    const model = selectProgressViewModel(stale, previous);

    expect(model.score).toBe(0);
    expect(model.properties.map(({ status }) => status)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(model.announcement).toBe("Local evidence needs revalidation.");
  });

  it("fails closed when a fact claims verified over a failing proof", () => {
    const current = commit(
      createInitialPedagogyState(PLAN, { epoch: 4 }),
      ["verified", "missing"],
    );
    const evidenceId = current.verifiedFacts[0]!.evidenceId;
    const corrupted: PedagogyState = {
      ...current,
      evidenceById: {
        ...current.evidenceById,
        [evidenceId]: {
          ...current.evidenceById[evidenceId]!,
          pass: false,
        },
      },
    };

    expect(selectProgressViewModel(corrupted, selectProgressViewModel(current)))
      .toMatchObject({
        score: 0,
        properties: [{ status: "unknown" }, { status: "unknown" }],
        announcement: "Local evidence needs revalidation.",
      });
  });
});

function commit(
  state: PedagogyState,
  statuses: readonly [VerifiedFact["status"], VerifiedFact["status"]],
): PedagogyState {
  return pedagogyReducer(state, actionEvent(state, statuses));
}

export function actionEvent(
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

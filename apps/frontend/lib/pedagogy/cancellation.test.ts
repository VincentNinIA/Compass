import { describe, expect, it, vi } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import { CancellationCoordinator } from "./cancellation";
import {
  CANCELLATION_REASONS,
  EvidenceLog,
  type CancellationReason,
} from "./evidence-log";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyState,
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

describe("CancellationCoordinator", () => {
  it.each(CANCELLATION_REASONS)(
    "clears a pending intervention idempotently for %s",
    (reason) => {
      const harness = pendingHarness(reason);

      const first = harness.coordinator.cancel(reason);
      const second = harness.coordinator.cancel(reason);

      expect(first).toMatchObject({ status: "cancelled", pendingCleared: true });
      expect(second.status).toBe("noop");
      expect(harness.state.pendingIntervention).toBeNull();
      expect(harness.cancelTransport).toHaveBeenCalledTimes(1);
      expect(harness.cancelHint).toHaveBeenCalledTimes(1);
      expect(harness.log.export()).toHaveLength(1);
      expect(harness.log.export()[0]).toMatchObject({
        kind: "cancellation",
        status: "cancelled",
        correlationIds: { directiveId: "directive-1" },
      });
    },
  );

  it("closes the active response and allows a later distinct response to be cancelled", () => {
    let state = activeResponseState("response-1");
    const cancelTransport = vi.fn(() => true);
    const coordinator = new CancellationCoordinator({
      getState: () => state,
      dispatch: (event) => {
        state = pedagogyReducer(state, event);
        return state;
      },
      cancelTransport,
    });

    expect(coordinator.cancel("student_speech").responseCleared).toBe(true);
    expect(state.activeResponse).toBeNull();
    state = activeResponseState("response-2");
    expect(coordinator.cancel("student_speech").responseCleared).toBe(true);
    expect(cancelTransport).toHaveBeenCalledTimes(2);
  });

  it("distinguishes two pending transport turns at the same pedagogy revision", () => {
    const state = createInitialPedagogyState(PLAN, {
      epoch: 2,
      revision: 1,
      snapshotHash: "hash-1",
    });
    let scope = "turn-A";
    const cancelTransport = vi.fn(() => {
      scope = "-";
      return true;
    });
    const coordinator = new CancellationCoordinator({
      getState: () => state,
      dispatch: () => state,
      getScope: () => scope,
      cancelTransport,
    });

    expect(coordinator.cancel("student_speech").status).toBe("cancelled");
    expect(coordinator.cancel("student_speech").status).toBe("noop");
    scope = "turn-B";
    expect(coordinator.cancel("student_speech").status).toBe("cancelled");
    expect(cancelTransport).toHaveBeenCalledTimes(2);
  });
});

function pendingHarness(reason: CancellationReason) {
  let state = queuedState();
  const cancelTransport = vi.fn(() => true);
  const cancelHint = vi.fn(() => true);
  const log = new EvidenceLog({ runId: `run-${reason}`, now: () => 1 });
  const coordinator = new CancellationCoordinator({
    getState: () => state,
    dispatch: (event) => {
      state = pedagogyReducer(state, event);
      return state;
    },
    cancelTransport,
    cancelHint,
    evidenceLog: log,
  });
  return {
    get state() {
      return state;
    },
    coordinator,
    cancelTransport,
    cancelHint,
    log,
  };
}

function queuedState(): PedagogyState {
  let state = createInitialPedagogyState(PLAN, {
    epoch: 2,
    revision: 1,
    snapshotHash: "hash-1",
  });
  state = {
    ...state,
    pendingIntervention: {
      directiveId: "directive-1",
      sourceActionId: null,
      baseRevision: 1,
      snapshotHash: "hash-1",
      status: "queued",
    },
  };
  return state;
}

function activeResponseState(responseId: string): PedagogyState {
  return {
    ...createInitialPedagogyState(PLAN, {
      epoch: 2,
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

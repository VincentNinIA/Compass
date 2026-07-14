import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TutorWorkspace } from "./tutor-workspace";
import {
  deriveExercisePlanV1,
  type ExerciseExtractionWireV1,
} from "@/lib/exercise/exercise-contracts";
import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import type { ExerciseInitializationRuntime } from "@/lib/geogebra/exercise-initialization";

const captured = vi.hoisted(() => ({
  confirmationProps: undefined as unknown,
  geogebraProps: undefined as unknown,
}));

vi.mock("./exercise-photo/exercise-confirmation", () => ({
  ExerciseConfirmation: (props: unknown) => {
    captured.confirmationProps = props;
    return null;
  },
}));

vi.mock("./geogebra-spike", () => ({
  GeoGebraSpike: (props: unknown) => {
    captured.geogebraProps = props;
    return null;
  },
}));

vi.mock("./realtime-spike", () => ({
  RealtimeSpike: () => null,
}));

type ConfirmationProps = {
  onConfirmed(confirmation: ExerciseConfirmedV1): void;
  onDraftChanged(): void;
  onRetryInitialization(): void;
  initializationState: { status: string };
  resetToken: number;
};

type GeogebraProps = {
  onExerciseInitializationRuntime(runtime?: ExerciseInitializationRuntime): void;
  onConstructionReset(): void;
};

const EXTRACTION: ExerciseExtractionWireV1 = {
  schemaVersion: "exercise_extraction.v1",
  outcome: "ready",
  language: "en",
  instruction: "Construct the perpendicular bisector of segment AB.",
  pointLabels: ["A", "B"],
  segmentEndpoints: ["A", "B"],
  requestedConstruction: "perpendicular_bisector",
  learningObjective: "perpendicular_bisector_equidistance",
  ambiguityCode: null,
  clarificationQuestion: null,
  unsupportedReason: null,
};

function confirmation(id: string): ExerciseConfirmedV1 {
  return {
    plan: deriveExercisePlanV1(EXTRACTION),
    confirmationId: id,
    confirmedAt: 123,
  };
}

function confirmationProps(): ConfirmationProps {
  return captured.confirmationProps as ConfirmationProps;
}

function geogebraProps(): GeogebraProps {
  return captured.geogebraProps as GeogebraProps;
}

describe("TutorWorkspace exercise data minimization", () => {
  afterEach(cleanup);

  it("retains only a confirmed plan for failed Retry and cannot replay it after success, reset, or draft discard", async () => {
    const initialize = vi
      .fn<ExerciseInitializationRuntime["initialize"]>()
      .mockResolvedValueOnce({
        status: "initialized",
        planId: "demo-perpendicular-bisector-01",
        snapshotHash: "fnv1a32:success-1",
        created: ["A", "B", "AB"],
      })
      .mockResolvedValueOnce({
        status: "failed",
        code: "command_failed",
        rolledBack: true,
      })
      .mockResolvedValueOnce({
        status: "initialized",
        planId: "demo-perpendicular-bisector-01",
        snapshotHash: "fnv1a32:success-2",
        created: ["A", "B", "AB"],
      })
      .mockResolvedValueOnce({
        status: "failed",
        code: "command_failed",
        rolledBack: true,
      })
      .mockResolvedValueOnce({
        status: "failed",
        code: "command_failed",
        rolledBack: true,
      });
    const runtime = {
      initialize,
      recover: vi.fn(),
    } as unknown as ExerciseInitializationRuntime;
    render(<TutorWorkspace />);

    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    act(() => confirmationProps().onConfirmed(confirmation("success")));
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("initialized"),
    );

    act(() => confirmationProps().onRetryInitialization());
    await act(() => Promise.resolve());
    expect(initialize).toHaveBeenCalledTimes(1);

    act(() => confirmationProps().onConfirmed(confirmation("retryable")));
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("failed"),
    );
    expect(Object.keys(initialize.mock.calls[1]![0]).sort()).toEqual([
      "confirmationId",
      "confirmedAt",
      "plan",
    ]);
    expect(initialize.mock.calls[1]![0]).not.toHaveProperty("file");
    expect(initialize.mock.calls[1]![0]).not.toHaveProperty("clarification");

    act(() => confirmationProps().onRetryInitialization());
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(3));
    expect(initialize.mock.calls[2]![0]).toBe(initialize.mock.calls[1]![0]);

    act(() => confirmationProps().onConfirmed(confirmation("reset-before-retry")));
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("failed"),
    );
    const resetToken = confirmationProps().resetToken;
    act(() => geogebraProps().onConstructionReset());
    expect(confirmationProps().resetToken).toBe(resetToken + 1);
    act(() => confirmationProps().onRetryInitialization());
    await act(() => Promise.resolve());
    expect(initialize).toHaveBeenCalledTimes(4);

    act(() => confirmationProps().onConfirmed(confirmation("discarded-draft")));
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(5));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("failed"),
    );
    act(() => confirmationProps().onDraftChanged());
    act(() => geogebraProps().onExerciseInitializationRuntime(undefined));
    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    await act(() => Promise.resolve());
    expect(initialize).toHaveBeenCalledTimes(5);
    expect(confirmationProps().initializationState.status).toBe("idle");
  });
});

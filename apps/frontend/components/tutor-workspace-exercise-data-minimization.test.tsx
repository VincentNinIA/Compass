import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TutorWorkspace } from "./tutor-workspace";
import {
  deriveExercisePlanV1,
  type ExerciseExtractionWireV1,
} from "@/lib/exercise/exercise-contracts";
import type {
  ConfirmedExercise,
  ExerciseConfirmedV1,
} from "@/lib/exercise/exercise-confirmation";
import type { ExerciseInitializationRuntime } from "@/lib/geogebra/exercise-initialization";
import type { ToolWorkflowAuthority } from "@/lib/tools/runtime";

const captured = vi.hoisted(() => ({
  confirmationProps: undefined as unknown,
  geogebraProps: undefined as unknown,
  scratchpadProps: undefined as unknown,
  realtimeProps: undefined as unknown,
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
  RealtimeSpike: (props: unknown) => {
    captured.realtimeProps = props;
    return null;
  },
}));

vi.mock("./geogebra-scratchpad", () => ({
  GeoGebraScratchpad: (props: unknown) => {
    captured.scratchpadProps = props;
    return <section data-testid="geogebra-scratchpad" />;
  },
}));

type ConfirmationProps = {
  onConfirmed(confirmation: ConfirmedExercise): void;
  onDraftChanged(): void;
  onRetryInitialization?(): void;
  initializationState: {
    status: string;
    code?: string;
    retryable?: boolean;
  };
  resetToken: number;
};

type GeogebraProps = {
  onExerciseInitializationRuntime(runtime?: ExerciseInitializationRuntime): void;
  onConstructionReset(): void;
  toolWorkflowAuthority: ToolWorkflowAuthority;
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function confirmationProps(): ConfirmationProps {
  return captured.confirmationProps as ConfirmationProps;
}

function geogebraProps(): GeogebraProps {
  return captured.geogebraProps as GeogebraProps;
}

function realtimeProps(): {
  tutorProfile: string;
  layout?: string;
  exerciseContext?: { tasks: string[]; statement: string };
} {
  return captured.realtimeProps as {
    tutorProfile: string;
    layout?: string;
    exerciseContext?: { tasks: string[]; statement: string };
  };
}

function renderSpecialistWorkspace() {
  window.history.replaceState({}, "", "/?specialist=geometry");
  return render(<TutorWorkspace />);
}

describe("TutorWorkspace exercise data minimization", () => {
  beforeEach(() => {
    captured.confirmationProps = undefined;
    captured.geogebraProps = undefined;
    captured.scratchpadProps = undefined;
    captured.realtimeProps = undefined;
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("routes a confirmed general exercise to the no-tool coach without initializing GeoGebra", () => {
    render(<TutorWorkspace />);

    expect(captured.geogebraProps).toBeUndefined();

    act(() =>
      confirmationProps().onConfirmed({
        kind: "general",
        confirmationId: "general-1",
        confirmedAt: 123,
        exercise: {
          schemaVersion: "general_exercise.v1",
          outcome: "ready",
          language: "fr",
          subject: "history",
          title: "Les Lumières",
          statement: "Présente deux idées des Lumières.",
          tasks: ["Présenter deux idées.", "Donner un exemple."],
          concepts: ["Lumières"],
          ambiguityCode: null,
          clarificationQuestion: null,
        },
      }),
    );

    expect(realtimeProps()).toMatchObject({
      tutorProfile: "general_tutor",
      exerciseContext: {
        statement: "Présente deux idées des Lumières.",
        tasks: ["Présenter deux idées.", "Donner un exemple."],
      },
    });
    expect(screen.getByText("Your exercise, one step at a time")).toBeInTheDocument();
    expect(screen.queryByText(/perpendicular bisector/i)).not.toBeInTheDocument();
    expect(document.querySelector(".legacy-geometry-module")).not.toBeInTheDocument();
  });

  it("routes a confirmed maths exercise to the GeoGebra-aware dock and dominant workbench", () => {
    render(<TutorWorkspace screen="work" />);

    act(() =>
      confirmationProps().onConfirmed({
        kind: "general",
        confirmationId: "maths-1",
        confirmedAt: 123,
        exercise: {
          schemaVersion: "general_exercise.v1",
          outcome: "ready",
          language: "fr",
          subject: "mathematics",
          title: "Droites et demi-droites",
          statement: "Tracer une droite passant par F et G.",
          tasks: ["Placer F et G.", "Tracer la droite (FG)."],
          concepts: ["droite", "géométrie"],
          ambiguityCode: null,
          clarificationQuestion: null,
        },
      }),
    );

    expect(realtimeProps()).toMatchObject({
      tutorProfile: "geogebra_tutor",
      layout: "panorama",
      exerciseContext: {
        statement: "Tracer une droite passant par F et G.",
      },
    });
    expect(captured.scratchpadProps).toMatchObject({
      onToolRuntime: expect.any(Function),
    });
    expect(screen.getByTestId("geogebra-scratchpad")).toBeInTheDocument();
    expect(document.querySelector(".geogebra-workbench")).toBeInTheDocument();
  });

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
    renderSpecialistWorkspace();

    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    act(() => confirmationProps().onConfirmed(confirmation("success")));
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("initialized"),
    );
    expect(
      geogebraProps().toolWorkflowAuthority.getConfirmedExercise(
        "demo-perpendicular-bisector-01",
      ),
    ).toBeUndefined();
    expect(geogebraProps().toolWorkflowAuthority.getPhase()).toBe("constructing");
    expect(confirmationProps().onRetryInitialization).toBeUndefined();

    act(() => confirmationProps().onRetryInitialization?.());
    await act(() => Promise.resolve());
    expect(initialize).toHaveBeenCalledTimes(1);

    act(() => confirmationProps().onConfirmed(confirmation("retryable")));
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("failed"),
    );
    expect(confirmationProps().initializationState.retryable).toBe(true);
    expect(confirmationProps().onRetryInitialization).toEqual(expect.any(Function));
    expect(
      geogebraProps().toolWorkflowAuthority.getConfirmedExercise(
        "demo-perpendicular-bisector-01",
      )?.confirmationId,
    ).toBe("retryable");
    expect(Object.keys(initialize.mock.calls[1]![0]).sort()).toEqual([
      "confirmationId",
      "confirmedAt",
      "plan",
    ]);
    expect(initialize.mock.calls[1]![0]).not.toHaveProperty("file");
    expect(initialize.mock.calls[1]![0]).not.toHaveProperty("clarification");

    act(() => confirmationProps().onRetryInitialization?.());
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
    expect(confirmationProps().onRetryInitialization).toBeUndefined();
    expect(
      geogebraProps().toolWorkflowAuthority.getConfirmedExercise(
        "demo-perpendicular-bisector-01",
      ),
    ).toBeUndefined();
    act(() => confirmationProps().onRetryInitialization?.());
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
    expect(confirmationProps().onRetryInitialization).toBeUndefined();
    expect(
      geogebraProps().toolWorkflowAuthority.getConfirmedExercise(
        "demo-perpendicular-bisector-01",
      ),
    ).toBeUndefined();
  });

  it("drains confirmation B after stale initialization A rolls back", async () => {
    const releaseA = deferred<void>();
    let isAStillCurrent: (() => boolean) | undefined;
    const initialize = vi.fn<ExerciseInitializationRuntime["initialize"]>(
      async (value, options) => {
        if (value.confirmationId === "confirmation-a") {
          isAStillCurrent = options?.isAuthorityCurrent;
          await releaseA.promise;
          if (!(options?.isAuthorityCurrent?.() ?? true)) {
            return { status: "failed", code: "cancelled", rolledBack: true };
          }
        }
        return {
          status: "initialized",
          planId: value.plan.exerciseId,
          snapshotHash: `fnv1a32:${value.confirmationId}`,
          created: ["A", "B", "AB"],
        };
      },
    );
    const runtime = { initialize } as unknown as ExerciseInitializationRuntime;
    renderSpecialistWorkspace();

    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    act(() => confirmationProps().onConfirmed(confirmation("confirmation-a")));
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(confirmationProps().initializationState.status).toBe("initializing");

    act(() => confirmationProps().onConfirmed(confirmation("confirmation-b")));
    expect(isAStillCurrent?.()).toBe(false);
    expect(
      geogebraProps().toolWorkflowAuthority.getConfirmedExercise(
        "demo-perpendicular-bisector-01",
      )?.confirmationId,
    ).toBe("confirmation-b");
    await act(async () => releaseA.resolve());

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("initialized"),
    );
    expect(initialize.mock.calls.map(([value]) => value.confirmationId)).toEqual([
      "confirmation-a",
      "confirmation-b",
    ]);
    expect(
      geogebraProps().toolWorkflowAuthority.getConfirmedExercise(
        "demo-perpendicular-bisector-01",
      ),
    ).toBeUndefined();
  });

  it("invalidates queued B when Reset lands between A and B", async () => {
    const releaseA = deferred<void>();
    const initialize = vi.fn<ExerciseInitializationRuntime["initialize"]>(
      async (_value, options) => {
        await releaseA.promise;
        return options?.isAuthorityCurrent?.() === false
          ? { status: "failed", code: "cancelled", rolledBack: true }
          : {
              status: "initialized",
              planId: "demo-perpendicular-bisector-01",
              snapshotHash: "fnv1a32:unexpected",
              created: ["A", "B", "AB"],
            };
      },
    );
    const runtime = { initialize } as unknown as ExerciseInitializationRuntime;
    renderSpecialistWorkspace();

    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    act(() => confirmationProps().onConfirmed(confirmation("confirmation-a")));
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    act(() => confirmationProps().onConfirmed(confirmation("confirmation-b")));
    act(() => geogebraProps().onConstructionReset());
    await act(async () => releaseA.resolve());
    await act(async () => Promise.resolve());

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(confirmationProps().initializationState.status).toBe("reset");
  });

  it("deduplicates the same confirmationId in flight and after completion", async () => {
    const release = deferred<void>();
    let isCurrent: (() => boolean) | undefined;
    const initialize = vi.fn<ExerciseInitializationRuntime["initialize"]>(
      async (value, options) => {
        isCurrent = options?.isAuthorityCurrent;
        await release.promise;
        return {
          status: "initialized",
          planId: value.plan.exerciseId,
          snapshotHash: "fnv1a32:deduplicated",
          created: ["A", "B", "AB"],
        };
      },
    );
    const runtime = { initialize } as unknown as ExerciseInitializationRuntime;
    renderSpecialistWorkspace();

    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    act(() => confirmationProps().onConfirmed(confirmation("same-id")));
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    act(() => confirmationProps().onConfirmed(confirmation("same-id")));
    expect(isCurrent?.()).toBe(true);
    await act(async () => release.resolve());
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("initialized"),
    );

    act(() => confirmationProps().onConfirmed(confirmation("same-id")));
    await act(async () => Promise.resolve());
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("drops the plan, confirmed authority, phase, and Retry action after a definitive failure", async () => {
    const initialize = vi
      .fn<ExerciseInitializationRuntime["initialize"]>()
      .mockResolvedValue({
        status: "failed",
        code: "invalid_confirmation",
        rolledBack: false,
      });
    const runtime = { initialize } as unknown as ExerciseInitializationRuntime;
    renderSpecialistWorkspace();

    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    act(() => confirmationProps().onConfirmed(confirmation("definitive")));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("failed"),
    );

    expect(confirmationProps().initializationState).toMatchObject({
      code: "invalid_confirmation",
      retryable: false,
    });
    expect(confirmationProps().onRetryInitialization).toBeUndefined();
    expect(
      geogebraProps().toolWorkflowAuthority.getConfirmedExercise(
        "demo-perpendicular-bisector-01",
      ),
    ).toBeUndefined();
    expect(geogebraProps().toolWorkflowAuthority.getPhase()).toBe("idle");

    act(() => geogebraProps().onExerciseInitializationRuntime(undefined));
    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    await act(() => Promise.resolve());
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("retains a no-rollback plan only for a closed transient code and clears it after explicit Retry", async () => {
    const initialize = vi
      .fn<ExerciseInitializationRuntime["initialize"]>()
      .mockResolvedValueOnce({
        status: "failed",
        code: "applet_not_ready",
        rolledBack: false,
      })
      .mockResolvedValueOnce({
        status: "initialized",
        planId: "demo-perpendicular-bisector-01",
        snapshotHash: "fnv1a32:retry-success",
        created: ["A", "B", "AB"],
      });
    const runtime = { initialize } as unknown as ExerciseInitializationRuntime;
    renderSpecialistWorkspace();

    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    act(() => confirmationProps().onConfirmed(confirmation("transient")));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("failed"),
    );

    expect(confirmationProps().initializationState.retryable).toBe(true);
    expect(confirmationProps().onRetryInitialization).toEqual(expect.any(Function));
    expect(
      geogebraProps().toolWorkflowAuthority.getConfirmedExercise(
        "demo-perpendicular-bisector-01",
      )?.confirmationId,
    ).toBe("transient");

    act(() => confirmationProps().onRetryInitialization?.());
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("initialized"),
    );
    expect(confirmationProps().onRetryInitialization).toBeUndefined();
    expect(
      geogebraProps().toolWorkflowAuthority.getConfirmedExercise(
        "demo-perpendicular-bisector-01",
      ),
    ).toBeUndefined();
  });

  it("clears a retryable plan on unmount and cannot replay it through retained callbacks", async () => {
    const initialize = vi
      .fn<ExerciseInitializationRuntime["initialize"]>()
      .mockResolvedValue({
        status: "failed",
        code: "postcondition_failed",
        rolledBack: true,
      });
    const runtime = { initialize } as unknown as ExerciseInitializationRuntime;
    const view = renderSpecialistWorkspace();

    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    act(() => confirmationProps().onConfirmed(confirmation("unmount")));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("failed"),
    );
    const retry = confirmationProps().onRetryInitialization;
    const publishRuntime = geogebraProps().onExerciseInitializationRuntime;
    const authority = geogebraProps().toolWorkflowAuthority;
    expect(retry).toEqual(expect.any(Function));

    view.unmount();
    expect(
      authority.getConfirmedExercise("demo-perpendicular-bisector-01"),
    ).toBeUndefined();
    expect(authority.getPhase()).toBe("idle");

    act(() => retry?.());
    act(() => publishRuntime(runtime));
    await act(() => Promise.resolve());
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("leaves initializing on a current runtime rejection", async () => {
    const release = deferred<void>();
    const initialize = vi.fn<ExerciseInitializationRuntime["initialize"]>(
      async () => {
        await release.promise;
        throw new Error("runtime unavailable");
      },
    );
    const runtime = { initialize } as unknown as ExerciseInitializationRuntime;
    renderSpecialistWorkspace();

    act(() => geogebraProps().onExerciseInitializationRuntime(runtime));
    act(() => confirmationProps().onConfirmed(confirmation("failure")));
    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("initializing"),
    );
    await act(async () => release.resolve());

    await waitFor(() =>
      expect(confirmationProps().initializationState.status).toBe("failed"),
    );
    expect(confirmationProps().initializationState.status).not.toBe(
      "initializing",
    );
  });
});

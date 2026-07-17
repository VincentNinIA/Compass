import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeoGebraSpike } from "./geogebra-spike";
import { resetGeoGebraScriptForTests } from "@/lib/geogebra";
import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import {
  ExerciseInitializationService,
  type ExerciseInitializationRuntime,
} from "@/lib/geogebra/exercise-initialization";
import type { ToolRuntime, ToolWorkflowAuthority } from "@/lib/tools/runtime";
import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import type {
  GeoGebraApi,
  GeoGebraAppletParameters,
} from "@/types/geogebra";

describe("GeoGebraSpike", () => {
  afterEach(() => {
    delete window.GGBApplet;
    delete window.__GEOTUTOR_GGB_EVIDENCE__;
    resetGeoGebraScriptForTests();
    vi.restoreAllMocks();
  });

  it("loads through appletOnLoad, reads A/B/AB, and removes the applet on unmount", async () => {
    const removeExistingApplet = vi.fn();
    const commands = new Map([
      ["A", ""],
      ["B", ""],
      ["AB", "Segment(A, B)"],
    ]);
    const coordinates = new Map<string, [number, number]>();
    const created = new Set<string>();
    const api: GeoGebraApi = {
      evalCommand: vi.fn((command) => {
        for (const line of command.split("\n")) {
          const label = line.split("=")[0].trim();
          const point = line.match(/\((-?\d+),\s*(-?\d+)\)/);
          created.add(label);
          if (point) {
            coordinates.set(label, [Number(point[1]), Number(point[2])]);
            commands.set(label, "");
          } else if (label === "AB") {
            commands.set(label, "Segment(A, B)");
          }
        }
        return true;
      }),
      exists: vi.fn((label) => created.has(label)),
      isDefined: vi.fn((label) => created.has(label)),
      getCommandString: vi.fn((label) => commands.get(label) ?? ""),
      getObjectType: vi.fn((label) => (label === "AB" ? "segment" : "point")),
      getXcoord: vi.fn((label) => coordinates.get(label)?.[0] ?? 0),
      getYcoord: vi.fn((label) => coordinates.get(label)?.[1] ?? 0),
      setCoordSystem: vi.fn(),
      setLabelVisible: vi.fn(),
      getBase64: vi.fn((callback) =>
        callback(JSON.stringify({ created: [...created], coordinates: [...coordinates], commands: [...commands] })),
      ),
      getAllObjectNames: vi.fn(() => [...created]),
      getObjectNumber: vi.fn(() => created.size),
      getObjectName: vi.fn((index) => [...created][index] ?? ""),
      newConstruction: vi.fn(() => {
        created.clear();
        coordinates.clear();
        commands.clear();
      }),
      deleteObject: vi.fn((label) => {
        created.delete(label);
        coordinates.delete(label);
        commands.delete(label);
      }),
      setBase64: vi.fn((base64, callback) => {
        const parsed = JSON.parse(base64) as {
          created: string[];
          coordinates: [string, [number, number]][];
          commands: [string, string][];
        };
        created.clear();
        for (const name of parsed.created) created.add(name);
        coordinates.clear();
        for (const entry of parsed.coordinates) coordinates.set(...entry);
        commands.clear();
        for (const entry of parsed.commands) commands.set(...entry);
        callback?.();
      }),
      registerClientListener: vi.fn(),
      unregisterClientListener: vi.fn(),
      registerAddListener: vi.fn(),
      unregisterAddListener: vi.fn(),
      registerRemoveListener: vi.fn(),
      unregisterRemoveListener: vi.fn(),
      registerUpdateListener: vi.fn(),
      unregisterUpdateListener: vi.fn(),
    };

    window.GGBApplet = class {
      readonly parameters: GeoGebraAppletParameters;

      constructor(parameters: GeoGebraAppletParameters) {
        this.parameters = parameters;
      }

      inject() {
        this.parameters.appletOnLoad(api);
      }

      removeExistingApplet = removeExistingApplet;
      setHTML5Codebase = vi.fn();
    };

    const confirmation = {
      confirmationId: "confirmation-component-1",
      confirmedAt: 123,
      plan: deriveExercisePlanV1({
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
      }),
    } satisfies ExerciseConfirmedV1;
    let exerciseRuntime: ExerciseInitializationRuntime | undefined;
    let toolRuntime: ToolRuntime | undefined;
    let phase: ReturnType<ToolWorkflowAuthority["getPhase"]> = "idle";
    const authority: ToolWorkflowAuthority = {
      getPhase: () => phase,
      getConfirmedExercise: (planId) =>
        planId === confirmation.plan.exerciseId ? confirmation : undefined,
      initializeExercise: async (value) => {
        if (!exerciseRuntime) throw new Error("Exercise runtime was not published.");
        const result = await exerciseRuntime.initialize(value);
        if (
          result.status === "initialized" ||
          result.status === "already_initialized"
        ) {
          phase = "constructing";
        }
        return result;
      },
    };
    const onConstructionReset = vi.fn();
    const reset = vi.spyOn(ExerciseInitializationService.prototype, "reset");
    const view = render(
      <GeoGebraSpike
        toolWorkflowAuthority={authority}
        onConstructionReset={onConstructionReset}
        onToolRuntime={(runtime) => {
          toolRuntime = runtime;
        }}
        onExerciseInitializationRuntime={(runtime) => {
          exerciseRuntime = runtime;
        }}
      />,
    );

    await act(async () => undefined);
    expect(await screen.findByText("API verified")).toBeInTheDocument();
    expect(screen.getByText("Segment(A, B)")).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.getByText(/Perpendicular to AB/)).toBeInTheDocument();
    expect(screen.getByText(/Passes through the midpoint/)).toBeInTheDocument();
    expect(window.__GEOTUTOR_GGB_EVIDENCE__?.objects).toHaveLength(3);

    const resetButton = screen.getByRole("button", { name: "Reset construction" });
    fireEvent.click(resetButton);
    fireEvent.click(resetButton);
    await act(async () => undefined);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(onConstructionReset).toHaveBeenCalledTimes(1);
    expect(api.setBase64).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
    );

    if (!exerciseRuntime || !toolRuntime) throw new Error("Runtimes were not published.");
    expect(toolRuntime.getContext("turn-idle")?.phase).toBe("idle");
    phase = "exercise_confirmed";
    const context = toolRuntime.getContext("turn-initialize");
    expect(context?.phase).toBe("exercise_confirmed");
    await act(async () => {
      const result = await toolRuntime?.gateway.execute(
        {
          callId: "call-initialize-component",
          name: "initialize_exercise",
          arguments: JSON.stringify({
            planId: confirmation.plan.exerciseId,
            expectedRevision: context?.revision,
          }),
        },
        context!,
      );
      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ status: "initialized" }),
        }),
      );
    });
    expect(toolRuntime.getContext("turn-constructing")?.phase).toBe("constructing");
    expect(coordinates.get("A")).toEqual([-3, 0]);
    expect(coordinates.get("B")).toEqual([3, 0]);
    expect(window.__GEOTUTOR_INITIALIZATION__).toMatchObject({
      status: "initialized",
      created: ["A", "B", "AB"],
    });
    expect(window.__GEOTUTOR_GGB_EVIDENCE__?.objects).toHaveLength(3);

    view.unmount();

    expect(removeExistingApplet).toHaveBeenCalledTimes(1);
    expect(window.__GEOTUTOR_GGB_EVIDENCE__).toBeUndefined();
    expect(window.__GEOTUTOR_INITIALIZATION__).toBeUndefined();
  });
});

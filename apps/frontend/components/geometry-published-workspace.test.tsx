import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TeacherExercisePublicationV2,
  createTeacherGeometryDraftV2,
} from "@/lib/teacher/geometry-exercise";

import { GeometryPublishedWorkspace } from "./geometry-published-workspace";
import { LanguageProvider } from "./language-provider";

const bridge = vi.hoisted(() => ({
  scratchpadProps: undefined as Record<string, unknown> | undefined,
  realtimeProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("./geogebra-scratchpad", () => ({
  GeoGebraScratchpad: (props: Record<string, unknown>) => {
    bridge.scratchpadProps = props;
    return <div data-testid="published-scratchpad" />;
  },
}));

vi.mock("./realtime-spike", () => ({
  RealtimeSpike: (props: Record<string, unknown>) => {
    bridge.realtimeProps = props;
    return <div data-testid="published-coach" />;
  },
}));

afterEach(() => {
  cleanup();
  bridge.scratchpadProps = undefined;
  bridge.realtimeProps = undefined;
});

describe("GeometryPublishedWorkspace", () => {
  it("routes the exact activity, v2 world and investigation tool runtime to the public coach", () => {
    const publication = TeacherExercisePublicationV2.parse({
      ...createTeacherGeometryDraftV2("en"),
      schemaVersion: "teacher_exercise_publication.v2",
      id: "teacher_geometry-bridge",
      publishedAt: 123,
    });
    render(
      <LanguageProvider>
        <GeometryPublishedWorkspace publication={publication} onHome={vi.fn()} />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("published-coach")).toBeInTheDocument();
    expect(screen.getByTestId("published-scratchpad")).toBeInTheDocument();
    expect(bridge.scratchpadProps?.investigation).toBe(
      publication.content.exercise,
    );
    expect(bridge.realtimeProps).toMatchObject({
      tutorProfile: "geogebra_tutor",
      layout: "panorama",
    });

    const toolRuntime = { gateway: {}, getContext: vi.fn() };
    const commit = {
      world: {
        activityId: publication.content.exercise.id,
        epoch: 1,
        revision: 2,
      },
      delta: {
        activityId: publication.content.exercise.id,
        epoch: 1,
        revision: 2,
      },
    };
    const pedagogy = {
      schemaVersion: "geometry_realtime_pedagogy_context.v1",
      activityId: publication.content.exercise.id,
      epoch: 1,
      revision: 2,
      phase: "constructing",
      attemptCount: 0,
      explicitHelpRequestCount: 0,
      missingEvidenceIds: [],
      capturedConfigurations: [],
      maxHelpLevel: 1,
    };
    act(() => {
      (
        bridge.scratchpadProps?.onToolRuntime as (
          runtime: typeof toolRuntime,
        ) => void
      )(toolRuntime);
      (
        bridge.scratchpadProps?.onGeometryWorldCommit as (
          nextCommit: typeof commit,
          nextPedagogy: typeof pedagogy,
        ) => void
      )(commit, pedagogy);
    });
    expect(bridge.realtimeProps?.toolRuntime).toBe(toolRuntime);
    expect(bridge.realtimeProps?.geometryWorldObservation).toEqual({
      commit,
      pedagogy,
    });

    const cancel = vi.fn();
    act(() => {
      (
        bridge.scratchpadProps?.onLearnerInteractionRuntime as (
          runtime: { cancel: typeof cancel },
        ) => void
      )({ cancel });
      (bridge.realtimeProps?.onLearnerSpeechStart as () => void)();
    });
    expect(cancel).toHaveBeenCalledWith("student_speech");
  });
});

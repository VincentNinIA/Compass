import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGeometrySessionStateV1 } from "@/lib/geometry-investigation/session";
import {
  TeacherExercisePublicationV2,
  createTeacherGeometryDraftV2,
} from "@/lib/teacher/geometry-exercise";

import {
  GeometryPublishedWorkspace,
  geometryCoachTurnForMissionTransition,
  geometryMascotFocusFromCommit,
  newlyVerifiedGeometryMissions,
} from "./geometry-published-workspace";
import { LanguageProvider } from "./language-provider";

const bridge = vi.hoisted(() => ({
  scratchpadProps: undefined as Record<string, unknown> | undefined,
  realtimeProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("./geogebra-scratchpad", () => ({
  GeoGebraScratchpad: (props: Record<string, unknown>) => {
    bridge.scratchpadProps = props;
    return (
      <div data-testid="published-scratchpad">
        {props.canvasOverlay as ReactNode}
      </div>
    );
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
  vi.useRealTimers();
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

    const cancelForActivity = vi.fn(() => true);
    act(() => {
      (
        bridge.realtimeProps?.onGeometryCoachRuntime as (
          runtime: {
            requestCoachTurn: () => boolean;
            cancelForActivity: typeof cancelForActivity;
          },
        ) => void
      )({ requestCoachTurn: () => true, cancelForActivity });
      (
        bridge.scratchpadProps?.onLearnerGeometryInteraction as () => void
      )();
    });
    expect(cancelForActivity).toHaveBeenCalledOnce();
    expect(cancelForActivity).toHaveBeenCalledWith("student_drag");
  });

  it("renders the animated coach and finite canvas cameos from learner, hint and verified mission events", () => {
    vi.useFakeTimers();
    const publication = TeacherExercisePublicationV2.parse({
      ...createTeacherGeometryDraftV2("en"),
      schemaVersion: "teacher_exercise_publication.v2",
      id: "teacher_geometry-mascot",
      publishedAt: 123,
    });
    const activity = publication.content.exercise;
    render(
      <LanguageProvider>
        <GeometryPublishedWorkspace publication={publication} onHome={vi.fn()} />
      </LanguageProvider>,
    );

    const coach = () =>
      document.querySelector(".compass-mascot-presence--coach") as HTMLElement;
    expect(coach()).toHaveAttribute("data-placement", "coach");
    expect(coach().querySelectorAll(".compass-mascot-sprite")).toHaveLength(1);
    expect(coach()).toHaveAttribute("data-renderer", "css-compositor");

    const initial = {
      ...createGeometrySessionStateV1(activity),
      phase: "constructing" as const,
      epoch: 1,
      revision: 1,
    };
    act(() => {
      (
        bridge.scratchpadProps?.onGeometryLearningState as (
          state: typeof initial,
        ) => void
      )(initial);
    });
    expect(coach()).toHaveAttribute("data-mascot-state", "receiving");
    expect(screen.getByText("Compass is beside you")).toBeInTheDocument();

    const learnerCommit = {
      world: {
        activityId: activity.id,
        epoch: 1,
        revision: 2,
        change: {
          kind: "select",
          actor: "learner",
          terminal: true,
          objectNames: ["E"],
          occurredAt: 1,
        },
        objects: [{ name: "E", x: 3 }],
      },
      delta: {},
    };
    act(() => {
      (
        bridge.scratchpadProps?.onGeometryWorldCommit as (
          commit: typeof learnerCommit,
        ) => void
      )(learnerCommit);
    });
    expect(coach()).toHaveAttribute("data-focus-side", "right");
    expect(screen.getByText("E")).toBeInTheDocument();
    expect(
      document.querySelector('.geometry-mascot-cameo[data-kind="focus"]'),
    ).toHaveAttribute("data-anchor", "left");

    act(() => {
      (
        bridge.scratchpadProps?.onGeometryLearningDirective as (
          directive: Record<string, unknown>,
        ) => void
      )({
        id: "hint_v1_1",
        missionId: "V1",
        source: "explicit",
        level: 3,
        prompt: "Look at the two endpoints before choosing Midpoint.",
        objectNames: ["A", "B"],
        action: "highlight_geometry_objects",
      });
    });
    expect(coach()).toHaveAttribute("data-mascot-state", "hinting");
    expect(screen.getByText("Hint L3")).toBeInTheDocument();
    expect(screen.getByText("A · B")).toBeInTheDocument();

    const verified = {
      ...initial,
      revision: 3,
      activeMissionId: activity.missions[1]!.id,
      missions: initial.missions.map((mission, index) =>
        index === 0
          ? { ...mission, status: "verified" as const }
          : index === 1
            ? { ...mission, status: "active" as const }
            : mission,
      ),
    };
    act(() => {
      (
        bridge.scratchpadProps?.onGeometryLearningState as (
          state: typeof verified,
        ) => void
      )(verified);
    });
    expect(coach()).toHaveAttribute("data-mascot-state", "celebrating");
    expect(screen.getByText("Proof pinned")).toBeInTheDocument();
    expect(document.querySelectorAll(".geometry-mascot-proof-pins li")).toHaveLength(1);

    act(() => {
      (
        bridge.scratchpadProps?.onGeometryLearningState as (
          state: typeof verified,
        ) => void
      )({ ...verified, revision: 4 });
    });
    expect(document.querySelectorAll(".geometry-mascot-proof-pins li")).toHaveLength(1);
  });

  it("opens one bounded coach turn for orientation, qualified hints and mission advance", () => {
    const publication = TeacherExercisePublicationV2.parse({
      ...createTeacherGeometryDraftV2("en"),
      schemaVersion: "teacher_exercise_publication.v2",
      id: "teacher_geometry-coach-turns",
      publishedAt: 123,
    });
    const activity = publication.content.exercise;
    const initial = {
      ...createGeometrySessionStateV1(activity),
      phase: "constructing" as const,
      epoch: 1,
      revision: 1,
    };
    const requestCoachTurn = vi.fn(() => true);
    const commit = (revision: number) => ({
      world: {
        activityId: activity.id,
        epoch: 1,
        revision,
        change: {
          kind: "initial",
          actor: "system",
          terminal: true,
          objectNames: [],
          occurredAt: revision,
        },
        objects: [],
      },
      delta: {},
    });

    render(
      <LanguageProvider>
        <GeometryPublishedWorkspace publication={publication} onHome={vi.fn()} />
      </LanguageProvider>,
    );
    act(() => {
      (
        bridge.scratchpadProps?.onGeometryLearningState as (
          state: typeof initial,
        ) => void
      )(initial);
      (
        bridge.scratchpadProps?.onGeometryWorldCommit as (
          value: ReturnType<typeof commit>,
        ) => void
      )(commit(1));
    });
    act(() => {
      (
        bridge.realtimeProps?.onGeometryCoachRuntime as (
          runtime: { requestCoachTurn: typeof requestCoachTurn },
        ) => void
      )({ requestCoachTurn });
    });
    expect(requestCoachTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        schemaVersion: "geometry_coach_turn.v1",
        reason: "mission_orientation",
        revision: 1,
        currentMission: expect.objectContaining({ id: "V1" }),
      }),
    );

    act(() => {
      (
        bridge.scratchpadProps?.onGeometryLearningDirective as (
          directive: Record<string, unknown>,
        ) => void
      )({
        id: "hint_v1_dynamic",
        missionId: "V1",
        source: "proactive",
        sourceId: "action_1_1_drag_end",
        level: 1,
        prompt: "Which GeoGebra tool would you use for an exact midpoint?",
        objectNames: ["A", "B"],
        requiresConsent: false,
      });
    });
    expect(requestCoachTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        reason: "learning_hint",
        hint: expect.objectContaining({ source: "proactive", level: 1 }),
      }),
    );

    const advanced = {
      ...initial,
      revision: 2,
      activeMissionId: "V2",
      missions: initial.missions.map((mission, index) =>
        index === 0
          ? { ...mission, status: "verified" as const }
          : index === 1
            ? { ...mission, status: "active" as const }
            : mission,
      ),
    };
    act(() => {
      (
        bridge.scratchpadProps?.onGeometryLearningState as (
          state: typeof advanced,
        ) => void
      )(advanced);
      (
        bridge.scratchpadProps?.onGeometryWorldCommit as (
          value: ReturnType<typeof commit>,
        ) => void
      )(commit(2));
    });
    expect(requestCoachTurn).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        reason: "mission_advanced",
        revision: 2,
        previousMission: expect.objectContaining({
          id: "V1",
          outcome: "verified",
        }),
        currentMission: expect.objectContaining({ id: "V2" }),
      }),
    );

    act(() => {
      (
        bridge.scratchpadProps?.onGeometryLearningState as (
          state: typeof advanced,
        ) => void
      )({ ...advanced, revision: 3 });
    });
    expect(requestCoachTurn).toHaveBeenCalledTimes(3);
  });
});

describe("geometry mascot event derivation", () => {
  it("ignores assistant motion and points from the opposite safe edge for learner objects", () => {
    const base = {
      world: {
        change: {
          kind: "drag_end",
          actor: "learner",
          terminal: true,
          objectNames: ["H"],
        },
        objects: [{ name: "H", x: -2 }],
      },
    };
    expect(geometryMascotFocusFromCommit(base as never)).toEqual({
      targetNames: ["H"],
      focusSide: "left",
      anchorSide: "right",
    });
    expect(
      geometryMascotFocusFromCommit({
        ...base,
        world: {
          ...base.world,
          change: { ...base.world.change, actor: "assistant" },
        },
      } as never),
    ).toBeUndefined();
  });

  it("pins only first transitions to verified, never completed-only missions", () => {
    const publication = TeacherExercisePublicationV2.parse({
      ...createTeacherGeometryDraftV2("en"),
      schemaVersion: "teacher_exercise_publication.v2",
      id: "teacher_geometry-proof-rules",
      publishedAt: 123,
    });
    const activity = publication.content.exercise;
    const initial = createGeometrySessionStateV1(activity);
    const completed = {
      ...initial,
      missions: initial.missions.map((mission, index) =>
        index === 0 ? { ...mission, status: "completed" as const } : mission,
      ),
    };
    const verified = {
      ...completed,
      missions: completed.missions.map((mission, index) =>
        index === 0 ? { ...mission, status: "verified" as const } : mission,
      ),
    };

    expect(
      newlyVerifiedGeometryMissions(initial, completed, activity.missions),
    ).toEqual([]);
    expect(
      newlyVerifiedGeometryMissions(completed, verified, activity.missions),
    ).toEqual([
      expect.objectContaining({ missionId: activity.missions[0]!.id }),
    ]);
    expect(
      newlyVerifiedGeometryMissions(verified, verified, activity.missions),
    ).toEqual([]);
    expect(
      geometryCoachTurnForMissionTransition(
        {
          ...initial,
          activeMissionId: "V1",
        },
        {
          ...verified,
          epoch: 1,
          revision: 2,
          activeMissionId: "V2",
          missions: verified.missions.map((mission, index) =>
            index === 1 ? { ...mission, status: "active" as const } : mission,
          ),
        },
        activity.missions,
      ),
    ).toMatchObject({
      reason: "mission_advanced",
      previousMission: { id: "V1", outcome: "verified" },
      currentMission: { id: "V2" },
    });
  });
});

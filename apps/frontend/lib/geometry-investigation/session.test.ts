import { describe, expect, it } from "vitest";

import type {
  GeometryEvidenceCaptureV1,
  GeometryWorldObjectV2,
} from "./contracts";
import { GeometryWorldV2 } from "./contracts";
import { evaluateGeometryWorldV2 } from "./engine";
import {
  createGeometrySessionStateV1,
  geometryExerciseXpV1,
  reduceGeometrySessionV1,
} from "./session";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

const activity = VARIGNON_ACTIVITY_FR_V1;

describe("geometry investigation session", () => {
  it("waits for the approved scaffold, then verifies V1 and V2 locally", () => {
    let state = createGeometrySessionStateV1(activity);
    state = reduceGeometrySessionV1(activity, state, {
      type: "activity_ready",
      activityId: activity.id,
      epoch: 1,
      revision: 0,
    });
    expect(state.phase).toBe("ready");

    state = reduceGeometrySessionV1(activity, state, {
      type: "world_committed",
      world: evaluatedWorld(),
    });
    expect(state.phase).toBe("exploring");
    expect(state.activeMissionId).toBe("V3");
    expect(state.missions.slice(0, 2).map(({ status }) => status)).toEqual([
      "verified",
      "verified",
    ]);
    expect(geometryExerciseXpV1(state)).toBe(40);
  });

  it("keeps earned XP when a current fact disappears and resets only with a new session", () => {
    let state = stateAtV3();
    expect(geometryExerciseXpV1(state)).toBe(40);

    const previous = state.world!;
    const { configuration: _previousConfiguration, ...previousWithoutConfiguration } =
      previous;
    void _previousConfiguration;
    const regressed = GeometryWorldV2.parse({
      ...previousWithoutConfiguration,
      revision: previous.revision + 1,
      snapshotHash: "hash-regressed",
      objects: previous.objects.map((object) =>
        object.name === "E"
          ? {
              ...object,
              command: "E=(-2.5,-2)",
              parents: [],
              dependencyStatus: "unknown",
            }
          : object,
      ),
      facts: [],
      change: {
        kind: "update",
        objectNames: ["E"],
        terminal: true,
        actor: "learner",
        occurredAt: 2,
      },
    });
    state = reduceGeometrySessionV1(activity, state, {
      type: "world_committed",
      world: evaluateGeometryWorldV2(activity, regressed).world,
    });

    expect(state.missions[0].status).toBe("active");
    expect(geometryExerciseXpV1(state)).toBe(40);
    expect(geometryExerciseXpV1(createGeometrySessionStateV1(activity))).toBe(0);
  });

  it("ignores assistant capture provenance for learner manipulation missions", () => {
    let state = stateAtV3();
    const world = state.world!;
    state = reduceGeometrySessionV1(activity, state, {
      type: "captures_changed",
      activityId: activity.id,
      epoch: world.epoch,
      revision: world.revision,
      captures: [capture("V3", "convex", "assistant_demo", world)],
    });
    expect(state.activeMissionId).toBe("V3");
    expect(state.missions[2]).toMatchObject({
      status: "active",
      missingEvidenceIds: ["learner_capture_V3"],
    });

    state = reduceGeometrySessionV1(activity, state, {
      type: "captures_changed",
      activityId: activity.id,
      epoch: world.epoch,
      revision: world.revision,
      captures: [capture("V3", "convex", "learner", world)],
    });
    expect(state.activeMissionId).toBe("V4");
  });

  it("advances all nine missions in order and computes honest 20/10 XP", () => {
    let state = stateAtV3();
    const world = state.world!;
    state = reduceGeometrySessionV1(activity, state, {
      type: "captures_changed",
      activityId: activity.id,
      epoch: world.epoch,
      revision: world.revision,
      captures: [
        capture("V3", "convex", "learner", world),
        capture("V4", "concave", "learner", world),
        capture("V5", "crossed", "learner", world),
      ],
    });
    expect(state.activeMissionId).toBe("V6");

    state = reduceGeometrySessionV1(activity, state, {
      type: "reflection_completed",
      activityId: activity.id,
      epoch: state.epoch,
      revision: state.revision,
      reflectionId: "conjecture_1",
      kind: "conjecture",
      hasText: true,
    });
    expect(state.activeMissionId).toBe("V8");
    expect(state.missions[6].status).toBe("verified");

    for (const step of activity.demonstrationSteps) {
      state = reduceGeometrySessionV1(activity, state, {
        type: "justification_step_completed",
        activityId: activity.id,
        epoch: state.epoch,
        revision: state.revision,
        completionId: `learner_${step.id}`,
        stepId: step.id,
      });
    }
    expect(state.activeMissionId).toBe("V9");

    state = reduceGeometrySessionV1(activity, state, {
      type: "reflection_completed",
      activityId: activity.id,
      epoch: state.epoch,
      revision: state.revision,
      reflectionId: "transfer_1",
      kind: "transfer",
      hasText: true,
    });
    expect(state.phase).toBe("completed");
    expect(state.activeMissionId).toBeUndefined();
    expect(state.missions.map(({ status }) => status)).toEqual([
      "verified",
      "verified",
      "verified",
      "verified",
      "verified",
      "completed",
      "verified",
      "verified",
      "completed",
    ]);
    expect(geometryExerciseXpV1(state)).toBe(160);
  });

  it("records demonstration_viewed without completing learner justification", () => {
    let state = stateAtV3();
    const world = state.world!;
    state = reduceGeometrySessionV1(activity, state, {
      type: "demonstration_viewed",
      activityId: activity.id,
      epoch: world.epoch,
      revision: world.revision,
      stepId: "demo_v8_7",
    });
    expect(state.demonstrationsViewed).toEqual(["demo_v8_7"]);
    expect(state.reflections.completedJustificationStepIds).toEqual([]);
    expect(state.missions[7].status).toBe("locked");
  });

  it("counts the same unresolved block and rejects duplicate or stale attempts", () => {
    let state = stateAtV3();
    const anchor = {
      activityId: activity.id,
      epoch: state.epoch,
      revision: state.revision,
      missionId: "V3",
    };
    state = reduceGeometrySessionV1(activity, state, {
      type: "attempt_recorded",
      ...anchor,
      actionId: "attempt_1",
    });
    state = reduceGeometrySessionV1(activity, state, {
      type: "attempt_recorded",
      ...anchor,
      actionId: "attempt_2",
    });
    expect(state.attempts.V3).toMatchObject({
      count: 2,
      repeatedBlockCount: 2,
      lastMissingSignature: "learner_capture_V3",
    });
    const accepted = state;
    state = reduceGeometrySessionV1(activity, state, {
      type: "attempt_recorded",
      ...anchor,
      actionId: "attempt_2",
    });
    expect(state.rejectionCount).toBe(accepted.rejectionCount + 1);
    expect(state.attempts.V3.count).toBe(2);
  });

  it("uses recovering only around restore and reserves fatal for verified failure", () => {
    let state = stateAtV3();
    state = reduceGeometrySessionV1(activity, state, {
      type: "restore_started",
      activityId: activity.id,
      epoch: state.epoch,
      revision: state.revision,
    });
    expect(state.phase).toBe("recovering");
    state = reduceGeometrySessionV1(activity, state, {
      type: "restore_completed",
      world: evaluatedWorld(2, 3),
    });
    expect(state.phase).toBe("exploring");
    state = reduceGeometrySessionV1(activity, state, {
      type: "fatal",
      activityId: activity.id,
      reason: "baseline diverged",
    });
    expect(state).toMatchObject({
      phase: "fatal",
      fatalReason: "baseline diverged",
    });
  });
});

function stateAtV3() {
  let state = createGeometrySessionStateV1(activity);
  state = reduceGeometrySessionV1(activity, state, {
    type: "activity_ready",
    activityId: activity.id,
    epoch: 1,
    revision: 0,
  });
  return reduceGeometrySessionV1(activity, state, {
    type: "world_committed",
    world: evaluatedWorld(),
  });
}

function evaluatedWorld(epoch = 1, revision = 1) {
  const objects: GeometryWorldObjectV2[] = [
    point("A", -4, -1, "A=(-4,-1)", "scaffold"),
    point("B", -1, -3, "B=(-1,-3)", "scaffold"),
    point("C", 4, -1, "C=(4,-1)", "scaffold"),
    point("D", 1, 3, "D=(1,3)", "scaffold"),
    segment("AB", ["A", "B"], "scaffold"),
    segment("BC", ["B", "C"], "scaffold"),
    segment("CD", ["C", "D"], "scaffold"),
    segment("DA", ["D", "A"], "scaffold"),
    midpoint("E", -2.5, -2, ["A", "B"]),
    midpoint("F", 1.5, -2, ["B", "C"]),
    midpoint("G", 2.5, 1, ["C", "D"]),
    midpoint("H", -1.5, 1, ["D", "A"]),
    segment("EF", ["E", "F"], "student"),
    segment("FG", ["F", "G"], "student"),
    segment("GH", ["G", "H"], "student"),
    segment("HE", ["H", "E"], "student"),
  ];
  const world = GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId: activity.id,
    epoch,
    revision,
    snapshotHash: `hash-${epoch}-${revision}`,
    objectCount: objects.length,
    truncated: false,
    objects,
    facts: [],
    change: {
      kind: "drag_end",
      objectNames: ["A"],
      terminal: true,
      actor: "learner",
      occurredAt: revision,
    },
  });
  return evaluateGeometryWorldV2(activity, world).world;
}

function capture(
  missionId: "V3" | "V4" | "V5",
  configuration: "convex" | "concave" | "crossed",
  actor: "learner" | "assistant_demo",
  world: ReturnType<typeof evaluatedWorld>,
): GeometryEvidenceCaptureV1 {
  return {
    schemaVersion: "geometry_evidence_capture.v1",
    id: `capture_${missionId}_${actor}`,
    activityId: activity.id,
    missionId,
    configuration,
    epoch: world.epoch,
    revision: world.revision,
    snapshotHash: `${world.snapshotHash}_${configuration}`,
    checkpointId: `checkpoint_${missionId}_${actor}`,
    objectNames: world.objects.map(({ name }) => name),
    factIds: [
      `rel_configuration_${configuration}`,
      "rel_parallel_ef_gh",
      "rel_parallel_fg_he",
    ],
    createdAt: world.revision,
    actor,
  };
}

function point(
  name: string,
  x: number,
  y: number,
  command: string,
  owner: "scaffold" | "student",
): GeometryWorldObjectV2 {
  return {
    name,
    type: "point",
    command,
    parents: [],
    dependencyStatus: "known",
    owner,
    x,
    y,
    visible: true,
  };
}

function midpoint(
  name: string,
  x: number,
  y: number,
  parents: [string, string],
): GeometryWorldObjectV2 {
  return {
    ...point(name, x, y, `${name}=Midpoint(${parents.join(",")})`, "student"),
    parents,
  };
}

function segment(
  name: string,
  parents: [string, string],
  owner: "scaffold" | "student",
): GeometryWorldObjectV2 {
  return {
    name,
    type: "segment",
    command: `${name}=Segment(${parents.join(",")})`,
    parents,
    dependencyStatus: "known",
    owner,
    visible: true,
  };
}

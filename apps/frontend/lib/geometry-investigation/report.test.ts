import { describe, expect, it } from "vitest";

import type {
  GeometryEvidenceCaptureV1,
  GeometryFactV1,
  GeometryWorldV2,
} from "./contracts";
import { createGeometryLearningSessionReportV1 } from "./report";
import type { GeometrySessionStateV1 } from "./session";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

const activity = VARIGNON_ACTIVITY_FR_V1;

describe("geometry learning report", () => {
  it("exports only closed counters and excludes assistant capture credit", () => {
    const report = createGeometryLearningSessionReportV1(
      activity,
      completedState(),
      42,
    );
    expect(report).toEqual({
      schemaVersion: "geometry_learning_session_report.v1",
      exerciseId: activity.id,
      totalMissions: 9,
      completedMissions: 9,
      verifiedMissions: 7,
      capturedConfigurations: ["convex", "concave", "crossed"],
      exactMidpoints: 4,
      verifiedParallelPairs: 6,
      conjectureCompleted: true,
      justificationCompleted: true,
      transferCompleted: true,
      assistance: { highestLevelUsed: 4, demonstrationsViewed: 1 },
      exerciseXp: 160,
      updatedAt: 42,
    });
    expect(JSON.stringify(report)).not.toMatch(
      /conjectureText|transferText|transcript|name|coordinates|base64/i,
    );
  });
});

function completedState(): GeometrySessionStateV1 {
  const world = worldWithMidpoints();
  const learnerCaptures = [
    capture("V3", "convex", "learner"),
    capture("V4", "concave", "learner"),
    capture("V5", "crossed", "learner"),
  ] as const;
  return {
    activityId: activity.id,
    epoch: 1,
    revision: 9,
    phase: "completed",
    world,
    captures: [...learnerCaptures, capture("V3", "convex", "assistant_demo")],
    missions: activity.missions.map((mission) => ({
      missionId: mission.id,
      order: mission.order,
      status: ["V6", "V9"].includes(mission.id) ? "completed" : "verified",
      evidenceIds: [],
      missingEvidenceIds: [],
      completedAtRevision: mission.order,
    })),
    reflections: {
      conjectureCompleted: true,
      transferCompleted: true,
      completedJustificationStepIds: activity.demonstrationSteps.map(({ id }) => id),
    },
    attempts: {},
    processedReflectionIds: ["conjecture_1", "transfer_1"],
    demonstrationsViewed: ["demo_v8_7"],
    assistance: { highestLevelUsed: 4, deliveredDirectiveIds: ["directive_1"] },
    xpLedger: Object.fromEntries(
      activity.missions.map((mission) => [
        mission.id,
        ["V6", "V9"].includes(mission.id) ? 10 : 20,
      ]),
    ),
    rejectionCount: 0,
  };
}

function worldWithMidpoints(): GeometryWorldV2 {
  const facts: GeometryFactV1[] = ["e", "f", "g", "h"].map((suffix) => ({
    id: `rel_midpoint_${suffix}`,
    relation: "midpoint",
    objects: [suffix.toUpperCase(), "A", "B"],
    pass: true,
    observed: [0],
    tolerance: 0.000001,
    toleranceVersion: "geometry-tolerance.v1",
    epoch: 1,
    revision: 9,
    snapshotHash: "report-hash",
  }));
  return {
    schemaVersion: "geometry_world.v2",
    activityId: activity.id,
    epoch: 1,
    revision: 9,
    snapshotHash: "report-hash",
    objectCount: 1,
    truncated: false,
    objects: [
      {
        name: "A",
        type: "point",
        command: "A=(0,0)",
        parents: [],
        dependencyStatus: "known",
        owner: "scaffold",
        x: 0,
        y: 0,
        visible: true,
      },
    ],
    facts,
    change: {
      kind: "initial",
      objectNames: ["A"],
      terminal: true,
      actor: "system",
      occurredAt: 1,
    },
  };
}

function capture(
  missionId: "V3" | "V4" | "V5",
  configuration: "convex" | "concave" | "crossed",
  actor: "learner" | "assistant_demo",
): GeometryEvidenceCaptureV1 {
  return {
    schemaVersion: "geometry_evidence_capture.v1",
    id: `capture_${missionId}_${actor}`,
    activityId: activity.id,
    missionId,
    configuration,
    epoch: 1,
    revision: 9,
    snapshotHash: `hash_${missionId}_${actor}`,
    checkpointId: `checkpoint_${missionId}_${actor}`,
    objectNames: ["A"],
    factIds: ["rel_parallel_ef_gh", "rel_parallel_fg_he"],
    createdAt: 1,
    actor,
  };
}

import { describe, expect, it } from "vitest";

import {
  GeometryEvidenceCaptureV1,
  GeometryInvestigationV1,
  GeometryLearningSessionReportV1,
  GeometryWorldV2,
  TeacherExerciseV2,
  parseGeometryInvestigationV1,
} from "./contracts";
import {
  VARIGNON_ACTIVITY_EN_V1,
  VARIGNON_ACTIVITY_FR_V1,
  VARIGNON_MISSION_COUNT,
  VARIGNON_RELATION_COUNT,
} from "./varignon";

describe("GeometryInvestigationV1", () => {
  it.each([
    ["fr", VARIGNON_ACTIVITY_FR_V1],
    ["en", VARIGNON_ACTIVITY_EN_V1],
  ] as const)("parses the complete %s Varignon fixture", (locale, fixture) => {
    const parsed = parseGeometryInvestigationV1(fixture);

    expect(parsed.locale).toBe(locale);
    expect(parsed.template).toBe("varignon.v1");
    expect(parsed.missions).toHaveLength(VARIGNON_MISSION_COUNT);
    expect(parsed.relationDefinitions).toHaveLength(VARIGNON_RELATION_COUNT);
    expect(parsed.missions.map(({ order }) => order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(parsed.scaffold.freePoints.map(({ label }) => label)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("rejects unknown fields without returning a partial activity", () => {
    const input = cloneActivity();
    Object.assign(input, { evalCommand: "DeleteAll()" });

    const result = GeometryInvestigationV1.safeParse(input);

    expect(result.success).toBe(false);
    expect("data" in result).toBe(false);
  });

  it("rejects duplicate scaffold labels", () => {
    const input = cloneActivity();
    input.scaffold.freePoints[1].label = "A";

    expect(GeometryInvestigationV1.safeParse(input).success).toBe(false);
  });

  it("rejects non-sequential missions and undeclared relations", () => {
    const unordered = cloneActivity();
    unordered.missions[3].order = 9;
    const missingRelation = cloneActivity();
    missingRelation.missions[0].requiredEvidence = ["rel_not_declared"];

    expect(GeometryInvestigationV1.safeParse(unordered).success).toBe(false);
    expect(GeometryInvestigationV1.safeParse(missingRelation).success).toBe(false);
  });

  it("rejects non-finite coordinates and incoherent assistance policy", () => {
    const nonFinite = cloneActivity();
    nonFinite.scaffold.freePoints[0].x = Number.POSITIVE_INFINITY;
    const incoherent = cloneActivity();
    incoherent.assistancePolicy.mode = "light";
    incoherent.assistancePolicy.maxProactiveLevel = 2;

    expect(GeometryInvestigationV1.safeParse(nonFinite).success).toBe(false);
    expect(GeometryInvestigationV1.safeParse(incoherent).success).toBe(false);
  });
});

describe("geometry investigation supporting contracts", () => {
  const world = {
    schemaVersion: "geometry_world.v2",
    activityId: "varignon_fr_v1",
    epoch: 2,
    revision: 4,
    snapshotHash: "fnv1a32:12345678",
    objectCount: 1,
    truncated: false,
    objects: [
      {
        name: "A",
        type: "point",
        command: "A=(-4,-1)",
        parents: [],
        dependencyStatus: "known",
        owner: "scaffold",
        x: -4,
        y: -1,
        color: "#000000",
        visible: true,
      },
    ],
    facts: [
      {
        id: "fact_non_collinear",
        relation: "non_collinear",
        objects: ["A", "B", "C"],
        pass: true,
        observed: [8],
        tolerance: 1e-7,
        toleranceVersion: "scaled-area-v1",
        epoch: 2,
        revision: 4,
        snapshotHash: "fnv1a32:12345678",
      },
    ],
    change: {
      kind: "initial",
      objectNames: ["A"],
      terminal: true,
      actor: "system",
      occurredAt: 10,
    },
  };

  it("parses a bounded world and rejects stale facts", () => {
    expect(GeometryWorldV2.parse(world).objects).toHaveLength(1);
    const stale = structuredClone(world);
    stale.facts[0].revision = 3;

    expect(GeometryWorldV2.safeParse(stale).success).toBe(false);
  });

  it("keeps experimental capture provenance closed", () => {
    const capture = {
      schemaVersion: "geometry_evidence_capture.v1",
      id: "capture_convex_1",
      activityId: "varignon_fr_v1",
      missionId: "V3",
      configuration: "convex",
      epoch: 2,
      revision: 4,
      snapshotHash: "fnv1a32:12345678",
      checkpointId: "checkpoint_convex_1",
      objectNames: ["A", "B", "C", "D", "E", "F", "G", "H"],
      factIds: ["rel_parallel_ef_gh", "rel_parallel_fg_he"],
      createdAt: 10,
      actor: "learner",
    };

    expect(GeometryEvidenceCaptureV1.parse(capture).actor).toBe("learner");
    expect(
      GeometryEvidenceCaptureV1.safeParse({ ...capture, learnerName: "Ada" })
        .success,
    ).toBe(false);
  });

  it("accepts only internally coherent anonymous learning reports", () => {
    const report = {
      schemaVersion: "geometry_learning_session_report.v1",
      exerciseId: "varignon_fr_v1",
      totalMissions: 9,
      completedMissions: 6,
      verifiedMissions: 5,
      capturedConfigurations: ["convex", "concave", "crossed"],
      exactMidpoints: 4,
      verifiedParallelPairs: 6,
      conjectureCompleted: true,
      justificationCompleted: false,
      transferCompleted: false,
      assistance: { highestLevelUsed: 3, demonstrationsViewed: 0 },
      exerciseXp: 120,
      updatedAt: 10,
    };

    expect(GeometryLearningSessionReportV1.parse(report).totalMissions).toBe(9);
    expect(
      GeometryLearningSessionReportV1.safeParse({
        ...report,
        verifiedMissions: 7,
      }).success,
    ).toBe(false);
    expect(
      GeometryLearningSessionReportV1.safeParse({
        ...report,
        conjectureText: "It is a parallelogram",
      }).success,
    ).toBe(false);
  });

  it("parses the future teacher discriminant without changing publication", () => {
    expect(
      TeacherExerciseV2.parse({
        kind: "geometry_investigation",
        exercise: VARIGNON_ACTIVITY_EN_V1,
      }).kind,
    ).toBe("geometry_investigation");
    expect(
      TeacherExerciseV2.safeParse({
        kind: "geometry_investigation",
        exercise: VARIGNON_ACTIVITY_EN_V1,
        publishedAt: 10,
      }).success,
    ).toBe(false);
  });
});

function cloneActivity(): GeometryInvestigationV1 {
  return structuredClone(VARIGNON_ACTIVITY_FR_V1);
}

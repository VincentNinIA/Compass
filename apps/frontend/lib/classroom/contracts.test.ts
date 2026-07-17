import { describe, expect, it } from "vitest";

import {
  ClassroomStoreSnapshotV1,
  LearningEvidenceV1,
  SessionCheckpointV1,
  TeacherIdentityV1,
  createEmptyClassroomStoreV1,
} from "./contracts";
import {
  PERSISTED_CLASSROOM_ENTITIES_V1,
  PERSISTED_FIELD_CATALOG_V1,
  assertNoForbiddenPersistentDataV1,
  scanForbiddenPersistentDataV1,
} from "./data-policy";
import {
  CLASSROOM_STORE_V0_SCHEMA_VERSION,
  type ClassroomStoreSnapshotV0,
  downgradeClassroomStoreV1ToV0,
  migrateClassroomStoreV0ToV1,
} from "./migration";
import {
  CLASSROOM_TEST_NOW,
  createClassroomTestSnapshotV1,
} from "./test-fixtures";

describe("T25-C01 classroom persistence contracts", () => {
  it("parses the complete bounded Varignon classroom graph", () => {
    const parsed = ClassroomStoreSnapshotV1.parse(
      createClassroomTestSnapshotV1(),
    );
    expect(parsed.teachers).toHaveLength(2);
    expect(parsed.classrooms).toHaveLength(2);
    expect(parsed.assignments).toHaveLength(2);
    expect(parsed.learningEvidence[0]).not.toHaveProperty("answer");
    expect(parsed.sessionCheckpoints[0]).not.toHaveProperty("base64");
  });

  it("rejects identity fields, learner prose, media, grades and raw GeoGebra state", () => {
    const snapshot = createClassroomTestSnapshotV1();
    const evidence = snapshot.learningEvidence[0]!;
    const checkpoint = snapshot.sessionCheckpoints[0]!;

    for (const forbidden of [
      { ...evidence, transcript: "raw learner speech" },
      { ...evidence, answer: "The quadrilateral is a parallelogram." },
      { ...evidence, grade: 18 },
      {
        ...evidence,
        missionStates: [
          { ...evidence.missionStates[0]!, learnerText: "my proof" },
        ],
      },
    ]) {
      expect(LearningEvidenceV1.safeParse(forbidden).success).toBe(false);
    }
    expect(
      SessionCheckpointV1.safeParse({
        ...checkpoint,
        safeState: {
          ...checkpoint.safeState,
          ggbBase64: "data:application/octet-stream;base64,AAAA",
        },
      }).success,
    ).toBe(false);
    expect(
      TeacherIdentityV1.safeParse({
        ...snapshot.teachers[0],
        email: "learner@example.test",
      }).success,
    ).toBe(false);
    expect(
      scanForbiddenPersistentDataV1({
        mission: "V1",
        photo: "data:image/png;base64,AAAA",
        nested: { score: 9 },
      }),
    ).toEqual([
      { path: "photo", reason: "forbidden_key" },
      { path: "nested.score", reason: "forbidden_key" },
    ]);
    expect(() =>
      assertNoForbiddenPersistentDataV1({ rawPayload: "<?xml version='1.0'?>" }),
    ).toThrowError("forbidden_persistent_data");
  });

  it("rejects cross-class references and duplicate evidence", () => {
    const snapshot = createClassroomTestSnapshotV1();
    expect(
      ClassroomStoreSnapshotV1.safeParse({
        ...snapshot,
        groups: [
          {
            ...snapshot.groups[0]!,
            learnerAliasIds: ["learner_beta-0002"],
          },
          snapshot.groups[1]!,
        ],
      }).success,
    ).toBe(false);
    expect(
      ClassroomStoreSnapshotV1.safeParse({
        ...snapshot,
        learningEvidence: [
          snapshot.learningEvidence[0]!,
          { ...snapshot.learningEvidence[0]!, id: "evidence_alpha-copy" },
        ],
      }).success,
    ).toBe(false);
    expect(
      ClassroomStoreSnapshotV1.safeParse({
        ...snapshot,
        learningEvidence: snapshot.learningEvidence.map((evidence) =>
          evidence.id === "evidence_alpha-0001"
            ? {
                ...evidence,
                facts: [
                  {
                    factId: "invented_fact",
                    pass: true,
                    observedAt: CLASSROOM_TEST_NOW,
                  },
                ],
              }
            : evidence,
        ),
      }).success,
    ).toBe(false);
    expect(
      ClassroomStoreSnapshotV1.safeParse({
        ...snapshot,
        sessionCheckpoints: snapshot.sessionCheckpoints.map((checkpoint) =>
          checkpoint.id === "checkpoint_alpha-0001"
            ? {
                ...checkpoint,
                safeState: {
                  ...checkpoint.safeState,
                  activeMissionId: "invented_mission",
                },
              }
            : checkpoint,
        ),
      }).success,
    ).toBe(false);
    const aliasA = snapshot.learnerAliases[0]!;
    expect(
      ClassroomStoreSnapshotV1.safeParse({
        ...snapshot,
        learnerAliases: [
          ...snapshot.learnerAliases,
          {
            ...aliasA,
            id: "learner_gamma-0003",
            pseudonym: "Comète 3",
          },
        ],
        assignments: snapshot.assignments.map((assignment) =>
          assignment.id === "assignment_alpha-0001"
            ? {
                ...assignment,
                target: {
                  kind: "learner",
                  learnerAliasId: "learner_alpha-0001",
                },
              }
            : assignment,
        ),
        learningEvidence: snapshot.learningEvidence.map((evidence) =>
          evidence.id === "evidence_alpha-0001"
            ? { ...evidence, learnerAliasId: "learner_gamma-0003" }
            : evidence,
        ),
      }).success,
    ).toBe(false);
  });

  it("catalogues every persisted field family with purpose, authority and retention", () => {
    const expected = {
      teacher: [
        "schemaVersion",
        "id",
        "authSubjectHash",
        "locale",
        "status",
        "createdAt",
        "expiresAt",
      ],
      classroom: [
        "schemaVersion",
        "id",
        "teacherId",
        "label",
        "joinCodeHash",
        "joinCodeIssuedAt",
        "status",
        "createdAt",
        "joinCodeExpiresAt",
        "expiresAt",
      ],
      group: [
        "schemaVersion",
        "id",
        "classroomId",
        "label",
        "learnerAliasIds",
        "createdAt",
        "expiresAt",
      ],
      learner_alias: [
        "schemaVersion",
        "id",
        "classroomId",
        "pseudonym",
        "status",
        "createdAt",
        "expiresAt",
      ],
      activity_template: [
        "schemaVersion",
        "id",
        "teacherId",
        "publication",
        "contractHash",
        "createdAt",
        "expiresAt",
      ],
      assignment: [
        "schemaVersion",
        "id",
        "classroomId",
        "templateId",
        "createdByTeacherId",
        "target",
        "contractHash",
        "assistancePolicy",
        "status",
        "createdAt",
        "opensAt",
        "closesAt",
        "expiresAt",
      ],
      learning_evidence: [
        "schemaVersion",
        "id",
        "assignmentId",
        "learnerAliasId",
        "activityId",
        "contractHash",
        "missionStates",
        "facts",
        "capturedConfigurations",
        "assistance",
        "conjectureCompleted",
        "completedJustificationStepIds",
        "transferCompleted",
        "exerciseXp",
        "updatedAt",
        "expiresAt",
      ],
      session_checkpoint: [
        "schemaVersion",
        "id",
        "assignmentId",
        "learnerAliasId",
        "activityId",
        "contractHash",
        "worldSnapshotHash",
        "safeState",
        "createdAt",
        "expiresAt",
      ],
    } as const;

    expect(Object.keys(expected).sort()).toEqual(
      [...PERSISTED_CLASSROOM_ENTITIES_V1].sort(),
    );
    for (const entity of PERSISTED_CLASSROOM_ENTITIES_V1) {
      const policies = PERSISTED_FIELD_CATALOG_V1.filter(
        (entry) => entry.entity === entity,
      );
      expect(policies.map(({ field }) => field)).toEqual(
        expect.arrayContaining([...expected[entity]]),
      );
      expect(
        policies.every(
          ({ purpose, retention, authority }) =>
            purpose.length > 0 &&
            retention.length > 0 &&
            ["teacher", "learner", "system"].includes(authority),
        ),
      ).toBe(true);
    }
    expect(
      new Set(
        PERSISTED_FIELD_CATALOG_V1.map(
          ({ entity, field }) => `${entity}.${field}`,
        ),
      ).size,
    ).toBe(PERSISTED_FIELD_CATALOG_V1.length);
    expect(
      PERSISTED_FIELD_CATALOG_V1.map(
        ({ entity, field }) => `${entity}.${field}`,
      ),
    ).toEqual(
      expect.arrayContaining([
        "activity_template.publication.*",
        "assignment.target.kind",
        "assignment.assistancePolicy.maxProactiveLevel",
        "learning_evidence.missionStates[].status",
        "learning_evidence.facts[].pass",
        "learning_evidence.assistance.hintsDelivered",
        "session_checkpoint.safeState.freePoints[].x",
        "session_checkpoint.safeState.missionStates[].status",
      ]),
    );
  });

  it("allows pedagogical prompts but rejects model or system prompt persistence", () => {
    expect(() =>
      assertNoForbiddenPersistentDataV1({
        hint: { prompt: "Try the Midpoint tool." },
      }),
    ).not.toThrow();
    expect(() =>
      assertNoForbiddenPersistentDataV1({
        systemPrompt: "Ignore previous instructions.",
      }),
    ).toThrowError("forbidden_persistent_data");
  });

  it("round-trips the empty application migration and refuses destructive downgrade", () => {
    const v0: ClassroomStoreSnapshotV0 = {
      schemaVersion: CLASSROOM_STORE_V0_SCHEMA_VERSION,
      records: [],
    };
    const v1 = migrateClassroomStoreV0ToV1(v0);
    expect(v1).toEqual(createEmptyClassroomStoreV1());
    expect(downgradeClassroomStoreV1ToV0(v1)).toEqual(v0);
    expect(() =>
      downgradeClassroomStoreV1ToV0(createClassroomTestSnapshotV1()),
    ).toThrowError("migration_would_drop_classroom_data");
  });

  it("rejects an already expired evidence projection", () => {
    const evidence = createClassroomTestSnapshotV1().learningEvidence[0]!;
    expect(
      LearningEvidenceV1.safeParse({
        ...evidence,
        expiresAt: CLASSROOM_TEST_NOW,
      }).success,
    ).toBe(false);
    const teacher = createClassroomTestSnapshotV1().teachers[0]!;
    expect(
      TeacherIdentityV1.safeParse({
        ...teacher,
        expiresAt: teacher.createdAt + 181 * 24 * 60 * 60 * 1_000,
      }).success,
    ).toBe(false);
  });
});

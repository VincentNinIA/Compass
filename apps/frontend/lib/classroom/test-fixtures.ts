import {
  TeacherExercisePublicationV2,
  createTeacherGeometryDraftV2,
} from "@/lib/teacher/geometry-exercise";

import {
  CLASSROOM_GROUP_SCHEMA_VERSION,
  CLASSROOM_SCHEMA_VERSION,
  CLASSROOM_STORE_SCHEMA_VERSION,
  CLASS_ACTIVITY_TEMPLATE_SCHEMA_VERSION,
  CLASS_ASSIGNMENT_SCHEMA_VERSION,
  LEARNER_ALIAS_SCHEMA_VERSION,
  LEARNING_EVIDENCE_SCHEMA_VERSION,
  SESSION_CHECKPOINT_SCHEMA_VERSION,
  TEACHER_IDENTITY_SCHEMA_VERSION,
  type ClassroomStoreSnapshotV1,
} from "./contracts";

export const CLASSROOM_TEST_NOW = 1_800_000_000_000;
export const CLASSROOM_TEST_DAY = 24 * 60 * 60 * 1_000;
export const CLASSROOM_TEST_HASH_A = "a".repeat(64);
export const CLASSROOM_TEST_HASH_B = "b".repeat(64);
export const CLASSROOM_TEST_JOIN_HASH = `scrypt-v1$${"s".repeat(22)}$${"d".repeat(43)}`;

export function createClassroomTestSnapshotV1(): ClassroomStoreSnapshotV1 {
  const createdAt = CLASSROOM_TEST_NOW - CLASSROOM_TEST_DAY;
  const expiresAt = createdAt + 90 * CLASSROOM_TEST_DAY;
  const closesAt = CLASSROOM_TEST_NOW + 10 * CLASSROOM_TEST_DAY;
  const assignmentExpiresAt = closesAt + 30 * CLASSROOM_TEST_DAY;
  const publicationA = TeacherExercisePublicationV2.parse({
    ...createTeacherGeometryDraftV2("en"),
    schemaVersion: "teacher_exercise_publication.v2",
    id: "teacher_varignon-a001",
    publishedAt: createdAt,
  });
  const publicationB = TeacherExercisePublicationV2.parse({
    ...createTeacherGeometryDraftV2("fr"),
    schemaVersion: "teacher_exercise_publication.v2",
    id: "teacher_varignon-b001",
    publishedAt: createdAt,
  });

  return {
    schemaVersion: CLASSROOM_STORE_SCHEMA_VERSION,
    teachers: [
      {
        schemaVersion: TEACHER_IDENTITY_SCHEMA_VERSION,
        id: "teacher_alpha-0001",
        authSubjectHash: `sha256:${"1".repeat(64)}`,
        locale: "en",
        status: "active",
        createdAt,
        expiresAt,
      },
      {
        schemaVersion: TEACHER_IDENTITY_SCHEMA_VERSION,
        id: "teacher_beta-0002",
        authSubjectHash: `sha256:${"2".repeat(64)}`,
        locale: "fr",
        status: "active",
        createdAt,
        expiresAt,
      },
    ],
    classrooms: [
      {
        schemaVersion: CLASSROOM_SCHEMA_VERSION,
        id: "classroom_alpha-0001",
        teacherId: "teacher_alpha-0001",
        label: "Geometry A",
        joinCodeHash: CLASSROOM_TEST_JOIN_HASH,
        joinCodeIssuedAt: CLASSROOM_TEST_NOW,
        status: "active",
        createdAt,
        joinCodeExpiresAt: CLASSROOM_TEST_NOW + CLASSROOM_TEST_DAY,
        expiresAt,
      },
      {
        schemaVersion: CLASSROOM_SCHEMA_VERSION,
        id: "classroom_beta-0002",
        teacherId: "teacher_beta-0002",
        label: "Géométrie B",
        joinCodeHash: CLASSROOM_TEST_JOIN_HASH,
        joinCodeIssuedAt: CLASSROOM_TEST_NOW,
        status: "active",
        createdAt,
        joinCodeExpiresAt: CLASSROOM_TEST_NOW + CLASSROOM_TEST_DAY,
        expiresAt,
      },
    ],
    groups: [
      {
        schemaVersion: CLASSROOM_GROUP_SCHEMA_VERSION,
        id: "group_alpha-0001",
        classroomId: "classroom_alpha-0001",
        label: "Guided",
        learnerAliasIds: ["learner_alpha-0001"],
        createdAt,
        expiresAt,
      },
      {
        schemaVersion: CLASSROOM_GROUP_SCHEMA_VERSION,
        id: "group_beta-0002",
        classroomId: "classroom_beta-0002",
        label: "Standard",
        learnerAliasIds: ["learner_beta-0002"],
        createdAt,
        expiresAt,
      },
    ],
    learnerAliases: [
      {
        schemaVersion: LEARNER_ALIAS_SCHEMA_VERSION,
        id: "learner_alpha-0001",
        classroomId: "classroom_alpha-0001",
        pseudonym: "Orion 7",
        status: "active",
        createdAt,
        expiresAt,
      },
      {
        schemaVersion: LEARNER_ALIAS_SCHEMA_VERSION,
        id: "learner_beta-0002",
        classroomId: "classroom_beta-0002",
        pseudonym: "Soleil 4",
        status: "active",
        createdAt,
        expiresAt,
      },
    ],
    activityTemplates: [
      {
        schemaVersion: CLASS_ACTIVITY_TEMPLATE_SCHEMA_VERSION,
        id: "template_alpha-0001",
        teacherId: "teacher_alpha-0001",
        publication: publicationA,
        contractHash: CLASSROOM_TEST_HASH_A,
        createdAt,
        expiresAt,
      },
      {
        schemaVersion: CLASS_ACTIVITY_TEMPLATE_SCHEMA_VERSION,
        id: "template_beta-0002",
        teacherId: "teacher_beta-0002",
        publication: publicationB,
        contractHash: CLASSROOM_TEST_HASH_B,
        createdAt,
        expiresAt,
      },
    ],
    assignments: [
      {
        schemaVersion: CLASS_ASSIGNMENT_SCHEMA_VERSION,
        id: "assignment_alpha-0001",
        classroomId: "classroom_alpha-0001",
        templateId: "template_alpha-0001",
        createdByTeacherId: "teacher_alpha-0001",
        target: {
          kind: "classroom",
          classroomId: "classroom_alpha-0001",
        },
        contractHash: CLASSROOM_TEST_HASH_A,
        assistancePolicy: publicationA.content.exercise.assistancePolicy,
        status: "active",
        createdAt,
        opensAt: CLASSROOM_TEST_NOW - CLASSROOM_TEST_DAY / 2,
        closesAt,
        expiresAt: assignmentExpiresAt,
      },
      {
        schemaVersion: CLASS_ASSIGNMENT_SCHEMA_VERSION,
        id: "assignment_beta-0002",
        classroomId: "classroom_beta-0002",
        templateId: "template_beta-0002",
        createdByTeacherId: "teacher_beta-0002",
        target: {
          kind: "learner",
          learnerAliasId: "learner_beta-0002",
        },
        contractHash: CLASSROOM_TEST_HASH_B,
        assistancePolicy: publicationB.content.exercise.assistancePolicy,
        status: "active",
        createdAt,
        opensAt: CLASSROOM_TEST_NOW - CLASSROOM_TEST_DAY / 2,
        closesAt,
        expiresAt: assignmentExpiresAt,
      },
    ],
    learningEvidence: [
      createEvidenceFixture(
        "evidence_alpha-0001",
        "assignment_alpha-0001",
        "learner_alpha-0001",
        publicationA.content.exercise.id,
        CLASSROOM_TEST_HASH_A,
      ),
      createEvidenceFixture(
        "evidence_beta-0002",
        "assignment_beta-0002",
        "learner_beta-0002",
        publicationB.content.exercise.id,
        CLASSROOM_TEST_HASH_B,
      ),
    ],
    sessionCheckpoints: [
      createCheckpointFixture(
        "checkpoint_alpha-0001",
        "assignment_alpha-0001",
        "learner_alpha-0001",
        publicationA.content.exercise.id,
        CLASSROOM_TEST_HASH_A,
      ),
      createCheckpointFixture(
        "checkpoint_beta-0002",
        "assignment_beta-0002",
        "learner_beta-0002",
        publicationB.content.exercise.id,
        CLASSROOM_TEST_HASH_B,
      ),
    ],
  };
}

function createEvidenceFixture(
  id: string,
  assignmentId: string,
  learnerAliasId: string,
  activityId: string,
  contractHash: string,
) {
  return {
    schemaVersion: LEARNING_EVIDENCE_SCHEMA_VERSION,
    id,
    assignmentId,
    learnerAliasId,
    activityId,
    contractHash,
    missionStates: [
      {
        missionId: "V1",
        status: "verified" as const,
        updatedAt: CLASSROOM_TEST_NOW,
      },
    ],
    facts: [
      {
        factId: "rel_midpoint_e",
        pass: true,
        observedAt: CLASSROOM_TEST_NOW,
      },
    ],
    capturedConfigurations: ["convex" as const],
    assistance: {
      highestLevelUsed: 1,
      hintsDelivered: 1,
      toolsActivated: 0,
      highlightsDelivered: 0,
      variationsCreated: 0,
      demonstrationsViewed: 0,
    },
    conjectureCompleted: false,
    completedJustificationStepIds: [],
    transferCompleted: false,
    exerciseXp: 20,
    updatedAt: CLASSROOM_TEST_NOW,
    expiresAt: CLASSROOM_TEST_NOW + 30 * CLASSROOM_TEST_DAY,
  };
}

function createCheckpointFixture(
  id: string,
  assignmentId: string,
  learnerAliasId: string,
  activityId: string,
  contractHash: string,
) {
  return {
    schemaVersion: SESSION_CHECKPOINT_SCHEMA_VERSION,
    id,
    assignmentId,
    learnerAliasId,
    activityId,
    contractHash,
    worldSnapshotHash: contractHash,
    safeState: {
      freePoints: [
        { label: "A" as const, x: -4, y: -2 },
        { label: "B" as const, x: 3, y: -3 },
        { label: "C" as const, x: 5, y: 2 },
        { label: "D" as const, x: -2, y: 4 },
      ],
      constructedMidpoints: ["E" as const],
      constructedSegments: [],
      activeMissionId: "V1",
      missionStates: [
        {
          missionId: "V1",
          status: "verified" as const,
          updatedAt: CLASSROOM_TEST_NOW,
        },
      ],
    },
    createdAt: CLASSROOM_TEST_NOW,
    expiresAt: CLASSROOM_TEST_NOW + 7 * CLASSROOM_TEST_DAY,
  };
}

import { z } from "zod";

import {
  GeometryAssistancePolicyV1,
  GeometryScaffoldPointV1,
} from "@/lib/geometry-investigation/contracts";
import { TeacherExercisePublicationV2 } from "@/lib/teacher/geometry-exercise";

export const CLASSROOM_STORE_SCHEMA_VERSION = "classroom_store.v1" as const;
export const TEACHER_IDENTITY_SCHEMA_VERSION = "teacher_identity.v1" as const;
export const CLASSROOM_SCHEMA_VERSION = "classroom.v1" as const;
export const CLASSROOM_GROUP_SCHEMA_VERSION = "classroom_group.v1" as const;
export const LEARNER_ALIAS_SCHEMA_VERSION = "learner_alias.v1" as const;
export const CLASS_ACTIVITY_TEMPLATE_SCHEMA_VERSION =
  "class_activity_template.v1" as const;
export const CLASS_ASSIGNMENT_SCHEMA_VERSION = "class_assignment.v1" as const;
export const LEARNING_EVIDENCE_SCHEMA_VERSION =
  "class_learning_evidence.v1" as const;
export const SESSION_CHECKPOINT_SCHEMA_VERSION =
  "class_session_checkpoint.v1" as const;

export const DAY_MS = 24 * 60 * 60 * 1_000;

export const CLASSROOM_RETENTION_V1 = Object.freeze({
  teacherAccountMs: 180 * DAY_MS,
  classroomMs: 90 * DAY_MS,
  joinCodeMs: DAY_MS,
  learnerAliasMs: 90 * DAY_MS,
  activityTemplateMs: 90 * DAY_MS,
  assignmentMsAfterClose: 30 * DAY_MS,
  learningEvidenceMs: 30 * DAY_MS,
  sessionCheckpointMs: 7 * DAY_MS,
});

const TimestampMs = z.number().int().nonnegative().max(8_640_000_000_000_000);
const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const AuthSubjectHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const JoinCodeHash = z
  .string()
  .regex(/^scrypt-v1\$[A-Za-z0-9_-]{22,}\$[A-Za-z0-9_-]{43}$/);
const PersistentIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

function entityId(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}_[a-z0-9-]{8,80}$`));
}

export const TeacherIdV1 = entityId("teacher");
export const ClassroomIdV1 = entityId("classroom");
export const ClassroomGroupIdV1 = entityId("group");
export const LearnerAliasIdV1 = entityId("learner");
export const ActivityTemplateIdV1 = entityId("template");
export const AssignmentIdV1 = entityId("assignment");
export const LearningEvidenceIdV1 = entityId("evidence");
export const SessionCheckpointIdV1 = entityId("checkpoint");

const ClassroomLabel = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !value.includes("@"), "classroom_label_must_not_be_email");
const LearnerPseudonym = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u)
  .refine((value) => !value.includes("@"), "alias_must_not_be_email");

export const TeacherIdentityV1 = z
  .strictObject({
    schemaVersion: z.literal(TEACHER_IDENTITY_SCHEMA_VERSION),
    id: TeacherIdV1,
    authSubjectHash: AuthSubjectHash,
    locale: z.enum(["fr", "en"]),
    status: z.enum(["active", "revoked"]),
    createdAt: TimestampMs,
    expiresAt: TimestampMs,
  })
  .superRefine((value, context) => {
    requireExpiryAfterCreation(value, context);
    requireMaxRetention(
      value.createdAt,
      value.expiresAt,
      CLASSROOM_RETENTION_V1.teacherAccountMs,
      context,
    );
  });

export type TeacherIdentityV1 = z.infer<typeof TeacherIdentityV1>;

export const ClassroomV1 = z
  .strictObject({
    schemaVersion: z.literal(CLASSROOM_SCHEMA_VERSION),
    id: ClassroomIdV1,
    teacherId: TeacherIdV1,
    label: ClassroomLabel,
    joinCodeHash: JoinCodeHash.nullable(),
    joinCodeIssuedAt: TimestampMs.nullable(),
    status: z.enum(["active", "archived", "revoked"]),
    createdAt: TimestampMs,
    joinCodeExpiresAt: TimestampMs.nullable(),
    expiresAt: TimestampMs,
  })
  .superRefine((value, context) => {
    requireExpiryAfterCreation(value, context);
    requireMaxRetention(
      value.createdAt,
      value.expiresAt,
      CLASSROOM_RETENTION_V1.classroomMs,
      context,
    );
    const codeParts = [
      value.joinCodeHash,
      value.joinCodeIssuedAt,
      value.joinCodeExpiresAt,
    ];
    const presentCodeParts = codeParts.filter((part) => part !== null).length;
    if (presentCodeParts !== 0 && presentCodeParts !== codeParts.length) {
      context.addIssue({
        code: "custom",
        path: ["joinCodeHash"],
        message: "join_code_state_incomplete",
      });
    }
    if (value.status !== "active" && presentCodeParts !== 0) {
      context.addIssue({
        code: "custom",
        path: ["joinCodeHash"],
        message: "inactive_classroom_keeps_join_code",
      });
    }
    if (
      value.joinCodeIssuedAt !== null &&
      value.joinCodeExpiresAt !== null
    ) {
      if (
        value.joinCodeIssuedAt < value.createdAt ||
        value.joinCodeExpiresAt <= value.joinCodeIssuedAt ||
        value.joinCodeExpiresAt > value.expiresAt
      ) {
        context.addIssue({
          code: "custom",
          path: ["joinCodeExpiresAt"],
          message: "join_code_window_invalid",
        });
      }
      requireMaxRetention(
        value.joinCodeIssuedAt,
        value.joinCodeExpiresAt,
        CLASSROOM_RETENTION_V1.joinCodeMs,
        context,
        ["joinCodeExpiresAt"],
      );
    }
  });

export type ClassroomV1 = z.infer<typeof ClassroomV1>;

export const LearnerAliasV1 = z
  .strictObject({
    schemaVersion: z.literal(LEARNER_ALIAS_SCHEMA_VERSION),
    id: LearnerAliasIdV1,
    classroomId: ClassroomIdV1,
    pseudonym: LearnerPseudonym,
    status: z.enum(["active", "revoked"]),
    createdAt: TimestampMs,
    expiresAt: TimestampMs,
  })
  .superRefine((value, context) => {
    requireExpiryAfterCreation(value, context);
    requireMaxRetention(
      value.createdAt,
      value.expiresAt,
      CLASSROOM_RETENTION_V1.learnerAliasMs,
      context,
    );
  });

export type LearnerAliasV1 = z.infer<typeof LearnerAliasV1>;

export const ClassroomGroupV1 = z
  .strictObject({
    schemaVersion: z.literal(CLASSROOM_GROUP_SCHEMA_VERSION),
    id: ClassroomGroupIdV1,
    classroomId: ClassroomIdV1,
    label: ClassroomLabel,
    learnerAliasIds: z.array(LearnerAliasIdV1).min(1).max(32),
    createdAt: TimestampMs,
    expiresAt: TimestampMs,
  })
  .superRefine((value, context) => {
    requireExpiryAfterCreation(value, context);
    addUniqueIssue(
      context,
      value.learnerAliasIds,
      ["learnerAliasIds"],
      "duplicate_group_member",
    );
  });

export type ClassroomGroupV1 = z.infer<typeof ClassroomGroupV1>;

export const ClassActivityTemplateV1 = z
  .strictObject({
    schemaVersion: z.literal(CLASS_ACTIVITY_TEMPLATE_SCHEMA_VERSION),
    id: ActivityTemplateIdV1,
    teacherId: TeacherIdV1,
    publication: TeacherExercisePublicationV2,
    contractHash: Sha256Hex,
    createdAt: TimestampMs,
    expiresAt: TimestampMs,
  })
  .superRefine((value, context) => {
    requireExpiryAfterCreation(value, context);
    requireMaxRetention(
      value.createdAt,
      value.expiresAt,
      CLASSROOM_RETENTION_V1.activityTemplateMs,
      context,
    );
  });

export type ClassActivityTemplateV1 = z.infer<
  typeof ClassActivityTemplateV1
>;

export const AssignmentTargetV1 = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("classroom"),
    classroomId: ClassroomIdV1,
  }),
  z.strictObject({
    kind: z.literal("group"),
    groupId: ClassroomGroupIdV1,
  }),
  z.strictObject({
    kind: z.literal("learner"),
    learnerAliasId: LearnerAliasIdV1,
  }),
]);

export type AssignmentTargetV1 = z.infer<typeof AssignmentTargetV1>;

export const ClassAssignmentV1 = z
  .strictObject({
    schemaVersion: z.literal(CLASS_ASSIGNMENT_SCHEMA_VERSION),
    id: AssignmentIdV1,
    classroomId: ClassroomIdV1,
    templateId: ActivityTemplateIdV1,
    createdByTeacherId: TeacherIdV1,
    target: AssignmentTargetV1,
    contractHash: Sha256Hex,
    assistancePolicy: GeometryAssistancePolicyV1,
    status: z.enum(["scheduled", "active", "closed", "revoked"]),
    createdAt: TimestampMs,
    opensAt: TimestampMs,
    closesAt: TimestampMs,
    expiresAt: TimestampMs,
  })
  .superRefine((value, context) => {
    requireExpiryAfterCreation(value, context);
    if (value.opensAt < value.createdAt || value.closesAt <= value.opensAt) {
      context.addIssue({
        code: "custom",
        path: ["opensAt"],
        message: "assignment_window_invalid",
      });
    }
    if (value.expiresAt < value.closesAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "assignment_retention_invalid",
      });
    }
    requireMaxRetention(
      value.closesAt,
      value.expiresAt,
      CLASSROOM_RETENTION_V1.assignmentMsAfterClose,
      context,
    );
  });

export type ClassAssignmentV1 = z.infer<typeof ClassAssignmentV1>;

export const PersistedMissionStateV1 = z.strictObject({
  missionId: PersistentIdentifier,
  status: z.enum(["pending", "completed", "verified"]),
  updatedAt: TimestampMs,
});

export const PersistedFactV1 = z.strictObject({
  factId: PersistentIdentifier,
  pass: z.boolean(),
  observedAt: TimestampMs,
});

export const PersistedAssistanceV1 = z.strictObject({
  highestLevelUsed: z.number().int().min(0).max(4),
  hintsDelivered: z.number().int().nonnegative().max(64),
  toolsActivated: z.number().int().nonnegative().max(64),
  highlightsDelivered: z.number().int().nonnegative().max(64),
  variationsCreated: z.number().int().nonnegative().max(32),
  demonstrationsViewed: z.number().int().nonnegative().max(32),
});

export const LearningEvidenceV1 = z
  .strictObject({
    schemaVersion: z.literal(LEARNING_EVIDENCE_SCHEMA_VERSION),
    id: LearningEvidenceIdV1,
    assignmentId: AssignmentIdV1,
    learnerAliasId: LearnerAliasIdV1,
    activityId: PersistentIdentifier,
    contractHash: Sha256Hex,
    missionStates: z.array(PersistedMissionStateV1).max(9),
    facts: z.array(PersistedFactV1).max(64),
    capturedConfigurations: z
      .array(z.enum(["convex", "concave", "crossed"]))
      .max(3),
    assistance: PersistedAssistanceV1,
    conjectureCompleted: z.boolean(),
    completedJustificationStepIds: z.array(PersistentIdentifier).max(12),
    transferCompleted: z.boolean(),
    exerciseXp: z.number().int().nonnegative().max(10_000),
    updatedAt: TimestampMs,
    expiresAt: TimestampMs,
  })
  .superRefine((value, context) => {
    if (value.expiresAt <= value.updatedAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "evidence_expiry_invalid",
      });
    }
    requireMaxRetention(
      value.updatedAt,
      value.expiresAt,
      CLASSROOM_RETENTION_V1.learningEvidenceMs,
      context,
    );
    addUniqueIssue(
      context,
      value.missionStates.map(({ missionId }) => missionId),
      ["missionStates"],
      "duplicate_mission_state",
    );
    addUniqueIssue(
      context,
      value.facts.map(({ factId }) => factId),
      ["facts"],
      "duplicate_fact",
    );
    addUniqueIssue(
      context,
      value.capturedConfigurations,
      ["capturedConfigurations"],
      "duplicate_configuration",
    );
    addUniqueIssue(
      context,
      value.completedJustificationStepIds,
      ["completedJustificationStepIds"],
      "duplicate_justification_step",
    );
  });

export type LearningEvidenceV1 = z.infer<typeof LearningEvidenceV1>;

export const SafeVarignonCheckpointStateV1 = z
  .strictObject({
    freePoints: z.array(GeometryScaffoldPointV1).length(4),
    constructedMidpoints: z.array(z.enum(["E", "F", "G", "H"])).max(4),
    constructedSegments: z
      .array(z.enum(["EF", "FG", "GH", "HE"]))
      .max(4),
    activeMissionId: PersistentIdentifier,
    missionStates: z.array(PersistedMissionStateV1).max(9),
  })
  .superRefine((value, context) => {
    addUniqueIssue(
      context,
      value.freePoints.map(({ label }) => label),
      ["freePoints"],
      "duplicate_free_point",
    );
    addUniqueIssue(
      context,
      value.constructedMidpoints,
      ["constructedMidpoints"],
      "duplicate_midpoint",
    );
    addUniqueIssue(
      context,
      value.constructedSegments,
      ["constructedSegments"],
      "duplicate_segment",
    );
  });

export const SessionCheckpointV1 = z
  .strictObject({
    schemaVersion: z.literal(SESSION_CHECKPOINT_SCHEMA_VERSION),
    id: SessionCheckpointIdV1,
    assignmentId: AssignmentIdV1,
    learnerAliasId: LearnerAliasIdV1,
    activityId: PersistentIdentifier,
    contractHash: Sha256Hex,
    worldSnapshotHash: Sha256Hex,
    safeState: SafeVarignonCheckpointStateV1,
    createdAt: TimestampMs,
    expiresAt: TimestampMs,
  })
  .superRefine((value, context) => {
    requireExpiryAfterCreation(value, context);
    requireMaxRetention(
      value.createdAt,
      value.expiresAt,
      CLASSROOM_RETENTION_V1.sessionCheckpointMs,
      context,
    );
  });

export type SessionCheckpointV1 = z.infer<typeof SessionCheckpointV1>;

const ClassroomStoreSnapshotShapeV1 = z.strictObject({
  schemaVersion: z.literal(CLASSROOM_STORE_SCHEMA_VERSION),
  teachers: z.array(TeacherIdentityV1).max(32),
  classrooms: z.array(ClassroomV1).max(64),
  groups: z.array(ClassroomGroupV1).max(256),
  learnerAliases: z.array(LearnerAliasV1).max(2_048),
  activityTemplates: z.array(ClassActivityTemplateV1).max(512),
  assignments: z.array(ClassAssignmentV1).max(4_096),
  learningEvidence: z.array(LearningEvidenceV1).max(8_192),
  sessionCheckpoints: z.array(SessionCheckpointV1).max(8_192),
});

export const ClassroomStoreSnapshotV1 =
  ClassroomStoreSnapshotShapeV1.superRefine((snapshot, context) => {
    for (const [path, values] of [
      ["teachers", snapshot.teachers.map(({ id }) => id)],
      ["classrooms", snapshot.classrooms.map(({ id }) => id)],
      ["groups", snapshot.groups.map(({ id }) => id)],
      ["learnerAliases", snapshot.learnerAliases.map(({ id }) => id)],
      ["activityTemplates", snapshot.activityTemplates.map(({ id }) => id)],
      ["assignments", snapshot.assignments.map(({ id }) => id)],
      ["learningEvidence", snapshot.learningEvidence.map(({ id }) => id)],
      ["sessionCheckpoints", snapshot.sessionCheckpoints.map(({ id }) => id)],
    ] as const) {
      addUniqueIssue(context, values, [path], `duplicate_${path}_id`);
    }
    addUniqueIssue(
      context,
      snapshot.learningEvidence.map(
        ({ assignmentId, learnerAliasId }) =>
          `${assignmentId}:${learnerAliasId}`,
      ),
      ["learningEvidence"],
      "duplicate_assignment_evidence",
    );
    addUniqueIssue(
      context,
      snapshot.sessionCheckpoints.map(
        ({ assignmentId, learnerAliasId }) =>
          `${assignmentId}:${learnerAliasId}`,
      ),
      ["sessionCheckpoints"],
      "duplicate_assignment_checkpoint",
    );
    addUniqueIssue(
      context,
      snapshot.teachers.map(({ authSubjectHash }) => authSubjectHash),
      ["teachers"],
      "duplicate_teacher_auth_subject",
    );
    addUniqueIssue(
      context,
      snapshot.learnerAliases.map(
        ({ classroomId, pseudonym }) =>
          `${classroomId}:${pseudonym.toLocaleLowerCase()}`,
      ),
      ["learnerAliases"],
      "duplicate_classroom_pseudonym",
    );

    const classrooms = new Map(snapshot.classrooms.map((item) => [item.id, item]));
    const aliases = new Map(
      snapshot.learnerAliases.map((item) => [item.id, item]),
    );
    const groups = new Map(snapshot.groups.map((item) => [item.id, item]));
    const templates = new Map(
      snapshot.activityTemplates.map((item) => [item.id, item]),
    );
    const assignments = new Map(
      snapshot.assignments.map((item) => [item.id, item]),
    );

    snapshot.classrooms.forEach((classroom, index) => {
      const teacher = snapshot.teachers.find(({ id }) => id === classroom.teacherId);
      if (
        !teacher ||
        classroom.createdAt < teacher.createdAt ||
        classroom.expiresAt > teacher.expiresAt
      ) {
        referenceIssue(context, ["classrooms", index, "teacherId"]);
      }
    });
    snapshot.learnerAliases.forEach((alias, index) => {
      const classroom = classrooms.get(alias.classroomId);
      if (
        !classroom ||
        alias.createdAt < classroom.createdAt ||
        alias.expiresAt > classroom.expiresAt
      ) {
        referenceIssue(context, ["learnerAliases", index, "classroomId"]);
      }
    });
    snapshot.groups.forEach((group, index) => {
      const classroom = classrooms.get(group.classroomId);
      if (
        !classroom ||
        group.createdAt < classroom.createdAt ||
        group.expiresAt > classroom.expiresAt
      ) {
        referenceIssue(context, ["groups", index, "classroomId"]);
      }
      group.learnerAliasIds.forEach((aliasId, aliasIndex) => {
        if (aliases.get(aliasId)?.classroomId !== group.classroomId) {
          referenceIssue(context, ["groups", index, "learnerAliasIds", aliasIndex]);
        }
      });
    });
    snapshot.activityTemplates.forEach((template, index) => {
      const teacher = snapshot.teachers.find(({ id }) => id === template.teacherId);
      if (
        !teacher ||
        template.createdAt < teacher.createdAt ||
        template.expiresAt > teacher.expiresAt
      ) {
        referenceIssue(context, ["activityTemplates", index, "teacherId"]);
      }
    });
    snapshot.assignments.forEach((assignment, index) => {
      const classroom = classrooms.get(assignment.classroomId);
      const template = templates.get(assignment.templateId);
      if (!classroom || classroom.teacherId !== assignment.createdByTeacherId) {
        referenceIssue(context, ["assignments", index, "classroomId"]);
      }
      if (
        !template ||
        template.teacherId !== assignment.createdByTeacherId ||
        assignment.createdAt < template.createdAt ||
        assignment.createdAt < (classroom?.createdAt ?? Number.MAX_SAFE_INTEGER) ||
        template.contractHash !== assignment.contractHash ||
        assignment.expiresAt > template.expiresAt ||
        assignment.expiresAt > (classroom?.expiresAt ?? -1) ||
        JSON.stringify(assignment.assistancePolicy) !==
          JSON.stringify(template.publication.content.exercise.assistancePolicy)
      ) {
        referenceIssue(context, ["assignments", index, "templateId"]);
      }
      if (
        assignment.target.kind === "classroom" &&
        assignment.target.classroomId !== assignment.classroomId
      ) {
        referenceIssue(context, ["assignments", index, "target"]);
      }
      if (
        assignment.target.kind === "group" &&
        groups.get(assignment.target.groupId)?.classroomId !== assignment.classroomId
      ) {
        referenceIssue(context, ["assignments", index, "target"]);
      }
      if (
        assignment.target.kind === "learner" &&
        aliases.get(assignment.target.learnerAliasId)?.classroomId !==
          assignment.classroomId
      ) {
        referenceIssue(context, ["assignments", index, "target"]);
      }
    });
    snapshot.learningEvidence.forEach((evidence, index) => {
      const assignment = assignments.get(evidence.assignmentId);
      const alias = aliases.get(evidence.learnerAliasId);
      const activity = assignment
        ? templates.get(assignment.templateId)?.publication.content.exercise
        : undefined;
      const missionIds = new Set(activity?.missions.map(({ id }) => id));
      const factIds = new Set(
        activity?.relationDefinitions.map(({ id }) => id),
      );
      const justificationStepIds = new Set(
        activity?.demonstrationSteps.map(({ id }) => id),
      );
      if (
        !assignment ||
        !alias ||
        alias.classroomId !== assignment.classroomId ||
        !assignmentTargetsAlias(snapshot, assignment, alias.id) ||
        evidence.contractHash !== assignment.contractHash ||
        evidence.activityId !== activity?.id ||
        evidence.missionStates.some(({ missionId }) => !missionIds.has(missionId)) ||
        evidence.facts.some(({ factId }) => !factIds.has(factId)) ||
        evidence.completedJustificationStepIds.some(
          (stepId) => !justificationStepIds.has(stepId),
        ) ||
        evidence.updatedAt < assignment.opensAt ||
        evidence.updatedAt > assignment.closesAt ||
        evidence.missionStates.some(
          ({ updatedAt }) => updatedAt > evidence.updatedAt,
        ) ||
        evidence.facts.some(
          ({ observedAt }) => observedAt > evidence.updatedAt,
        ) ||
        evidence.expiresAt > assignment.expiresAt ||
        evidence.expiresAt > alias.expiresAt
      ) {
        referenceIssue(context, ["learningEvidence", index]);
      }
    });
    snapshot.sessionCheckpoints.forEach((checkpoint, index) => {
      const assignment = assignments.get(checkpoint.assignmentId);
      const alias = aliases.get(checkpoint.learnerAliasId);
      const activity = assignment
        ? templates.get(assignment.templateId)?.publication.content.exercise
        : undefined;
      const missionIds = new Set(activity?.missions.map(({ id }) => id));
      if (
        !assignment ||
        !alias ||
        alias.classroomId !== assignment.classroomId ||
        !assignmentTargetsAlias(snapshot, assignment, alias.id) ||
        checkpoint.contractHash !== assignment.contractHash ||
        checkpoint.activityId !== activity?.id ||
        !missionIds.has(checkpoint.safeState.activeMissionId) ||
        checkpoint.safeState.missionStates.some(
          ({ missionId }) => !missionIds.has(missionId),
        ) ||
        checkpoint.createdAt < assignment.opensAt ||
        checkpoint.createdAt > assignment.closesAt ||
        checkpoint.safeState.missionStates.some(
          ({ updatedAt }) => updatedAt > checkpoint.createdAt,
        ) ||
        checkpoint.expiresAt > assignment.expiresAt ||
        checkpoint.expiresAt > alias.expiresAt
      ) {
        referenceIssue(context, ["sessionCheckpoints", index]);
      }
    });
  });

export type ClassroomStoreSnapshotV1 = z.infer<
  typeof ClassroomStoreSnapshotV1
>;

export function createEmptyClassroomStoreV1(): ClassroomStoreSnapshotV1 {
  return {
    schemaVersion: CLASSROOM_STORE_SCHEMA_VERSION,
    teachers: [],
    classrooms: [],
    groups: [],
    learnerAliases: [],
    activityTemplates: [],
    assignments: [],
    learningEvidence: [],
    sessionCheckpoints: [],
  };
}

function requireExpiryAfterCreation(
  value: { createdAt: number; expiresAt: number },
  context: z.RefinementCtx,
): void {
  if (value.expiresAt <= value.createdAt) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "expiry_must_follow_creation",
    });
  }
}

function requireMaxRetention(
  startsAt: number,
  expiresAt: number,
  maximumMs: number,
  context: z.RefinementCtx,
  path: PropertyKey[] = ["expiresAt"],
): void {
  if (expiresAt - startsAt > maximumMs) {
    context.addIssue({
      code: "custom",
      path,
      message: "retention_window_exceeded",
    });
  }
}

function addUniqueIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[],
  message: string,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path, message });
  }
}

function referenceIssue(context: z.RefinementCtx, path: PropertyKey[]): void {
  context.addIssue({
    code: "custom",
    path,
    message: "classroom_reference_invalid",
  });
}

function assignmentTargetsAlias(
  snapshot: z.infer<typeof ClassroomStoreSnapshotShapeV1>,
  assignment: ClassAssignmentV1,
  learnerAliasId: string,
): boolean {
  const target = assignment.target;
  if (target.kind === "classroom") return true;
  if (target.kind === "learner") {
    return target.learnerAliasId === learnerAliasId;
  }
  return (
    snapshot.groups
      .find(({ id }) => id === target.groupId)
      ?.learnerAliasIds.includes(learnerAliasId) === true
  );
}

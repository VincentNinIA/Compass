import { z } from "zod";

import {
  AssignmentIdV1,
  ClassroomGroupIdV1,
  ClassroomIdV1,
  ClassroomStoreSnapshotV1,
  LearnerAliasIdV1,
  LearningEvidenceIdV1,
  SessionCheckpointIdV1,
  TeacherIdV1,
  ActivityTemplateIdV1,
  type ClassAssignmentV1,
  type ClassroomStoreSnapshotV1 as ClassroomSnapshot,
} from "./contracts";

export const ClassroomActorV1 = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("teacher"), teacherId: TeacherIdV1 }),
  z.strictObject({
    role: z.literal("learner"),
    learnerAliasId: LearnerAliasIdV1,
  }),
  z.strictObject({
    role: z.literal("system"),
    purpose: z.enum(["migration", "retention"]),
  }),
]);

export type ClassroomActorV1 = z.infer<typeof ClassroomActorV1>;

export const ClassroomAccessActionV1 = z.enum([
  "read_classroom",
  "manage_classroom",
  "read_roster",
  "read_template",
  "read_assignment",
  "read_class_evidence",
  "delete_classroom",
  "delete_learner_alias",
  "read_own_assignment",
  "write_evidence",
  "read_own_evidence",
  "write_checkpoint",
  "read_checkpoint",
  "migrate_store",
  "purge_expired",
]);

export type ClassroomAccessActionV1 = z.infer<
  typeof ClassroomAccessActionV1
>;

export const ClassroomResourceV1 = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("classroom"), id: ClassroomIdV1 }),
  z.strictObject({ kind: z.literal("group"), id: ClassroomGroupIdV1 }),
  z.strictObject({ kind: z.literal("learner_alias"), id: LearnerAliasIdV1 }),
  z.strictObject({ kind: z.literal("activity_template"), id: ActivityTemplateIdV1 }),
  z.strictObject({ kind: z.literal("assignment"), id: AssignmentIdV1 }),
  z.strictObject({ kind: z.literal("learning_evidence"), id: LearningEvidenceIdV1 }),
  z.strictObject({ kind: z.literal("session_checkpoint"), id: SessionCheckpointIdV1 }),
]);

export type ClassroomResourceV1 = z.infer<typeof ClassroomResourceV1>;

export type ClassroomAccessDecisionV1 = Readonly<
  | { allowed: true; reason: "authorized" }
  | {
      allowed: false;
      reason:
        | "actor_inactive"
        | "resource_missing"
        | "resource_required"
        | "role_action_forbidden"
        | "cross_class_forbidden"
        | "assignment_unavailable"
        | "not_assignment_recipient";
    }
>;

const allow = (): ClassroomAccessDecisionV1 => ({
  allowed: true,
  reason: "authorized",
});

const deny = (
  reason: Extract<ClassroomAccessDecisionV1, { allowed: false }>["reason"],
): ClassroomAccessDecisionV1 => ({ allowed: false, reason });

export function authorizeClassroomAccessV1(
  snapshotInput: ClassroomSnapshot,
  actorInput: ClassroomActorV1,
  actionInput: ClassroomAccessActionV1,
  resourceInput?: ClassroomResourceV1,
  now = Date.now(),
): ClassroomAccessDecisionV1 {
  const snapshot = ClassroomStoreSnapshotV1.parse(snapshotInput);
  const actor = ClassroomActorV1.parse(actorInput);
  const action = ClassroomAccessActionV1.parse(actionInput);
  const resource = resourceInput
    ? ClassroomResourceV1.parse(resourceInput)
    : undefined;

  if (actor.role === "system") {
    if (
      (actor.purpose === "migration" && action === "migrate_store") ||
      (actor.purpose === "retention" && action === "purge_expired")
    ) {
      return allow();
    }
    return deny("role_action_forbidden");
  }
  if (!resource) return deny("resource_required");

  if (actor.role === "teacher") {
    const teacher = snapshot.teachers.find(({ id }) => id === actor.teacherId);
    if (!teacher || teacher.status !== "active" || teacher.expiresAt <= now) {
      return deny("actor_inactive");
    }
    return authorizeTeacher(snapshot, actor.teacherId, action, resource);
  }

  const alias = snapshot.learnerAliases.find(
    ({ id }) => id === actor.learnerAliasId,
  );
  if (!alias || alias.status !== "active" || alias.expiresAt <= now) {
    return deny("actor_inactive");
  }
  const classroom = snapshot.classrooms.find(
    ({ id }) => id === alias.classroomId,
  );
  if (
    !classroom ||
    classroom.status !== "active" ||
    classroom.expiresAt <= now
  ) {
    return deny("actor_inactive");
  }
  return authorizeLearner(snapshot, alias.id, action, resource, now);
}

function authorizeTeacher(
  snapshot: ClassroomSnapshot,
  teacherId: string,
  action: ClassroomAccessActionV1,
  resource: ClassroomResourceV1,
): ClassroomAccessDecisionV1 {
  const ownedClassroomIds = new Set(
    snapshot.classrooms
      .filter((classroom) => classroom.teacherId === teacherId)
      .map(({ id }) => id),
  );

  const classroomId = resourceClassroomId(snapshot, resource);
  if (classroomId === undefined) return deny("resource_missing");
  if (classroomId !== null && !ownedClassroomIds.has(classroomId)) {
    return deny("cross_class_forbidden");
  }

  switch (action) {
    case "read_classroom":
    case "manage_classroom":
    case "delete_classroom":
      return resource.kind === "classroom"
        ? allow()
        : deny("role_action_forbidden");
    case "read_roster":
      return resource.kind === "learner_alias" || resource.kind === "group"
        ? allow()
        : deny("role_action_forbidden");
    case "delete_learner_alias":
      return resource.kind === "learner_alias"
        ? allow()
        : deny("role_action_forbidden");
    case "read_template": {
      if (resource.kind !== "activity_template") {
        return deny("role_action_forbidden");
      }
      const template = snapshot.activityTemplates.find(
        ({ id }) => id === resource.id,
      );
      return template?.teacherId === teacherId
        ? allow()
        : deny("cross_class_forbidden");
    }
    case "read_assignment":
      return resource.kind === "assignment"
        ? allow()
        : deny("role_action_forbidden");
    case "read_class_evidence":
      return resource.kind === "learning_evidence"
        ? allow()
        : deny("role_action_forbidden");
    default:
      return deny("role_action_forbidden");
  }
}

function authorizeLearner(
  snapshot: ClassroomSnapshot,
  learnerAliasId: string,
  action: ClassroomAccessActionV1,
  resource: ClassroomResourceV1,
  now: number,
): ClassroomAccessDecisionV1 {
  if (resource.kind === "assignment") {
    const assignment = snapshot.assignments.find(({ id }) => id === resource.id);
    if (!assignment) return deny("resource_missing");
    if (!assignmentAvailable(assignment, now)) {
      return deny("assignment_unavailable");
    }
    if (!assignmentTargetsLearnerV1(snapshot, assignment, learnerAliasId)) {
      return deny("not_assignment_recipient");
    }
    return action === "read_own_assignment" ||
      action === "write_evidence" ||
      action === "write_checkpoint"
      ? allow()
      : deny("role_action_forbidden");
  }

  if (resource.kind === "learning_evidence") {
    const evidence = snapshot.learningEvidence.find(({ id }) => id === resource.id);
    if (!evidence) return deny("resource_missing");
    if (evidence.learnerAliasId !== learnerAliasId) {
      return deny("cross_class_forbidden");
    }
    const assignment = snapshot.assignments.find(
      ({ id }) => id === evidence.assignmentId,
    );
    if (
      !assignment ||
      !assignmentAvailable(assignment, now) ||
      !assignmentTargetsLearnerV1(snapshot, assignment, learnerAliasId)
    ) {
      return deny("assignment_unavailable");
    }
    return action === "read_own_evidence" || action === "write_evidence"
      ? allow()
      : deny("role_action_forbidden");
  }

  if (resource.kind === "session_checkpoint") {
    const checkpoint = snapshot.sessionCheckpoints.find(
      ({ id }) => id === resource.id,
    );
    if (!checkpoint) return deny("resource_missing");
    if (checkpoint.learnerAliasId !== learnerAliasId) {
      return deny("cross_class_forbidden");
    }
    const assignment = snapshot.assignments.find(
      ({ id }) => id === checkpoint.assignmentId,
    );
    if (
      !assignment ||
      !assignmentAvailable(assignment, now) ||
      !assignmentTargetsLearnerV1(snapshot, assignment, learnerAliasId)
    ) {
      return deny("assignment_unavailable");
    }
    return action === "read_checkpoint" || action === "write_checkpoint"
      ? allow()
      : deny("role_action_forbidden");
  }

  return deny("role_action_forbidden");
}

export function assignmentTargetsLearnerV1(
  snapshot: ClassroomSnapshot,
  assignment: ClassAssignmentV1,
  learnerAliasId: string,
): boolean {
  const alias = snapshot.learnerAliases.find(({ id }) => id === learnerAliasId);
  if (!alias || alias.classroomId !== assignment.classroomId) return false;
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

function assignmentAvailable(
  assignment: ClassAssignmentV1,
  now: number,
): boolean {
  return (
    assignment.status === "active" &&
    assignment.opensAt <= now &&
    assignment.closesAt > now &&
    assignment.expiresAt > now
  );
}

function resourceClassroomId(
  snapshot: ClassroomSnapshot,
  resource: ClassroomResourceV1,
): string | null | undefined {
  switch (resource.kind) {
    case "classroom":
      return snapshot.classrooms.some(({ id }) => id === resource.id)
        ? resource.id
        : undefined;
    case "group":
      return snapshot.groups.find(({ id }) => id === resource.id)?.classroomId;
    case "learner_alias":
      return snapshot.learnerAliases.find(({ id }) => id === resource.id)
        ?.classroomId;
    case "activity_template":
      return snapshot.activityTemplates.some(({ id }) => id === resource.id)
        ? null
        : undefined;
    case "assignment":
      return snapshot.assignments.find(({ id }) => id === resource.id)
        ?.classroomId;
    case "learning_evidence": {
      const evidence = snapshot.learningEvidence.find(({ id }) => id === resource.id);
      return snapshot.assignments.find(({ id }) => id === evidence?.assignmentId)
        ?.classroomId;
    }
    case "session_checkpoint": {
      const checkpoint = snapshot.sessionCheckpoints.find(
        ({ id }) => id === resource.id,
      );
      return snapshot.assignments.find(({ id }) => id === checkpoint?.assignmentId)
        ?.classroomId;
    }
  }
}

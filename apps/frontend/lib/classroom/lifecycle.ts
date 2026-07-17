import {
  ClassroomStoreSnapshotV1,
  type ClassroomStoreSnapshotV1 as ClassroomSnapshot,
} from "./contracts";

export type ClassroomCascadeReportV1 = Readonly<{
  teachers: number;
  classrooms: number;
  groups: number;
  learnerAliases: number;
  activityTemplates: number;
  assignments: number;
  learningEvidence: number;
  sessionCheckpoints: number;
}>;

const emptyReport = (): ClassroomCascadeReportV1 => ({
  teachers: 0,
  classrooms: 0,
  groups: 0,
  learnerAliases: 0,
  activityTemplates: 0,
  assignments: 0,
  learningEvidence: 0,
  sessionCheckpoints: 0,
});

export function deleteClassroomCascadeV1(
  snapshotInput: ClassroomSnapshot,
  classroomId: string,
): { snapshot: ClassroomSnapshot; deleted: ClassroomCascadeReportV1 } {
  const snapshot = ClassroomStoreSnapshotV1.parse(snapshotInput);
  if (!snapshot.classrooms.some(({ id }) => id === classroomId)) {
    return { snapshot: structuredClone(snapshot), deleted: emptyReport() };
  }
  const aliasIds = new Set(
    snapshot.learnerAliases
      .filter((alias) => alias.classroomId === classroomId)
      .map(({ id }) => id),
  );
  const assignmentIds = new Set(
    snapshot.assignments
      .filter((assignment) => assignment.classroomId === classroomId)
      .map(({ id }) => id),
  );
  const next = {
    ...structuredClone(snapshot),
    classrooms: snapshot.classrooms.filter(({ id }) => id !== classroomId),
    groups: snapshot.groups.filter((group) => group.classroomId !== classroomId),
    learnerAliases: snapshot.learnerAliases.filter(
      (alias) => alias.classroomId !== classroomId,
    ),
    assignments: snapshot.assignments.filter(
      (assignment) => assignment.classroomId !== classroomId,
    ),
    learningEvidence: snapshot.learningEvidence.filter(
      (evidence) =>
        !assignmentIds.has(evidence.assignmentId) &&
        !aliasIds.has(evidence.learnerAliasId),
    ),
    sessionCheckpoints: snapshot.sessionCheckpoints.filter(
      (checkpoint) =>
        !assignmentIds.has(checkpoint.assignmentId) &&
        !aliasIds.has(checkpoint.learnerAliasId),
    ),
  };
  const parsed = ClassroomStoreSnapshotV1.parse(next);
  return { snapshot: parsed, deleted: diffReport(snapshot, parsed) };
}

export function deleteTeacherCascadeV1(
  snapshotInput: ClassroomSnapshot,
  teacherId: string,
): { snapshot: ClassroomSnapshot; deleted: ClassroomCascadeReportV1 } {
  const snapshot = ClassroomStoreSnapshotV1.parse(snapshotInput);
  if (!snapshot.teachers.some(({ id }) => id === teacherId)) {
    return { snapshot: structuredClone(snapshot), deleted: emptyReport() };
  }
  const classroomIds = new Set(
    snapshot.classrooms
      .filter((classroom) => classroom.teacherId === teacherId)
      .map(({ id }) => id),
  );
  const templateIds = new Set(
    snapshot.activityTemplates
      .filter((template) => template.teacherId === teacherId)
      .map(({ id }) => id),
  );
  const aliasIds = new Set(
    snapshot.learnerAliases
      .filter((alias) => classroomIds.has(alias.classroomId))
      .map(({ id }) => id),
  );
  const assignmentIds = new Set(
    snapshot.assignments
      .filter(
        (assignment) =>
          classroomIds.has(assignment.classroomId) ||
          templateIds.has(assignment.templateId),
      )
      .map(({ id }) => id),
  );
  const next = {
    ...structuredClone(snapshot),
    teachers: snapshot.teachers.filter(({ id }) => id !== teacherId),
    classrooms: snapshot.classrooms.filter(
      (classroom) => !classroomIds.has(classroom.id),
    ),
    groups: snapshot.groups.filter(
      (group) => !classroomIds.has(group.classroomId),
    ),
    learnerAliases: snapshot.learnerAliases.filter(
      (alias) => !classroomIds.has(alias.classroomId),
    ),
    activityTemplates: snapshot.activityTemplates.filter(
      (template) => !templateIds.has(template.id),
    ),
    assignments: snapshot.assignments.filter(
      (assignment) => !assignmentIds.has(assignment.id),
    ),
    learningEvidence: snapshot.learningEvidence.filter(
      (evidence) =>
        !assignmentIds.has(evidence.assignmentId) &&
        !aliasIds.has(evidence.learnerAliasId),
    ),
    sessionCheckpoints: snapshot.sessionCheckpoints.filter(
      (checkpoint) =>
        !assignmentIds.has(checkpoint.assignmentId) &&
        !aliasIds.has(checkpoint.learnerAliasId),
    ),
  };
  const parsed = ClassroomStoreSnapshotV1.parse(next);
  return { snapshot: parsed, deleted: diffReport(snapshot, parsed) };
}

export function deleteLearnerAliasCascadeV1(
  snapshotInput: ClassroomSnapshot,
  learnerAliasId: string,
): { snapshot: ClassroomSnapshot; deleted: ClassroomCascadeReportV1 } {
  const original = ClassroomStoreSnapshotV1.parse(snapshotInput);
  if (!original.learnerAliases.some(({ id }) => id === learnerAliasId)) {
    return { snapshot: structuredClone(original), deleted: emptyReport() };
  }

  let snapshot = structuredClone(original);
  snapshot.learnerAliases = snapshot.learnerAliases.filter(
    ({ id }) => id !== learnerAliasId,
  );
  snapshot.groups = snapshot.groups
    .map((group) => ({
      ...group,
      learnerAliasIds: group.learnerAliasIds.filter(
        (id) => id !== learnerAliasId,
      ),
    }))
    .filter(({ learnerAliasIds }) => learnerAliasIds.length > 0);

  const retainedGroupIds = new Set(snapshot.groups.map(({ id }) => id));
  snapshot = deleteAssignmentsV1(
    snapshot,
    new Set(
      snapshot.assignments
        .filter(
          ({ target }) =>
            (target.kind === "learner" &&
              target.learnerAliasId === learnerAliasId) ||
            (target.kind === "group" &&
              !retainedGroupIds.has(target.groupId)),
        )
        .map(({ id }) => id),
    ),
  );
  snapshot.learningEvidence = snapshot.learningEvidence.filter(
    ({ learnerAliasId: ownerId }) => ownerId !== learnerAliasId,
  );
  snapshot.sessionCheckpoints = snapshot.sessionCheckpoints.filter(
    ({ learnerAliasId: ownerId }) => ownerId !== learnerAliasId,
  );

  const parsed = ClassroomStoreSnapshotV1.parse(snapshot);
  return { snapshot: parsed, deleted: diffReport(original, parsed) };
}

export function purgeExpiredClassroomDataV1(
  snapshotInput: ClassroomSnapshot,
  now = Date.now(),
): { snapshot: ClassroomSnapshot; deleted: ClassroomCascadeReportV1 } {
  const original = ClassroomStoreSnapshotV1.parse(snapshotInput);
  let snapshot = structuredClone(original);

  for (const teacher of [...snapshot.teachers]) {
    if (teacher.expiresAt <= now) {
      snapshot = deleteTeacherCascadeV1(snapshot, teacher.id).snapshot;
    }
  }
  for (const classroom of [...snapshot.classrooms]) {
    if (classroom.expiresAt <= now) {
      snapshot = deleteClassroomCascadeV1(snapshot, classroom.id).snapshot;
    }
  }
  snapshot.classrooms = snapshot.classrooms.map((classroom) =>
    classroom.joinCodeExpiresAt !== null &&
    classroom.joinCodeExpiresAt <= now
      ? {
          ...classroom,
          joinCodeHash: null,
          joinCodeIssuedAt: null,
          joinCodeExpiresAt: null,
        }
      : classroom,
  );

  const expiredTemplateIds = new Set(
    snapshot.activityTemplates
      .filter(({ expiresAt }) => expiresAt <= now)
      .map(({ id }) => id),
  );
  snapshot = deleteAssignmentsV1(
    snapshot,
    new Set(
      snapshot.assignments
        .filter(({ templateId }) => expiredTemplateIds.has(templateId))
        .map(({ id }) => id),
    ),
  );
  snapshot.activityTemplates = snapshot.activityTemplates.filter(
    ({ id }) => !expiredTemplateIds.has(id),
  );

  const expiredGroupIds = new Set(
    snapshot.groups
      .filter(({ expiresAt }) => expiresAt <= now)
      .map(({ id }) => id),
  );
  snapshot = deleteAssignmentsV1(
    snapshot,
    new Set(
      snapshot.assignments
        .filter(
          ({ target }) =>
            target.kind === "group" && expiredGroupIds.has(target.groupId),
        )
        .map(({ id }) => id),
    ),
  );
  snapshot.groups = snapshot.groups.filter(
    ({ id }) => !expiredGroupIds.has(id),
  );

  const expiredAliasIds = new Set(
    snapshot.learnerAliases
      .filter(({ expiresAt }) => expiresAt <= now)
      .map(({ id }) => id),
  );
  snapshot = deleteAssignmentsV1(
    snapshot,
    new Set(
      snapshot.assignments
        .filter(
          ({ target }) =>
            target.kind === "learner" &&
            expiredAliasIds.has(target.learnerAliasId),
        )
        .map(({ id }) => id),
    ),
  );
  snapshot.learnerAliases = snapshot.learnerAliases.filter(
    ({ id }) => !expiredAliasIds.has(id),
  );
  snapshot.groups = snapshot.groups
    .map((group) => ({
      ...group,
      learnerAliasIds: group.learnerAliasIds.filter(
        (id) => !expiredAliasIds.has(id),
      ),
    }))
    .filter(({ learnerAliasIds }) => learnerAliasIds.length > 0);
  const retainedGroupIds = new Set(snapshot.groups.map(({ id }) => id));
  snapshot = deleteAssignmentsV1(
    snapshot,
    new Set(
      snapshot.assignments
        .filter(
          ({ target }) =>
            target.kind === "group" && !retainedGroupIds.has(target.groupId),
        )
        .map(({ id }) => id),
    ),
  );
  snapshot.learningEvidence = snapshot.learningEvidence.filter(
    ({ learnerAliasId }) => !expiredAliasIds.has(learnerAliasId),
  );
  snapshot.sessionCheckpoints = snapshot.sessionCheckpoints.filter(
    ({ learnerAliasId }) => !expiredAliasIds.has(learnerAliasId),
  );

  snapshot = deleteAssignmentsV1(
    snapshot,
    new Set(
      snapshot.assignments
        .filter(({ expiresAt }) => expiresAt <= now)
        .map(({ id }) => id),
    ),
  );
  snapshot.learningEvidence = snapshot.learningEvidence.filter(
    ({ expiresAt }) => expiresAt > now,
  );
  snapshot.sessionCheckpoints = snapshot.sessionCheckpoints.filter(
    ({ expiresAt }) => expiresAt > now,
  );

  const parsed = ClassroomStoreSnapshotV1.parse(snapshot);
  return { snapshot: parsed, deleted: diffReport(original, parsed) };
}

function deleteAssignmentsV1(
  snapshotInput: ClassroomSnapshot,
  assignmentIds: ReadonlySet<string>,
): ClassroomSnapshot {
  if (assignmentIds.size === 0) return structuredClone(snapshotInput);
  return {
    ...structuredClone(snapshotInput),
    assignments: snapshotInput.assignments.filter(
      ({ id }) => !assignmentIds.has(id),
    ),
    learningEvidence: snapshotInput.learningEvidence.filter(
      ({ assignmentId }) => !assignmentIds.has(assignmentId),
    ),
    sessionCheckpoints: snapshotInput.sessionCheckpoints.filter(
      ({ assignmentId }) => !assignmentIds.has(assignmentId),
    ),
  };
}

function diffReport(
  before: ClassroomSnapshot,
  after: ClassroomSnapshot,
): ClassroomCascadeReportV1 {
  return Object.freeze({
    teachers: before.teachers.length - after.teachers.length,
    classrooms: before.classrooms.length - after.classrooms.length,
    groups: before.groups.length - after.groups.length,
    learnerAliases: before.learnerAliases.length - after.learnerAliases.length,
    activityTemplates:
      before.activityTemplates.length - after.activityTemplates.length,
    assignments: before.assignments.length - after.assignments.length,
    learningEvidence:
      before.learningEvidence.length - after.learningEvidence.length,
    sessionCheckpoints:
      before.sessionCheckpoints.length - after.sessionCheckpoints.length,
  });
}

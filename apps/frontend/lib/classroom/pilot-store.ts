import { createHash, randomUUID } from "node:crypto";

import {
  CLASSROOM_RETENTION_V1,
  ClassActivityTemplateV1,
  ClassAssignmentV1,
  ClassroomGroupV1,
  ClassroomV1,
  LearnerAliasV1,
  TeacherIdentityV1,
  type AssignmentTargetV1,
  type ClassActivityTemplateV1 as ClassActivityTemplate,
  type ClassAssignmentV1 as ClassAssignment,
  type ClassroomGroupV1 as ClassroomGroup,
  type ClassroomV1 as Classroom,
  type LearnerAliasV1 as LearnerAlias,
  type TeacherIdentityV1 as TeacherIdentity,
} from "./contracts";
import { hashClassroomActivityContractV1 } from "./activity-catalog";
import { verifyJoinCode } from "./join-code";

export type ClassroomWithRosterV1 = Readonly<{
  classroom: Classroom;
  learnerAliases: readonly LearnerAlias[];
  groups: readonly ClassroomGroup[];
  assignments: readonly ClassroomAssignmentViewV1[];
}>;

export type LearnerMembershipV1 = Readonly<{
  classroom: Pick<Classroom, "id" | "label" | "status" | "expiresAt">;
  learnerAlias: LearnerAlias;
  assignments: readonly ClassroomAssignmentViewV1[];
}>;

export type ClassroomAssignmentViewV1 = Readonly<{
  assignment: ClassAssignment;
  publication: ClassActivityTemplate["publication"];
  recipientAliasIds: readonly string[];
}>;

export type CreateClassroomInputV1 = Readonly<{
  teacherId: string;
  label: string;
  joinCode: string;
  joinCodeHash: string;
  now: number;
}>;

export type RotateJoinCodeInputV1 = Readonly<{
  teacherId: string;
  classroomId: string;
  joinCode: string;
  joinCodeHash: string;
  now: number;
}>;

export type JoinClassroomInputV1 = Readonly<{
  joinCode: string;
  pseudonym: string;
  now: number;
}>;

export type CreateClassroomGroupInputV1 = Readonly<{
  teacherId: string;
  classroomId: string;
  label: string;
  learnerAliasIds: readonly string[];
  now: number;
}>;

export type CreateClassAssignmentInputV1 = Readonly<{
  teacherId: string;
  classroomId: string;
  target: AssignmentTargetV1;
  publication: ClassActivityTemplate["publication"];
  contractHash: string;
  idempotencyKey: string;
  opensAt: number;
  closesAt: number;
  now: number;
}>;

export type ClassroomPilotErrorCode =
  | "classroom_archived"
  | "classroom_not_found"
  | "classroom_store_unavailable"
  | "join_code_collision"
  | "join_code_invalid_or_expired"
  | "assignment_contract_drift"
  | "assignment_idempotency_conflict"
  | "assignment_invalid_window"
  | "assignment_not_found"
  | "assignment_target_empty"
  | "assignment_target_not_found"
  | "classroom_group_conflict"
  | "classroom_group_not_found"
  | "learner_alias_conflict"
  | "learner_alias_not_found"
  | "teacher_revoked";

export class ClassroomPilotError extends Error {
  constructor(readonly code: ClassroomPilotErrorCode) {
    super(code);
    this.name = "ClassroomPilotError";
  }
}

export interface ClassroomPilotStoreV1 {
  readonly driver: "memory-reference" | "postgresql-16";
  ensureTeacher(input: {
    authSubjectHash: string;
    locale: "fr" | "en";
    now: number;
  }): Promise<TeacherIdentity>;
  listClassrooms(teacherId: string, now: number): Promise<readonly ClassroomWithRosterV1[]>;
  createClassroomGroup(input: CreateClassroomGroupInputV1): Promise<ClassroomGroup>;
  createClassAssignment(
    input: CreateClassAssignmentInputV1,
  ): Promise<ClassroomAssignmentViewV1>;
  revokeClassAssignment(
    teacherId: string,
    classroomId: string,
    assignmentId: string,
    now: number,
  ): Promise<ClassroomAssignmentViewV1>;
  createClassroom(input: CreateClassroomInputV1): Promise<Classroom>;
  rotateJoinCode(input: RotateJoinCodeInputV1): Promise<Classroom>;
  archiveClassroom(
    teacherId: string,
    classroomId: string,
    now: number,
  ): Promise<Classroom>;
  removeLearnerAlias(
    teacherId: string,
    classroomId: string,
    learnerAliasId: string,
    now: number,
  ): Promise<void>;
  joinClassroom(input: JoinClassroomInputV1): Promise<LearnerMembershipV1>;
  readLearnerMembership(
    classroomId: string,
    learnerAliasId: string,
    now: number,
  ): Promise<LearnerMembershipV1 | undefined>;
  close?(): Promise<void>;
}

function id(prefix: "classroom" | "group" | "learner"): string {
  return `${prefix}_${randomUUID()}`;
}

export function teacherIdFromAuthSubjectHash(authSubjectHash: string): string {
  return `teacher_${createHash("sha256").update(authSubjectHash).digest("hex").slice(0, 32)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryClassroomPilotStoreV1 implements ClassroomPilotStoreV1 {
  readonly driver = "memory-reference" as const;
  readonly #teachers = new Map<string, TeacherIdentity>();
  readonly #classrooms = new Map<string, Classroom>();
  readonly #aliases = new Map<string, LearnerAlias>();
  readonly #groups = new Map<string, ClassroomGroup>();
  readonly #templates = new Map<string, ClassActivityTemplate>();
  readonly #assignments = new Map<string, ClassAssignment>();
  readonly #assignmentRecipients = new Map<string, Set<string>>();
  #lock: Promise<void> = Promise.resolve();

  private async atomic<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.#lock;
    let release: () => void = () => undefined;
    this.#lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  async ensureTeacher(input: {
    authSubjectHash: string;
    locale: "fr" | "en";
    now: number;
  }): Promise<TeacherIdentity> {
    return this.atomic(async () => {
      const teacherId = teacherIdFromAuthSubjectHash(input.authSubjectHash);
      const existing = this.#teachers.get(teacherId);
      if (existing?.status === "revoked") {
        throw new ClassroomPilotError("teacher_revoked");
      }
      if (existing && existing.expiresAt <= input.now) {
        throw new ClassroomPilotError("teacher_revoked");
      }
      const teacher = TeacherIdentityV1.parse({
        schemaVersion: "teacher_identity.v1",
        id: teacherId,
        authSubjectHash: input.authSubjectHash,
        locale: input.locale,
        status: "active",
        createdAt: existing?.createdAt ?? input.now,
        expiresAt:
          existing?.expiresAt ??
          input.now + CLASSROOM_RETENTION_V1.teacherAccountMs,
      });
      this.#teachers.set(teacher.id, teacher);
      return clone(teacher);
    });
  }

  async listClassrooms(
    teacherId: string,
    now: number,
  ): Promise<readonly ClassroomWithRosterV1[]> {
    this.activeTeacher(teacherId, now);
    this.refreshAssignmentStatuses(now);
    return [...this.#classrooms.values()]
      .filter(
        (classroom) =>
          classroom.teacherId === teacherId && classroom.expiresAt > now,
      )
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((classroom) => ({
        classroom: clone(classroom),
        learnerAliases: [...this.#aliases.values()]
          .filter(
            (alias) =>
              alias.classroomId === classroom.id &&
              alias.status === "active" &&
              alias.expiresAt > now,
          )
          .sort((left, right) => left.createdAt - right.createdAt)
          .map(clone),
        groups: [...this.#groups.values()]
          .filter((group) => group.classroomId === classroom.id && group.expiresAt > now)
          .sort((left, right) => left.createdAt - right.createdAt)
          .map(clone),
        assignments: [...this.#assignments.values()]
          .filter(
            (assignment) =>
              assignment.classroomId === classroom.id &&
              assignment.expiresAt > now,
          )
          .sort((left, right) => right.createdAt - left.createdAt)
          .map((assignment) => this.assignmentView(assignment)),
      }));
  }

  async createClassroomGroup(
    input: CreateClassroomGroupInputV1,
  ): Promise<ClassroomGroup> {
    return this.atomic(async () => {
      const classroom = this.ownedClassroom(
        input.teacherId,
        input.classroomId,
        input.now,
      );
      if (classroom.status !== "active") {
        throw new ClassroomPilotError("classroom_archived");
      }
      if (
        [...this.#groups.values()].some(
          (group) =>
            group.classroomId === input.classroomId &&
            group.label.toLocaleLowerCase() === input.label.toLocaleLowerCase(),
        )
      ) {
        throw new ClassroomPilotError("classroom_group_conflict");
      }
      const learnerAliasIds = [...new Set(input.learnerAliasIds)];
      if (learnerAliasIds.length !== input.learnerAliasIds.length) {
        throw new ClassroomPilotError("assignment_target_not_found");
      }
      for (const learnerAliasId of learnerAliasIds) {
        const alias = this.#aliases.get(learnerAliasId);
        if (
          !alias ||
          alias.classroomId !== classroom.id ||
          alias.status !== "active" ||
          alias.expiresAt <= input.now
        ) {
          throw new ClassroomPilotError("assignment_target_not_found");
        }
      }
      const group = ClassroomGroupV1.parse({
        schemaVersion: "classroom_group.v1",
        id: id("group"),
        classroomId: classroom.id,
        label: input.label,
        learnerAliasIds,
        createdAt: input.now,
        expiresAt: classroom.expiresAt,
      });
      this.#groups.set(group.id, group);
      return clone(group);
    });
  }

  async createClassAssignment(
    input: CreateClassAssignmentInputV1,
  ): Promise<ClassroomAssignmentViewV1> {
    return this.atomic(async () => {
      if (
        hashClassroomActivityContractV1(input.publication) !==
        input.contractHash
      ) {
        throw new ClassroomPilotError("assignment_contract_drift");
      }
      const teacher = this.activeTeacher(input.teacherId, input.now);
      const classroom = this.ownedClassroom(
        input.teacherId,
        input.classroomId,
        input.now,
      );
      if (classroom.status !== "active") {
        throw new ClassroomPilotError("classroom_archived");
      }
      const assignmentId = assignmentIdFromIdempotency(
        input.teacherId,
        input.idempotencyKey,
      );
      const existing = this.#assignments.get(assignmentId);
      if (existing) {
        if (!sameAssignmentIntent(existing, input)) {
          throw new ClassroomPilotError("assignment_idempotency_conflict");
        }
        this.refreshAssignmentStatuses(input.now);
        return this.assignmentView(this.#assignments.get(assignmentId)!);
      }

      const recipientAliasIds = this.resolveAssignmentRecipients(
        classroom,
        input.target,
        input.now,
      );
      if (recipientAliasIds.length === 0) {
        throw new ClassroomPilotError("assignment_target_empty");
      }

      const templateId = templateIdFromContract(
        input.teacherId,
        input.contractHash,
      );
      const maximumTemplateExpiry = Math.min(
        input.now + CLASSROOM_RETENTION_V1.activityTemplateMs,
        classroom.expiresAt,
        teacher.expiresAt,
      );
      let template = this.#templates.get(templateId);
      if (template) {
        if (
          template.teacherId !== input.teacherId ||
          template.contractHash !== input.contractHash ||
          hashClassroomActivityContractV1(template.publication) !==
            input.contractHash
        ) {
          throw new ClassroomPilotError("assignment_contract_drift");
        }
      } else {
        template = ClassActivityTemplateV1.parse({
          schemaVersion: "class_activity_template.v1",
          id: templateId,
          teacherId: input.teacherId,
          publication: input.publication,
          contractHash: input.contractHash,
          createdAt: input.now,
          expiresAt: maximumTemplateExpiry,
        });
      }
      if (input.closesAt > template.expiresAt) {
        throw new ClassroomPilotError("assignment_invalid_window");
      }
      const assignment = ClassAssignmentV1.parse({
        schemaVersion: "class_assignment.v1",
        id: assignmentId,
        classroomId: classroom.id,
        templateId: template.id,
        createdByTeacherId: input.teacherId,
        target: input.target,
        contractHash: input.contractHash,
        assistancePolicy: input.publication.content.exercise.assistancePolicy,
        status: input.opensAt <= input.now ? "active" : "scheduled",
        createdAt: input.now,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        expiresAt: Math.min(
          input.closesAt + CLASSROOM_RETENTION_V1.assignmentMsAfterClose,
          classroom.expiresAt,
          template.expiresAt,
        ),
      });
      this.#templates.set(template.id, template);
      this.#assignments.set(assignment.id, assignment);
      this.#assignmentRecipients.set(
        assignment.id,
        new Set(recipientAliasIds),
      );
      return this.assignmentView(assignment);
    });
  }

  async revokeClassAssignment(
    teacherId: string,
    classroomId: string,
    assignmentId: string,
    now: number,
  ): Promise<ClassroomAssignmentViewV1> {
    return this.atomic(async () => {
      this.ownedClassroom(teacherId, classroomId, now);
      const assignment = this.#assignments.get(assignmentId);
      if (
        !assignment ||
        assignment.classroomId !== classroomId ||
        assignment.createdByTeacherId !== teacherId
      ) {
        throw new ClassroomPilotError("assignment_not_found");
      }
      const revoked = ClassAssignmentV1.parse({
        ...assignment,
        status: "revoked",
      });
      this.#assignments.set(revoked.id, revoked);
      return this.assignmentView(revoked);
    });
  }

  async createClassroom(input: CreateClassroomInputV1): Promise<Classroom> {
    return this.atomic(async () => {
      await this.assertCodeAvailable(input.joinCode, input.now);
      const teacher = this.#teachers.get(input.teacherId);
      if (!teacher || teacher.status !== "active" || teacher.expiresAt <= input.now) {
        throw new ClassroomPilotError("teacher_revoked");
      }
      const classroom = ClassroomV1.parse({
        schemaVersion: "classroom.v1",
        id: id("classroom"),
        teacherId: input.teacherId,
        label: input.label,
        joinCodeHash: input.joinCodeHash,
        joinCodeIssuedAt: input.now,
        status: "active",
        createdAt: input.now,
        joinCodeExpiresAt: input.now + CLASSROOM_RETENTION_V1.joinCodeMs,
        expiresAt: input.now + CLASSROOM_RETENTION_V1.classroomMs,
      });
      this.#classrooms.set(classroom.id, classroom);
      return clone(classroom);
    });
  }

  async rotateJoinCode(input: RotateJoinCodeInputV1): Promise<Classroom> {
    return this.atomic(async () => {
      await this.assertCodeAvailable(input.joinCode, input.now, input.classroomId);
      const classroom = this.ownedClassroom(
        input.teacherId,
        input.classroomId,
        input.now,
      );
      if (classroom.status !== "active") {
        throw new ClassroomPilotError("classroom_archived");
      }
      if (classroom.expiresAt <= input.now) {
        throw new ClassroomPilotError("classroom_not_found");
      }
      const updated = ClassroomV1.parse({
        ...classroom,
        joinCodeHash: input.joinCodeHash,
        joinCodeIssuedAt: input.now,
        joinCodeExpiresAt: Math.min(
          input.now + CLASSROOM_RETENTION_V1.joinCodeMs,
          classroom.expiresAt,
        ),
      });
      this.#classrooms.set(updated.id, updated);
      return clone(updated);
    });
  }

  async archiveClassroom(
    teacherId: string,
    classroomId: string,
    now: number,
  ): Promise<Classroom> {
    return this.atomic(async () => {
      const classroom = this.ownedClassroom(teacherId, classroomId, now);
      const updated = ClassroomV1.parse({
        ...classroom,
        status: "archived",
        joinCodeHash: null,
        joinCodeIssuedAt: null,
        joinCodeExpiresAt: null,
      });
      this.#classrooms.set(updated.id, updated);
      for (const assignment of this.#assignments.values()) {
        if (assignment.classroomId === classroomId) {
          this.#assignments.set(
            assignment.id,
            ClassAssignmentV1.parse({ ...assignment, status: "revoked" }),
          );
        }
      }
      return clone(updated);
    });
  }

  async removeLearnerAlias(
    teacherId: string,
    classroomId: string,
    learnerAliasId: string,
    now: number,
  ): Promise<void> {
    return this.atomic(async () => {
      this.ownedClassroom(teacherId, classroomId, now);
      const alias = this.#aliases.get(learnerAliasId);
      if (!alias || alias.classroomId !== classroomId) {
        throw new ClassroomPilotError("learner_alias_not_found");
      }
      this.#aliases.delete(learnerAliasId);
      for (const [assignmentId, recipients] of this.#assignmentRecipients) {
        recipients.delete(learnerAliasId);
        if (recipients.size === 0) this.#assignmentRecipients.set(assignmentId, recipients);
      }
      for (const group of [...this.#groups.values()]) {
        if (!group.learnerAliasIds.includes(learnerAliasId)) continue;
        const remaining = group.learnerAliasIds.filter(
          (candidate) => candidate !== learnerAliasId,
        );
        if (remaining.length === 0) {
          this.#groups.delete(group.id);
          this.removeAssignments((assignment) =>
            assignment.target.kind === "group" &&
            assignment.target.groupId === group.id,
          );
        } else {
          this.#groups.set(
            group.id,
            ClassroomGroupV1.parse({ ...group, learnerAliasIds: remaining }),
          );
        }
      }
      this.removeAssignments(
        (assignment) =>
          assignment.target.kind === "learner" &&
          assignment.target.learnerAliasId === learnerAliasId,
      );
    });
  }

  async joinClassroom(input: JoinClassroomInputV1): Promise<LearnerMembershipV1> {
    return this.atomic(async () => {
      const matches: Classroom[] = [];
      for (const classroom of this.#classrooms.values()) {
        if (
          classroom.status === "active" &&
          classroom.expiresAt > input.now &&
          classroom.joinCodeHash &&
          classroom.joinCodeExpiresAt !== null &&
          classroom.joinCodeExpiresAt > input.now &&
          (await verifyJoinCode(input.joinCode, classroom.joinCodeHash))
        ) {
          matches.push(classroom);
        }
      }
      if (matches.length !== 1) {
        throw new ClassroomPilotError("join_code_invalid_or_expired");
      }
      const classroom = matches[0];
      const hasConflict = [...this.#aliases.values()].some(
        (alias) =>
          alias.classroomId === classroom.id &&
          alias.pseudonym.localeCompare(input.pseudonym, undefined, {
            sensitivity: "accent",
          }) === 0,
      );
      if (hasConflict) throw new ClassroomPilotError("learner_alias_conflict");
      const learnerAlias = LearnerAliasV1.parse({
        schemaVersion: "learner_alias.v1",
        id: id("learner"),
        classroomId: classroom.id,
        pseudonym: input.pseudonym,
        status: "active",
        createdAt: input.now,
        expiresAt: Math.min(
          input.now + CLASSROOM_RETENTION_V1.learnerAliasMs,
          classroom.expiresAt,
        ),
      });
      this.#aliases.set(learnerAlias.id, learnerAlias);
      return {
        classroom: classroomProjection(classroom),
        learnerAlias: clone(learnerAlias),
        assignments: [],
      };
    });
  }

  async readLearnerMembership(
    classroomId: string,
    learnerAliasId: string,
    now: number,
  ): Promise<LearnerMembershipV1 | undefined> {
    const classroom = this.#classrooms.get(classroomId);
    const learnerAlias = this.#aliases.get(learnerAliasId);
    if (
      !classroom ||
      !learnerAlias ||
      learnerAlias.classroomId !== classroomId ||
      classroom.status !== "active" ||
      learnerAlias.status !== "active" ||
      classroom.expiresAt <= now ||
      learnerAlias.expiresAt <= now
    ) {
      return undefined;
    }
    this.refreshAssignmentStatuses(now);
    return {
      classroom: classroomProjection(classroom),
      learnerAlias: clone(learnerAlias),
      assignments: [...this.#assignments.values()]
        .filter(
          (assignment) =>
            assignment.classroomId === classroomId &&
            assignment.status === "active" &&
            assignment.opensAt <= now &&
            assignment.closesAt > now &&
            this.#assignmentRecipients
              .get(assignment.id)
              ?.has(learnerAliasId),
        )
        .sort((left, right) => left.opensAt - right.opensAt)
        .map((assignment) => this.assignmentView(assignment)),
    };
  }

  private assignmentView(
    assignment: ClassAssignment,
  ): ClassroomAssignmentViewV1 {
    const template = this.#templates.get(assignment.templateId);
    if (!template) throw new ClassroomPilotError("classroom_store_unavailable");
    return {
      assignment: clone(assignment),
      publication: clone(template.publication),
      recipientAliasIds: Object.freeze(
        [...(this.#assignmentRecipients.get(assignment.id) ?? [])].sort(),
      ),
    };
  }

  private resolveAssignmentRecipients(
    classroom: Classroom,
    target: AssignmentTargetV1,
    now: number,
  ): string[] {
    if (
      target.kind === "classroom" &&
      target.classroomId !== classroom.id
    ) {
      throw new ClassroomPilotError("assignment_target_not_found");
    }
    if (target.kind === "group") {
      const group = this.#groups.get(target.groupId);
      if (!group || group.classroomId !== classroom.id || group.expiresAt <= now) {
        throw new ClassroomPilotError("classroom_group_not_found");
      }
      return group.learnerAliasIds.filter((aliasId) =>
        this.aliasIsActiveInClassroom(aliasId, classroom.id, now),
      );
    }
    if (target.kind === "learner") {
      if (
        !this.aliasIsActiveInClassroom(
          target.learnerAliasId,
          classroom.id,
          now,
        )
      ) {
        throw new ClassroomPilotError("assignment_target_not_found");
      }
      return [target.learnerAliasId];
    }
    return [...this.#aliases.values()]
      .filter(
        (alias) =>
          alias.classroomId === classroom.id &&
          alias.status === "active" &&
          alias.expiresAt > now,
      )
      .map(({ id: aliasId }) => aliasId)
      .sort();
  }

  private aliasIsActiveInClassroom(
    learnerAliasId: string,
    classroomId: string,
    now: number,
  ): boolean {
    const alias = this.#aliases.get(learnerAliasId);
    return Boolean(
      alias &&
      alias.classroomId === classroomId &&
      alias.status === "active" &&
      alias.expiresAt > now,
    );
  }

  private refreshAssignmentStatuses(now: number): void {
    for (const assignment of this.#assignments.values()) {
      if (assignment.status === "revoked" || assignment.status === "closed") {
        continue;
      }
      const status =
        assignment.closesAt <= now
          ? "closed"
          : assignment.opensAt <= now
            ? "active"
            : "scheduled";
      if (status !== assignment.status) {
        this.#assignments.set(
          assignment.id,
          ClassAssignmentV1.parse({ ...assignment, status }),
        );
      }
    }
  }

  private removeAssignments(
    predicate: (assignment: ClassAssignment) => boolean,
  ): void {
    for (const assignment of [...this.#assignments.values()]) {
      if (!predicate(assignment)) continue;
      this.#assignments.delete(assignment.id);
      this.#assignmentRecipients.delete(assignment.id);
    }
  }

  private ownedClassroom(
    teacherId: string,
    classroomId: string,
    now: number,
  ): Classroom {
    this.activeTeacher(teacherId, now);
    const classroom = this.#classrooms.get(classroomId);
    if (
      !classroom ||
      classroom.teacherId !== teacherId ||
      classroom.expiresAt <= now
    ) {
      throw new ClassroomPilotError("classroom_not_found");
    }
    return classroom;
  }

  private activeTeacher(teacherId: string, now: number): TeacherIdentity {
    const teacher = this.#teachers.get(teacherId);
    if (!teacher || teacher.status !== "active" || teacher.expiresAt <= now) {
      throw new ClassroomPilotError("teacher_revoked");
    }
    return teacher;
  }

  private async assertCodeAvailable(
    code: string,
    now: number,
    excludedClassroomId?: string,
  ): Promise<void> {
    for (const classroom of this.#classrooms.values()) {
      if (
        classroom.id !== excludedClassroomId &&
        classroom.status === "active" &&
        classroom.expiresAt > now &&
        classroom.joinCodeHash &&
        classroom.joinCodeExpiresAt !== null &&
        classroom.joinCodeExpiresAt > now &&
        (await verifyJoinCode(code, classroom.joinCodeHash))
      ) {
        throw new ClassroomPilotError("join_code_collision");
      }
    }
  }
}

function assignmentIdFromIdempotency(
  teacherId: string,
  idempotencyKey: string,
): string {
  return `assignment_${createHash("sha256")
    .update(`${teacherId}\0${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function templateIdFromContract(
  teacherId: string,
  contractHash: string,
): string {
  return `template_${createHash("sha256")
    .update(`${teacherId}\0${contractHash}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function sameAssignmentIntent(
  assignment: ClassAssignment,
  input: CreateClassAssignmentInputV1,
): boolean {
  return (
    assignment.classroomId === input.classroomId &&
    assignment.createdByTeacherId === input.teacherId &&
    assignment.templateId ===
      templateIdFromContract(input.teacherId, input.contractHash) &&
    assignment.contractHash === input.contractHash &&
    assignment.opensAt === input.opensAt &&
    assignment.closesAt === input.closesAt &&
    JSON.stringify(assignment.target) === JSON.stringify(input.target) &&
    hashClassroomActivityContractV1(assignment.assistancePolicy) ===
      hashClassroomActivityContractV1(
        input.publication.content.exercise.assistancePolicy,
      )
  );
}

function classroomProjection(
  classroom: Classroom,
): LearnerMembershipV1["classroom"] {
  return {
    id: classroom.id,
    label: classroom.label,
    status: classroom.status,
    expiresAt: classroom.expiresAt,
  };
}

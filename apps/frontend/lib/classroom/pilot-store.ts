import { createHash, randomUUID } from "node:crypto";

import {
  CLASSROOM_RETENTION_V1,
  ClassroomV1,
  LearnerAliasV1,
  TeacherIdentityV1,
  type ClassroomV1 as Classroom,
  type LearnerAliasV1 as LearnerAlias,
  type TeacherIdentityV1 as TeacherIdentity,
} from "./contracts";
import { verifyJoinCode } from "./join-code";

export type ClassroomWithRosterV1 = Readonly<{
  classroom: Classroom;
  learnerAliases: readonly LearnerAlias[];
}>;

export type LearnerMembershipV1 = Readonly<{
  classroom: Pick<Classroom, "id" | "label" | "status" | "expiresAt">;
  learnerAlias: LearnerAlias;
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

export type ClassroomPilotErrorCode =
  | "classroom_archived"
  | "classroom_not_found"
  | "classroom_store_unavailable"
  | "join_code_collision"
  | "join_code_invalid_or_expired"
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

function id(prefix: "classroom" | "learner"): string {
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
      }));
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
    return {
      classroom: classroomProjection(classroom),
      learnerAlias: clone(learnerAlias),
    };
  }

  private ownedClassroom(
    teacherId: string,
    classroomId: string,
    now: number,
  ): Classroom {
    this.activeTeacher(teacherId, now);
    const classroom = this.#classrooms.get(classroomId);
    if (!classroom || classroom.teacherId !== teacherId) {
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

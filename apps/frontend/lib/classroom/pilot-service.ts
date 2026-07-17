import { createJoinCode, hashJoinCode } from "./join-code";
import {
  getClassroomVarignonCatalogEntryV1,
  type ClassroomActivityCatalogEntryV1,
} from "./activity-catalog";
import type { AssignmentTargetV1 } from "./contracts";
import {
  ClassroomPilotError,
  type ClassroomPilotStoreV1,
  type ClassroomWithRosterV1,
  type LearnerMembershipV1,
} from "./pilot-store";

const MAX_CODE_GENERATION_ATTEMPTS = 4;
export const CLASS_ASSIGNMENT_MAX_START_DELAY_MS = 30 * 24 * 60 * 60 * 1_000;
export const CLASS_ASSIGNMENT_MIN_DURATION_MS = 60 * 60 * 1_000;
export const CLASS_ASSIGNMENT_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;

export class ClassroomPilotServiceV1 {
  constructor(
    readonly store: ClassroomPilotStoreV1,
    private readonly now: () => number = Date.now,
  ) {}

  ensureTeacher(authSubjectHash: string, locale: "fr" | "en") {
    return this.store.ensureTeacher({
      authSubjectHash,
      locale,
      now: this.now(),
    });
  }

  listClassrooms(
    teacherId: string,
  ): Promise<readonly ClassroomWithRosterV1[]> {
    return this.store.listClassrooms(teacherId, this.now());
  }

  getActivityCatalog(
    locale: "fr" | "en",
  ): readonly ClassroomActivityCatalogEntryV1[] {
    return Object.freeze([getClassroomVarignonCatalogEntryV1(locale)]);
  }

  createClassroomGroup(
    teacherId: string,
    input: {
      classroomId: string;
      label: string;
      learnerAliasIds: readonly string[];
    },
  ) {
    return this.store.createClassroomGroup({
      teacherId,
      classroomId: input.classroomId,
      label: input.label,
      learnerAliasIds: input.learnerAliasIds,
      now: this.now(),
    });
  }

  createClassAssignment(
    teacherId: string,
    input: {
      classroomId: string;
      target: AssignmentTargetV1;
      locale: "fr" | "en";
      expectedContractHash: string;
      idempotencyKey: string;
      opensAt: number;
      closesAt: number;
    },
  ) {
    const now = this.now();
    const catalogEntry = getClassroomVarignonCatalogEntryV1(input.locale);
    if (catalogEntry.contractHash !== input.expectedContractHash) {
      throw new ClassroomPilotError("assignment_contract_drift");
    }
    const duration = input.closesAt - input.opensAt;
    if (
      !Number.isSafeInteger(input.opensAt) ||
      !Number.isSafeInteger(input.closesAt) ||
      input.opensAt < now ||
      input.opensAt > now + CLASS_ASSIGNMENT_MAX_START_DELAY_MS ||
      duration < CLASS_ASSIGNMENT_MIN_DURATION_MS ||
      duration > CLASS_ASSIGNMENT_MAX_DURATION_MS
    ) {
      throw new ClassroomPilotError("assignment_invalid_window");
    }
    return this.store.createClassAssignment({
      teacherId,
      classroomId: input.classroomId,
      target: input.target,
      publication: catalogEntry.publication,
      contractHash: catalogEntry.contractHash,
      idempotencyKey: input.idempotencyKey,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      now,
    });
  }

  revokeClassAssignment(
    teacherId: string,
    classroomId: string,
    assignmentId: string,
  ) {
    return this.store.revokeClassAssignment(
      teacherId,
      classroomId,
      assignmentId,
      this.now(),
    );
  }

  async createClassroom(
    teacherId: string,
    label: string,
  ): Promise<{ classroom: ClassroomWithRosterV1["classroom"]; joinCode: string }> {
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const joinCode = createJoinCode();
      const joinCodeHash = await hashJoinCode(joinCode);
      try {
        const classroom = await this.store.createClassroom({
          teacherId,
          label,
          joinCode,
          joinCodeHash,
          now: this.now(),
        });
        return { classroom, joinCode };
      } catch (error) {
        if (
          error instanceof ClassroomPilotError &&
          error.code === "join_code_collision"
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ClassroomPilotError("join_code_collision");
  }

  async rotateJoinCode(
    teacherId: string,
    classroomId: string,
  ): Promise<{ classroom: ClassroomWithRosterV1["classroom"]; joinCode: string }> {
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const joinCode = createJoinCode();
      const joinCodeHash = await hashJoinCode(joinCode);
      try {
        const classroom = await this.store.rotateJoinCode({
          teacherId,
          classroomId,
          joinCode,
          joinCodeHash,
          now: this.now(),
        });
        return { classroom, joinCode };
      } catch (error) {
        if (
          error instanceof ClassroomPilotError &&
          error.code === "join_code_collision"
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ClassroomPilotError("join_code_collision");
  }

  archiveClassroom(teacherId: string, classroomId: string) {
    return this.store.archiveClassroom(teacherId, classroomId, this.now());
  }

  removeLearnerAlias(
    teacherId: string,
    classroomId: string,
    learnerAliasId: string,
  ): Promise<void> {
    return this.store.removeLearnerAlias(
      teacherId,
      classroomId,
      learnerAliasId,
      this.now(),
    );
  }

  joinClassroom(
    joinCode: string,
    pseudonym: string,
  ): Promise<LearnerMembershipV1> {
    return this.store.joinClassroom({
      joinCode,
      pseudonym,
      now: this.now(),
    });
  }

  readLearnerMembership(classroomId: string, learnerAliasId: string) {
    return this.store.readLearnerMembership(
      classroomId,
      learnerAliasId,
      this.now(),
    );
  }
}

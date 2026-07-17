import { createJoinCode, hashJoinCode } from "./join-code";
import {
  ClassroomPilotError,
  type ClassroomPilotStoreV1,
  type ClassroomWithRosterV1,
  type LearnerMembershipV1,
} from "./pilot-store";

const MAX_CODE_GENERATION_ATTEMPTS = 4;

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

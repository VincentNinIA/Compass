import { beforeEach, describe, expect, it } from "vitest";

import { hashJoinCode } from "./join-code";
import {
  ClassroomPilotError,
  MemoryClassroomPilotStoreV1,
} from "./pilot-store";

const now = 1_800_000_000_000;
const teacherHash = `sha256:${"1".repeat(64)}`;

describe("T25-C02 memory classroom pilot", () => {
  let store: MemoryClassroomPilotStoreV1;
  let teacherId: string;

  beforeEach(async () => {
    store = new MemoryClassroomPilotStoreV1();
    teacherId = (
      await store.ensureTeacher({
        authSubjectHash: teacherHash,
        locale: "fr",
        now,
      })
    ).id;
  });

  it("creates an isolated class and never exposes another teacher roster", async () => {
    const code = "2345-6789-ABCD";
    const classroom = await store.createClassroom({
      teacherId,
      label: "4e B",
      joinCode: code,
      joinCodeHash: await hashJoinCode(code),
      now,
    });
    const membership = await store.joinClassroom({
      joinCode: code,
      pseudonym: "Orion",
      now: now + 1,
    });
    expect(membership.classroom).toMatchObject({ id: classroom.id, label: "4e B" });
    expect(membership.learnerAlias.pseudonym).toBe("Orion");

    const secondTeacher = await store.ensureTeacher({
      authSubjectHash: `sha256:${"2".repeat(64)}`,
      locale: "en",
      now,
    });
    expect(await store.listClassrooms(secondTeacher.id, now + 2)).toEqual([]);
    expect(await store.listClassrooms(teacherId, now + 2)).toMatchObject([
      { classroom: { id: classroom.id }, learnerAliases: [{ pseudonym: "Orion" }] },
    ]);
  });

  it("rejects a case-insensitive duplicate pseudonym atomically", async () => {
    const code = "2345-6789-ABCD";
    await store.createClassroom({
      teacherId,
      label: "4e B",
      joinCode: code,
      joinCodeHash: await hashJoinCode(code),
      now,
    });
    const results = await Promise.allSettled([
      store.joinClassroom({ joinCode: code, pseudonym: "Orion", now: now + 1 }),
      store.joinClassroom({ joinCode: code, pseudonym: "orion", now: now + 1 }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "learner_alias_conflict" }),
    });
  });

  it("invalidates an old code on rotation, removes aliases and closes archived classes", async () => {
    const oldCode = "2345-6789-ABCD";
    const newCode = "EFGH-JKLM-NPQR";
    const classroom = await store.createClassroom({
      teacherId,
      label: "4e B",
      joinCode: oldCode,
      joinCodeHash: await hashJoinCode(oldCode),
      now,
    });
    await store.rotateJoinCode({
      teacherId,
      classroomId: classroom.id,
      joinCode: newCode,
      joinCodeHash: await hashJoinCode(newCode),
      now: now + 1,
    });
    await expect(
      store.joinClassroom({ joinCode: oldCode, pseudonym: "Nova", now: now + 2 }),
    ).rejects.toMatchObject({ code: "join_code_invalid_or_expired" });
    const joined = await store.joinClassroom({
      joinCode: newCode,
      pseudonym: "Nova",
      now: now + 2,
    });
    await store.removeLearnerAlias(
      teacherId,
      classroom.id,
      joined.learnerAlias.id,
      now + 3,
    );
    await expect(
      store.readLearnerMembership(classroom.id, joined.learnerAlias.id, now + 3),
    ).resolves.toBeUndefined();
    await store.archiveClassroom(teacherId, classroom.id, now + 4);
    await expect(
      store.joinClassroom({ joinCode: newCode, pseudonym: "Lune", now: now + 4 }),
    ).rejects.toBeInstanceOf(ClassroomPilotError);
  });

  it("rejects expired codes and cross-teacher classroom mutations", async () => {
    const code = "2345-6789-ABCD";
    const classroom = await store.createClassroom({
      teacherId,
      label: "4e B",
      joinCode: code,
      joinCodeHash: await hashJoinCode(code),
      now,
    });
    await expect(
      store.joinClassroom({
        joinCode: code,
        pseudonym: "Late learner",
        now: now + 24 * 60 * 60 * 1_000,
      }),
    ).rejects.toMatchObject({ code: "join_code_invalid_or_expired" });

    const otherTeacher = await store.ensureTeacher({
      authSubjectHash: `sha256:${"3".repeat(64)}`,
      locale: "fr",
      now,
    });
    await expect(
      store.archiveClassroom(otherTeacher.id, classroom.id, now + 1),
    ).rejects.toMatchObject({ code: "classroom_not_found" });
  });

  it("does not silently extend or revive the limited teacher identity", async () => {
    const first = await store.ensureTeacher({
      authSubjectHash: teacherHash,
      locale: "en",
      now: now + 1,
    });
    expect(first.expiresAt).toBe(now + 180 * 24 * 60 * 60 * 1_000);
    await expect(
      store.ensureTeacher({
        authSubjectHash: teacherHash,
        locale: "fr",
        now: first.expiresAt,
      }),
    ).rejects.toMatchObject({ code: "teacher_revoked" });
  });
});

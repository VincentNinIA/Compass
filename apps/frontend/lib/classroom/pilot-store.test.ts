import { beforeEach, describe, expect, it } from "vitest";

import { hashJoinCode } from "./join-code";
import { getClassroomVarignonCatalogEntryV1 } from "./activity-catalog";
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

  it("resolves immutable class, group and learner assignments without duplicates", async () => {
    const code = "2345-6789-ABCD";
    const classroom = await store.createClassroom({
      teacherId,
      label: "4e B",
      joinCode: code,
      joinCodeHash: await hashJoinCode(code),
      now,
    });
    const orion = await store.joinClassroom({
      joinCode: code,
      pseudonym: "Orion",
      now: now + 1,
    });
    const nova = await store.joinClassroom({
      joinCode: code,
      pseudonym: "Nova",
      now: now + 2,
    });
    const group = await store.createClassroomGroup({
      teacherId,
      classroomId: classroom.id,
      label: "Guided",
      learnerAliasIds: [orion.learnerAlias.id],
      now: now + 3,
    });
    const catalog = getClassroomVarignonCatalogEntryV1("fr");
    const common = {
      teacherId,
      classroomId: classroom.id,
      publication: catalog.publication,
      contractHash: catalog.contractHash,
      opensAt: now + 10,
      closesAt: now + 24 * 60 * 60 * 1_000,
      now: now + 4,
    } as const;
    const classAssignment = await store.createClassAssignment({
      ...common,
      target: { kind: "classroom", classroomId: classroom.id },
      idempotencyKey: "class-assignment-key-0001",
    });
    expect(classAssignment.recipientAliasIds).toEqual([
      nova.learnerAlias.id,
      orion.learnerAlias.id,
    ].sort());
    const retried = await store.createClassAssignment({
      ...common,
      target: { kind: "classroom", classroomId: classroom.id },
      idempotencyKey: "class-assignment-key-0001",
      now: now + 5,
    });
    expect(retried.assignment.id).toBe(classAssignment.assignment.id);
    await expect(
      store.createClassAssignment({
        ...common,
        target: { kind: "learner", learnerAliasId: orion.learnerAlias.id },
        idempotencyKey: "class-assignment-key-0001",
        now: now + 5,
      }),
    ).rejects.toMatchObject({ code: "assignment_idempotency_conflict" });

    const groupAssignment = await store.createClassAssignment({
      ...common,
      target: { kind: "group", groupId: group.id },
      idempotencyKey: "group-assignment-key-0001",
    });
    expect(groupAssignment.recipientAliasIds).toEqual([orion.learnerAlias.id]);
    const learnerAssignment = await store.createClassAssignment({
      ...common,
      target: { kind: "learner", learnerAliasId: nova.learnerAlias.id },
      idempotencyKey: "learner-assignment-key-0001",
    });
    expect(learnerAssignment.recipientAliasIds).toEqual([nova.learnerAlias.id]);

    const late = await store.joinClassroom({
      joinCode: code,
      pseudonym: "Late",
      now: now + 6,
    });
    await expect(
      store.readLearnerMembership(
        classroom.id,
        late.learnerAlias.id,
        common.opensAt,
      ),
    ).resolves.toMatchObject({ assignments: [] });
    await expect(
      store.readLearnerMembership(
        classroom.id,
        orion.learnerAlias.id,
        common.opensAt,
      ),
    ).resolves.toMatchObject({ assignments: [{}, {}] });

    await store.revokeClassAssignment(
      teacherId,
      classroom.id,
      groupAssignment.assignment.id,
      common.opensAt + 1,
    );
    const afterRevoke = await store.readLearnerMembership(
      classroom.id,
      orion.learnerAlias.id,
      common.opensAt + 2,
    );
    expect(afterRevoke?.assignments).toHaveLength(1);
    expect(afterRevoke?.assignments[0].publication).toEqual(catalog.publication);
  });

  it("rejects contract drift without leaving a partial assignment", async () => {
    const code = "2345-6789-ABCD";
    const classroom = await store.createClassroom({
      teacherId,
      label: "4e C",
      joinCode: code,
      joinCodeHash: await hashJoinCode(code),
      now,
    });
    const learner = await store.joinClassroom({
      joinCode: code,
      pseudonym: "Cosmos",
      now: now + 1,
    });
    const catalog = getClassroomVarignonCatalogEntryV1("fr");
    const driftedPublication = structuredClone(catalog.publication);
    driftedPublication.content.exercise.title = "Contrat altéré";
    const input = {
      teacherId,
      classroomId: classroom.id,
      target: {
        kind: "learner" as const,
        learnerAliasId: learner.learnerAlias.id,
      },
      publication: driftedPublication,
      contractHash: catalog.contractHash,
      idempotencyKey: "drift-assignment-key-0001",
      opensAt: now + 10,
      closesAt: now + 24 * 60 * 60 * 1_000,
      now: now + 2,
    };
    await expect(store.createClassAssignment(input)).rejects.toMatchObject({
      code: "assignment_contract_drift",
    });
    await expect(store.listClassrooms(teacherId, now + 3)).resolves.toMatchObject([
      { assignments: [] },
    ]);
    await expect(
      store.createClassAssignment({
        ...input,
        publication: catalog.publication,
      }),
    ).resolves.toMatchObject({
      assignment: { contractHash: catalog.contractHash },
      recipientAliasIds: [learner.learnerAlias.id],
    });
  });

  it("denies cross-teacher and cross-class assignment targets", async () => {
    const firstCode = "2345-6789-ABCD";
    const firstClassroom = await store.createClassroom({
      teacherId,
      label: "4e D",
      joinCode: firstCode,
      joinCodeHash: await hashJoinCode(firstCode),
      now,
    });
    const firstLearner = await store.joinClassroom({
      joinCode: firstCode,
      pseudonym: "Orion",
      now: now + 1,
    });
    const secondTeacher = await store.ensureTeacher({
      authSubjectHash: `sha256:${"8".repeat(64)}`,
      locale: "fr",
      now,
    });
    const secondCode = "EFGH-JKLM-NPQR";
    const secondClassroom = await store.createClassroom({
      teacherId: secondTeacher.id,
      label: "4e E",
      joinCode: secondCode,
      joinCodeHash: await hashJoinCode(secondCode),
      now,
    });
    const secondLearner = await store.joinClassroom({
      joinCode: secondCode,
      pseudonym: "Nova",
      now: now + 1,
    });
    const catalog = getClassroomVarignonCatalogEntryV1("fr");
    const common = {
      classroomId: firstClassroom.id,
      publication: catalog.publication,
      contractHash: catalog.contractHash,
      opensAt: now + 10,
      closesAt: now + 24 * 60 * 60 * 1_000,
      now: now + 2,
    };
    await expect(
      store.createClassAssignment({
        ...common,
        teacherId: secondTeacher.id,
        target: {
          kind: "learner",
          learnerAliasId: firstLearner.learnerAlias.id,
        },
        idempotencyKey: "cross-teacher-key-0001",
      }),
    ).rejects.toMatchObject({ code: "classroom_not_found" });
    await expect(
      store.createClassAssignment({
        ...common,
        teacherId,
        target: {
          kind: "learner",
          learnerAliasId: secondLearner.learnerAlias.id,
        },
        idempotencyKey: "cross-class-key-00001",
      }),
    ).rejects.toMatchObject({ code: "assignment_target_not_found" });
    await expect(
      store.createClassroomGroup({
        teacherId,
        classroomId: firstClassroom.id,
        label: "Foreign",
        learnerAliasIds: [secondLearner.learnerAlias.id],
        now: now + 2,
      }),
    ).rejects.toMatchObject({ code: "assignment_target_not_found" });
    expect(secondClassroom.teacherId).toBe(secondTeacher.id);
  });
});

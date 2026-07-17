import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { hashJoinCode } from "./join-code";
import { getClassroomVarignonCatalogEntryV1 } from "./activity-catalog";
import { PostgresClassroomPilotStoreV1 } from "./postgres-pilot-store";

const now = 1_800_000_000_000;

describe("T25-C02 PostgreSQL classroom pilot", () => {
  let pool: Pool;
  let store: PostgresClassroomPilotStoreV1;

  beforeEach(() => {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    database.public.none(migration("0001_classroom_v1.up.sql"));
    database.public.none(migration("0002_classroom_pilot.up.sql"));
    database.public.none(migration("0003_class_assignments.up.sql"));
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool() as unknown as Pool;
    store = new PostgresClassroomPilotStoreV1(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("persists classes and aliases without returning join-code hashes", async () => {
    const teacher = await store.ensureTeacher({
      authSubjectHash: `sha256:${"1".repeat(64)}`,
      locale: "fr",
      now,
    });
    const refreshedTeacher = await store.ensureTeacher({
      authSubjectHash: `sha256:${"1".repeat(64)}`,
      locale: "en",
      now: now + 1,
    });
    expect(refreshedTeacher.expiresAt).toBe(teacher.expiresAt);
    const code = "2345-6789-ABCD";
    const classroom = await store.createClassroom({
      teacherId: teacher.id,
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
    expect(membership.classroom).toEqual({
      id: classroom.id,
      label: "4e B",
      status: "active",
      expiresAt: classroom.expiresAt,
    });
    expect(JSON.stringify(membership)).not.toContain("scrypt-v1");
    expect(await store.listClassrooms(teacher.id, now + 2)).toMatchObject([
      { learnerAliases: [{ pseudonym: "Orion" }] },
    ]);
    await store.removeLearnerAlias(
      teacher.id,
      classroom.id,
      membership.learnerAlias.id,
      now + 2,
    );
    await expect(
      store.readLearnerMembership(classroom.id, membership.learnerAlias.id, now + 2),
    ).resolves.toBeUndefined();
  });

  it("enforces case-insensitive pseudonym uniqueness at database level", async () => {
    const teacher = await store.ensureTeacher({
      authSubjectHash: `sha256:${"2".repeat(64)}`,
      locale: "en",
      now,
    });
    const code = "EFGH-JKLM-NPQR";
    await store.createClassroom({
      teacherId: teacher.id,
      label: "Geometry lab",
      joinCode: code,
      joinCodeHash: await hashJoinCode(code),
      now,
    });
    await store.joinClassroom({ joinCode: code, pseudonym: "Nova", now: now + 1 });
    await expect(
      store.joinClassroom({ joinCode: code, pseudonym: "nova", now: now + 2 }),
    ).rejects.toMatchObject({ code: "learner_alias_conflict" });
  });

  it("persists recipient snapshots and keeps retries idempotent", async () => {
    const teacher = await store.ensureTeacher({
      authSubjectHash: `sha256:${"3".repeat(64)}`,
      locale: "fr",
      now,
    });
    const code = "2345-6789-ABCD";
    const classroom = await store.createClassroom({
      teacherId: teacher.id,
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
    const catalog = getClassroomVarignonCatalogEntryV1("fr");
    const input = {
      teacherId: teacher.id,
      classroomId: classroom.id,
      target: { kind: "learner" as const, learnerAliasId: orion.learnerAlias.id },
      publication: catalog.publication,
      contractHash: catalog.contractHash,
      idempotencyKey: "postgres-assignment-key-0001",
      opensAt: now + 10,
      closesAt: now + 24 * 60 * 60 * 1_000,
      now: now + 2,
    };
    const first = await store.createClassAssignment(input);
    const retry = await store.createClassAssignment({ ...input, now: now + 3 });
    expect(retry.assignment.id).toBe(first.assignment.id);
    expect(retry.recipientAliasIds).toEqual([orion.learnerAlias.id]);
    await expect(
      store.createClassAssignment({
        ...input,
        target: { kind: "classroom", classroomId: classroom.id },
        now: now + 3,
      }),
    ).rejects.toMatchObject({ code: "assignment_idempotency_conflict" });

    const membership = await store.readLearnerMembership(
      classroom.id,
      orion.learnerAlias.id,
      input.opensAt,
    );
    expect(membership?.assignments).toHaveLength(1);
    expect(membership?.assignments[0]).toMatchObject({
      assignment: { contractHash: catalog.contractHash },
      publication: catalog.publication,
    });

    await store.revokeClassAssignment(
      teacher.id,
      classroom.id,
      first.assignment.id,
      input.opensAt + 1,
    );
    await expect(store.listClassrooms(teacher.id, input.opensAt + 2)).resolves.toMatchObject([
      {
        assignments: [
          {
            assignment: { status: "revoked" },
            recipientAliasIds: [orion.learnerAlias.id],
          },
        ],
      },
    ]);
    await expect(
      store.readLearnerMembership(
        classroom.id,
        orion.learnerAlias.id,
        input.opensAt + 2,
      ),
    ).resolves.toMatchObject({ assignments: [] });
  });
});

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), "migrations", name), "utf8");
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { hashJoinCode } from "./join-code";
import { PostgresClassroomPilotStoreV1 } from "./postgres-pilot-store";

const now = 1_800_000_000_000;

describe("T25-C02 PostgreSQL classroom pilot", () => {
  let pool: Pool;
  let store: PostgresClassroomPilotStoreV1;

  beforeEach(() => {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    database.public.none(migration("0001_classroom_v1.up.sql"));
    database.public.none(migration("0002_classroom_pilot.up.sql"));
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
});

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), "migrations", name), "utf8");
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

const migrationPath = (name: string) =>
  resolve(process.cwd(), "migrations", name);

const upSql = readFileSync(
  migrationPath("0001_classroom_v1.up.sql"),
  "utf8",
);
const downSql = readFileSync(
  migrationPath("0001_classroom_v1.down.sql"),
  "utf8",
);

describe("T25-C01 PostgreSQL 16 migration", () => {
  it("applies the schema, enforces cascade deletion and rolls it back", () => {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    database.public.none(upSql);

    expect(tableNames(database)).toEqual([
      "compass_activity_templates",
      "compass_assignments",
      "compass_classroom_group_members",
      "compass_classroom_groups",
      "compass_classrooms",
      "compass_learner_aliases",
      "compass_learning_evidence",
      "compass_session_checkpoints",
      "compass_teacher_accounts",
    ]);

    database.public.none(`
      INSERT INTO compass_teacher_accounts
        (teacher_id, schema_version, auth_subject_hash, locale, status, created_at, expires_at)
      VALUES
        ('teacher_sql-0001', 'teacher_identity.v1', 'sha256:${"1".repeat(64)}', 'en', 'active', 1, 1000);
      INSERT INTO compass_classrooms
        (classroom_id, schema_version, teacher_id, label, join_code_hash, join_code_issued_at, status, created_at, join_code_expires_at, expires_at)
      VALUES
        ('classroom_sql-0001', 'classroom.v1', 'teacher_sql-0001', 'Pilot', 'hash', 1, 'active', 1, 10, 1000);
      INSERT INTO compass_learner_aliases
        (learner_alias_id, schema_version, classroom_id, pseudonym, status, created_at, expires_at)
      VALUES
        ('learner_sql-0001', 'learner_alias.v1', 'classroom_sql-0001', 'Orion', 'active', 1, 1000);
      INSERT INTO compass_classroom_groups
        (group_id, schema_version, classroom_id, label, created_at, expires_at)
      VALUES
        ('group_sql-0001', 'classroom_group.v1', 'classroom_sql-0001', 'Guided', 1, 1000);
      INSERT INTO compass_classroom_group_members (group_id, learner_alias_id)
      VALUES ('group_sql-0001', 'learner_sql-0001');
      INSERT INTO compass_activity_templates
        (template_id, schema_version, teacher_id, publication, contract_hash, created_at, expires_at)
      VALUES
        ('template_sql-0001', 'class_activity_template.v1', 'teacher_sql-0001', '{}', '${"a".repeat(64)}', 1, 1000);
      INSERT INTO compass_assignments
        (assignment_id, schema_version, classroom_id, template_id, created_by_teacher_id, target_kind, target_group_id, target_learner_alias_id, contract_hash, assistance_policy, status, created_at, opens_at, closes_at, expires_at)
      VALUES
        ('assignment_sql-0001', 'class_assignment.v1', 'classroom_sql-0001', 'template_sql-0001', 'teacher_sql-0001', 'classroom', NULL, NULL, '${"a".repeat(64)}', '{}', 'active', 1, 2, 100, 1000);
      INSERT INTO compass_learning_evidence
        (evidence_id, schema_version, assignment_id, learner_alias_id, activity_id, contract_hash, projection, updated_at, expires_at)
      VALUES
        ('evidence_sql-0001', 'class_learning_evidence.v1', 'assignment_sql-0001', 'learner_sql-0001', 'varignon', '${"a".repeat(64)}', '{}', 2, 1000);
      INSERT INTO compass_session_checkpoints
        (checkpoint_id, schema_version, assignment_id, learner_alias_id, activity_id, contract_hash, world_snapshot_hash, safe_state, created_at, expires_at)
      VALUES
        ('checkpoint_sql-0001', 'class_session_checkpoint.v1', 'assignment_sql-0001', 'learner_sql-0001', 'varignon', '${"a".repeat(64)}', '${"b".repeat(64)}', '{}', 2, 1000);
    `);

    database.public.none(
      "DELETE FROM compass_classrooms WHERE classroom_id = 'classroom_sql-0001'",
    );
    expect(count(database, "compass_learner_aliases")).toBe(0);
    expect(count(database, "compass_classroom_groups")).toBe(0);
    expect(count(database, "compass_assignments")).toBe(0);
    expect(count(database, "compass_learning_evidence")).toBe(0);
    expect(count(database, "compass_session_checkpoints")).toBe(0);
    expect(count(database, "compass_activity_templates")).toBe(1);

    database.public.none(downSql);
    expect(tableNames(database)).toEqual([]);
  });

  it("enforces classroom-scoped alias uniqueness", () => {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    database.public.none(upSql);
    database.public.none(`
      INSERT INTO compass_teacher_accounts
        (teacher_id, schema_version, auth_subject_hash, locale, status, created_at, expires_at)
      VALUES
        ('teacher_sql-0001', 'teacher_identity.v1', 'sha256:${"1".repeat(64)}', 'en', 'active', 1, 1000);
      INSERT INTO compass_classrooms
        (classroom_id, schema_version, teacher_id, label, join_code_hash, join_code_issued_at, status, created_at, join_code_expires_at, expires_at)
      VALUES
        ('classroom_sql-0001', 'classroom.v1', 'teacher_sql-0001', 'Pilot', 'hash', 1, 'active', 1, 10, 1000);
      INSERT INTO compass_learner_aliases
        (learner_alias_id, schema_version, classroom_id, pseudonym, status, created_at, expires_at)
      VALUES
        ('learner_sql-0001', 'learner_alias.v1', 'classroom_sql-0001', 'Orion', 'active', 1, 1000);
    `);
    expect(() =>
      database.public.none(`
        INSERT INTO compass_learner_aliases
          (learner_alias_id, schema_version, classroom_id, pseudonym, status, created_at, expires_at)
        VALUES
          ('learner_sql-0002', 'learner_alias.v1', 'classroom_sql-0001', 'Orion', 'active', 1, 1000);
      `),
    ).toThrow();
  });
});

function tableNames(database: ReturnType<typeof newDb>): string[] {
  return database.public
    .many(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'compass_%'
      ORDER BY table_name
    `)
    .map(({ table_name }) => String(table_name));
}

function count(database: ReturnType<typeof newDb>, table: string): number {
  return Number(database.public.one(`SELECT COUNT(*) AS value FROM ${table}`).value);
}

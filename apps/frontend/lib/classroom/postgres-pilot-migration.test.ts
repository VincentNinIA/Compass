import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

describe("T25-C03 PostgreSQL pilot migrations", () => {
  it("applies through assignment recipients and rolls back on an empty database", () => {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    database.public.none(migration("0001_classroom_v1.up.sql"));
    database.public.none(migration("0002_classroom_pilot.up.sql"));
    database.public.none(migration("0003_class_assignments.up.sql"));

    expect(tableNames(database)).toContain("compass_classroom_control");
    expect(tableNames(database)).toContain("compass_assignment_recipients");
    expect(
      database.public.one(
        "SELECT revision FROM compass_classroom_control WHERE lock_key = 1",
      ),
    ).toEqual({ revision: 0 });

    database.public.none(migration("0003_class_assignments.down.sql"));
    expect(tableNames(database)).not.toContain("compass_assignment_recipients");
    database.public.none(migration("0002_classroom_pilot.down.sql"));
    expect(tableNames(database)).not.toContain("compass_classroom_control");
    database.public.none(migration("0001_classroom_v1.down.sql"));
    expect(tableNames(database)).toEqual([]);
  });
});

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), "migrations", name), "utf8");
}

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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

describe("T25-C02 PostgreSQL pilot migration", () => {
  it("applies after v1 and rolls both migrations back on an empty database", () => {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    database.public.none(migration("0001_classroom_v1.up.sql"));
    database.public.none(migration("0002_classroom_pilot.up.sql"));

    expect(tableNames(database)).toContain("compass_classroom_control");
    expect(
      database.public.one(
        "SELECT revision FROM compass_classroom_control WHERE lock_key = 1",
      ),
    ).toEqual({ revision: 0 });

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

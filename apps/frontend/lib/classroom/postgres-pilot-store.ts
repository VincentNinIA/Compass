import { randomUUID } from "node:crypto";

import { type Pool, type PoolClient, type QueryResultRow } from "pg";

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
import {
  ClassroomPilotError,
  teacherIdFromAuthSubjectHash,
  type ClassroomPilotStoreV1,
  type ClassroomWithRosterV1,
  type CreateClassroomInputV1,
  type JoinClassroomInputV1,
  type LearnerMembershipV1,
  type RotateJoinCodeInputV1,
} from "./pilot-store";

type Queryable = Pick<Pool | PoolClient, "query">;

type TeacherRow = QueryResultRow & {
  teacher_id: string;
  schema_version: string;
  auth_subject_hash: string;
  locale: string;
  status: string;
  created_at: string | number;
  expires_at: string | number;
};

type ClassroomRow = QueryResultRow & {
  classroom_id: string;
  schema_version: string;
  teacher_id: string;
  label: string;
  join_code_hash: string | null;
  join_code_issued_at: string | number | null;
  status: string;
  created_at: string | number;
  join_code_expires_at: string | number | null;
  expires_at: string | number;
};

type AliasRow = QueryResultRow & {
  learner_alias_id: string;
  schema_version: string;
  classroom_id: string;
  pseudonym: string;
  status: string;
  created_at: string | number;
  expires_at: string | number;
};

export class PostgresClassroomPilotStoreV1 implements ClassroomPilotStoreV1 {
  readonly driver = "postgresql-16" as const;

  constructor(private readonly pool: Pool) {}

  async ensureTeacher(input: {
    authSubjectHash: string;
    locale: "fr" | "en";
    now: number;
  }): Promise<TeacherIdentity> {
    const teacherId = teacherIdFromAuthSubjectHash(input.authSubjectHash);
    const expiresAt = input.now + CLASSROOM_RETENTION_V1.teacherAccountMs;
    const result = await this.pool.query<TeacherRow>(
      `
        INSERT INTO compass_teacher_accounts
          (teacher_id, schema_version, auth_subject_hash, locale, status, created_at, expires_at)
        VALUES ($1, 'teacher_identity.v1', $2, $3, 'active', $4, $5)
        ON CONFLICT (auth_subject_hash) DO UPDATE
        SET locale = EXCLUDED.locale
        WHERE compass_teacher_accounts.status = 'active'
          AND compass_teacher_accounts.expires_at > $4
        RETURNING *
      `,
      [teacherId, input.authSubjectHash, input.locale, input.now, expiresAt],
    );
    const row = result.rows[0];
    if (!row) throw new ClassroomPilotError("teacher_revoked");
    return parseTeacher(row);
  }

  async listClassrooms(
    teacherId: string,
    now: number,
  ): Promise<readonly ClassroomWithRosterV1[]> {
    const activeTeacher = await this.pool.query<{ teacher_id: string }>(
      `SELECT teacher_id FROM compass_teacher_accounts
       WHERE teacher_id = $1 AND status = 'active' AND expires_at > $2`,
      [teacherId, now],
    );
    if (!activeTeacher.rows[0]) {
      throw new ClassroomPilotError("teacher_revoked");
    }
    const [classrooms, aliases] = await Promise.all([
      this.pool.query<ClassroomRow>(
        `SELECT classroom.* FROM compass_classrooms classroom
         JOIN compass_teacher_accounts teacher
           ON teacher.teacher_id = classroom.teacher_id
         WHERE classroom.teacher_id = $1
           AND classroom.expires_at > $2
           AND teacher.status = 'active'
           AND teacher.expires_at > $2
         ORDER BY classroom.created_at DESC`,
        [teacherId, now],
      ),
      this.pool.query<AliasRow>(
        `SELECT alias.*
         FROM compass_learner_aliases alias
         JOIN compass_classrooms classroom
           ON classroom.classroom_id = alias.classroom_id
         JOIN compass_teacher_accounts teacher
           ON teacher.teacher_id = classroom.teacher_id
         WHERE classroom.teacher_id = $1
           AND classroom.expires_at > $2
           AND teacher.status = 'active'
           AND teacher.expires_at > $2
           AND alias.status = 'active'
           AND alias.expires_at > $2
         ORDER BY alias.created_at ASC`,
        [teacherId, now],
      ),
    ]);
    const parsedAliases = aliases.rows.map(parseAlias);
    return classrooms.rows.map((row) => {
      const classroom = parseClassroom(row);
      return {
        classroom,
        learnerAliases: parsedAliases.filter(
          (alias) => alias.classroomId === classroom.id,
        ),
      };
    });
  }

  async createClassroom(input: CreateClassroomInputV1): Promise<Classroom> {
    return this.transaction(async (client) => {
      await acquirePilotLock(client);
      await assertCodeAvailable(client, input.joinCode, input.now);
      const teacher = await client.query<{ teacher_id: string }>(
        `SELECT teacher_id FROM compass_teacher_accounts
         WHERE teacher_id = $1 AND status = 'active' AND expires_at > $2`,
        [input.teacherId, input.now],
      );
      if (!teacher.rows[0]) throw new ClassroomPilotError("teacher_revoked");
      const classroomId = `classroom_${randomUUID()}`;
      const result = await client.query<ClassroomRow>(
        `
          INSERT INTO compass_classrooms
            (classroom_id, schema_version, teacher_id, label, join_code_hash,
             join_code_issued_at, status, created_at, join_code_expires_at, expires_at)
          VALUES ($1, 'classroom.v1', $2, $3, $4, $5, 'active', $5, $6, $7)
          RETURNING *
        `,
        [
          classroomId,
          input.teacherId,
          input.label,
          input.joinCodeHash,
          input.now,
          input.now + CLASSROOM_RETENTION_V1.joinCodeMs,
          input.now + CLASSROOM_RETENTION_V1.classroomMs,
        ],
      );
      const row = result.rows[0];
      return parseClassroom(row);
    });
  }

  async rotateJoinCode(input: RotateJoinCodeInputV1): Promise<Classroom> {
    return this.transaction(async (client) => {
      await acquirePilotLock(client);
      await assertCodeAvailable(
        client,
        input.joinCode,
        input.now,
        input.classroomId,
      );
      const result = await client.query<ClassroomRow>(
        `
          UPDATE compass_classrooms
          SET join_code_hash = $3,
              join_code_issued_at = $4,
              join_code_expires_at = LEAST($5, expires_at)
          WHERE classroom_id = $1 AND teacher_id = $2 AND status = 'active'
            AND EXISTS (
              SELECT 1 FROM compass_teacher_accounts
              WHERE teacher_id = $2 AND status = 'active' AND expires_at > $4
            )
          RETURNING *
        `,
        [
          input.classroomId,
          input.teacherId,
          input.joinCodeHash,
          input.now,
          input.now + CLASSROOM_RETENTION_V1.joinCodeMs,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        const owned = await client.query<{ status: string }>(
          "SELECT status FROM compass_classrooms WHERE classroom_id = $1 AND teacher_id = $2",
          [input.classroomId, input.teacherId],
        );
        if (owned.rows[0]) throw new ClassroomPilotError("classroom_archived");
        throw new ClassroomPilotError("classroom_not_found");
      }
      return parseClassroom(row);
    });
  }

  async archiveClassroom(
    teacherId: string,
    classroomId: string,
    now: number,
  ): Promise<Classroom> {
    const result = await this.pool.query<ClassroomRow>(
      `
        UPDATE compass_classrooms
        SET status = 'archived', join_code_hash = NULL,
            join_code_issued_at = NULL, join_code_expires_at = NULL
        WHERE classroom_id = $1 AND teacher_id = $2
          AND EXISTS (
            SELECT 1 FROM compass_teacher_accounts
            WHERE teacher_id = $2 AND status = 'active' AND expires_at > $3
          )
        RETURNING *
      `,
      [classroomId, teacherId, now],
    );
    const row = result.rows[0];
    if (!row) throw new ClassroomPilotError("classroom_not_found");
    return parseClassroom(row);
  }

  async removeLearnerAlias(
    teacherId: string,
    classroomId: string,
    learnerAliasId: string,
    now: number,
  ): Promise<void> {
    const result = await this.pool.query(
      `
        DELETE FROM compass_learner_aliases
        WHERE learner_alias_id = $1
          AND classroom_id = $2
          AND EXISTS (
            SELECT 1 FROM compass_classrooms
            WHERE classroom_id = $2 AND teacher_id = $3
              AND EXISTS (
                SELECT 1 FROM compass_teacher_accounts
                WHERE teacher_id = $3 AND status = 'active' AND expires_at > $4
              )
          )
      `,
      [learnerAliasId, classroomId, teacherId, now],
    );
    if (result.rowCount !== 1) {
      throw new ClassroomPilotError("learner_alias_not_found");
    }
  }

  async joinClassroom(input: JoinClassroomInputV1): Promise<LearnerMembershipV1> {
    return this.transaction(async (client) => {
      await acquirePilotLock(client);
      const candidates = await activeCodeCandidates(client, input.now);
      const matches: ClassroomRow[] = [];
      for (const row of candidates) {
        if (
          row.join_code_hash &&
          (await verifyJoinCode(input.joinCode, row.join_code_hash))
        ) {
          matches.push(row);
        }
      }
      if (matches.length !== 1) {
        throw new ClassroomPilotError("join_code_invalid_or_expired");
      }
      const classroom = parseClassroom(matches[0]);
      const aliasId = `learner_${randomUUID()}`;
      try {
        const result = await client.query<AliasRow>(
          `
            INSERT INTO compass_learner_aliases
              (learner_alias_id, schema_version, classroom_id, pseudonym,
               status, created_at, expires_at)
            VALUES ($1, 'learner_alias.v1', $2, $3, 'active', $4, $5)
            RETURNING *
          `,
          [
            aliasId,
            classroom.id,
            input.pseudonym,
            input.now,
            Math.min(
              input.now + CLASSROOM_RETENTION_V1.learnerAliasMs,
              classroom.expiresAt,
            ),
          ],
        );
        return {
          classroom: classroomProjection(classroom),
          learnerAlias: parseAlias(result.rows[0]),
        };
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ClassroomPilotError("learner_alias_conflict");
        }
        throw error;
      }
    });
  }

  async readLearnerMembership(
    classroomId: string,
    learnerAliasId: string,
    now: number,
  ): Promise<LearnerMembershipV1 | undefined> {
    const result = await this.pool.query<
      QueryResultRow & ClassroomRow & AliasRow
    >(
      `
        SELECT classroom.*, alias.*
        FROM compass_classrooms classroom
        JOIN compass_learner_aliases alias
          ON alias.classroom_id = classroom.classroom_id
        WHERE classroom.classroom_id = $1
          AND alias.learner_alias_id = $2
          AND classroom.status = 'active'
          AND alias.status = 'active'
          AND classroom.expires_at > $3
          AND alias.expires_at > $3
      `,
      [classroomId, learnerAliasId, now],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const classroom = parseClassroom(row);
    return {
      classroom: classroomProjection(classroom),
      learnerAlias: parseAlias(row),
    };
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function acquirePilotLock(client: Queryable): Promise<void> {
  const result = await client.query(
    `UPDATE compass_classroom_control
     SET revision = revision + 1
     WHERE lock_key = 1
     RETURNING revision`,
  );
  if (result.rowCount !== 1) {
    throw new ClassroomPilotError("classroom_store_unavailable");
  }
}

async function activeCodeCandidates(
  client: Queryable,
  now: number,
): Promise<ClassroomRow[]> {
  const result = await client.query<ClassroomRow>(
    `SELECT * FROM compass_classrooms
     WHERE status = 'active'
       AND expires_at > $1
       AND join_code_hash IS NOT NULL
       AND join_code_expires_at > $1`,
    [now],
  );
  return result.rows;
}

async function assertCodeAvailable(
  client: Queryable,
  joinCode: string,
  now: number,
  excludedClassroomId?: string,
): Promise<void> {
  const candidates = await activeCodeCandidates(client, now);
  for (const row of candidates) {
    if (
      row.classroom_id !== excludedClassroomId &&
      row.join_code_hash &&
      (await verifyJoinCode(joinCode, row.join_code_hash))
    ) {
      throw new ClassroomPilotError("join_code_collision");
    }
  }
}

function parseTeacher(row: TeacherRow): TeacherIdentity {
  return TeacherIdentityV1.parse({
    schemaVersion: row.schema_version,
    id: row.teacher_id,
    authSubjectHash: row.auth_subject_hash,
    locale: row.locale,
    status: row.status,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  });
}

function parseClassroom(row: ClassroomRow): Classroom {
  return ClassroomV1.parse({
    schemaVersion: row.schema_version,
    id: row.classroom_id,
    teacherId: row.teacher_id,
    label: row.label,
    joinCodeHash: row.join_code_hash,
    joinCodeIssuedAt:
      row.join_code_issued_at === null ? null : Number(row.join_code_issued_at),
    status: row.status,
    createdAt: Number(row.created_at),
    joinCodeExpiresAt:
      row.join_code_expires_at === null
        ? null
        : Number(row.join_code_expires_at),
    expiresAt: Number(row.expires_at),
  });
}

function parseAlias(row: AliasRow): LearnerAlias {
  return LearnerAliasV1.parse({
    schemaVersion: row.schema_version,
    id: row.learner_alias_id,
    classroomId: row.classroom_id,
    pseudonym: row.pseudonym,
    status: row.status,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  });
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

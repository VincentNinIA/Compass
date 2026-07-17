import { createHash, randomUUID } from "node:crypto";

import { type Pool, type PoolClient, type QueryResultRow } from "pg";

import {
  CLASSROOM_RETENTION_V1,
  ClassActivityTemplateV1,
  ClassAssignmentV1,
  ClassroomGroupV1,
  ClassroomV1,
  LearnerAliasV1,
  TeacherIdentityV1,
  type ClassActivityTemplateV1 as ClassActivityTemplate,
  type ClassAssignmentV1 as ClassAssignment,
  type ClassroomGroupV1 as ClassroomGroup,
  type ClassroomV1 as Classroom,
  type LearnerAliasV1 as LearnerAlias,
  type TeacherIdentityV1 as TeacherIdentity,
} from "./contracts";
import { hashClassroomActivityContractV1 } from "./activity-catalog";
import { verifyJoinCode } from "./join-code";
import {
  ClassroomPilotError,
  teacherIdFromAuthSubjectHash,
  type ClassroomAssignmentViewV1,
  type ClassroomPilotStoreV1,
  type ClassroomWithRosterV1,
  type CreateClassAssignmentInputV1,
  type CreateClassroomInputV1,
  type CreateClassroomGroupInputV1,
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

type GroupRow = QueryResultRow & {
  group_id: string;
  schema_version: string;
  classroom_id: string;
  label: string;
  created_at: string | number;
  expires_at: string | number;
  learner_alias_ids?: string[] | null;
};

type TemplateRow = QueryResultRow & {
  template_id: string;
  schema_version: string;
  teacher_id: string;
  publication: unknown;
  contract_hash: string;
  created_at: string | number;
  expires_at: string | number;
};

type AssignmentRow = QueryResultRow & {
  assignment_id: string;
  schema_version: string;
  classroom_id: string;
  template_id: string;
  created_by_teacher_id: string;
  target_kind: string;
  target_group_id: string | null;
  target_learner_alias_id: string | null;
  contract_hash: string;
  assistance_policy: unknown;
  status: string;
  created_at: string | number;
  opens_at: string | number;
  closes_at: string | number;
  expires_at: string | number;
  recipient_alias_ids?: string[] | null;
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
    await refreshAssignmentStatuses(this.pool, now, teacherId);
    const [classrooms, aliases, groups, groupMembers, templates, assignments, recipients] = await Promise.all([
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
      this.pool.query<GroupRow>(
        `SELECT group_row.*
         FROM compass_classroom_groups group_row
         JOIN compass_classrooms classroom
           ON classroom.classroom_id = group_row.classroom_id
         WHERE classroom.teacher_id = $1
           AND group_row.expires_at > $2
         ORDER BY group_row.created_at ASC`,
        [teacherId, now],
      ),
      this.pool.query<{ group_id: string; learner_alias_id: string }>(
        `SELECT member.group_id, member.learner_alias_id
         FROM compass_classroom_group_members member
         JOIN compass_classroom_groups group_row ON group_row.group_id = member.group_id
         JOIN compass_classrooms classroom ON classroom.classroom_id = group_row.classroom_id
         WHERE classroom.teacher_id = $1
         ORDER BY member.learner_alias_id ASC`,
        [teacherId],
      ),
      this.pool.query<TemplateRow>(
        `SELECT * FROM compass_activity_templates
         WHERE teacher_id = $1 AND expires_at > $2`,
        [teacherId, now],
      ),
      this.pool.query<AssignmentRow>(
        `SELECT assignment.*
         FROM compass_assignments assignment
         JOIN compass_classrooms classroom
           ON classroom.classroom_id = assignment.classroom_id
         WHERE classroom.teacher_id = $1
           AND assignment.expires_at > $2
         ORDER BY assignment.created_at DESC`,
        [teacherId, now],
      ),
      this.pool.query<{ assignment_id: string; learner_alias_id: string }>(
        `SELECT recipient.assignment_id, recipient.learner_alias_id
         FROM compass_assignment_recipients recipient
         JOIN compass_assignments assignment
           ON assignment.assignment_id = recipient.assignment_id
         JOIN compass_classrooms classroom
           ON classroom.classroom_id = assignment.classroom_id
         WHERE classroom.teacher_id = $1
           AND assignment.expires_at > $2
         ORDER BY recipient.learner_alias_id ASC`,
        [teacherId, now],
      ),
    ]);
    const parsedAliases = aliases.rows.map(parseAlias);
    const parsedGroups = groups.rows.map((row) =>
      parseGroup(
        row,
        groupMembers.rows
          .filter((member) => member.group_id === row.group_id)
          .map((member) => member.learner_alias_id),
      ),
    );
    const parsedTemplates = new Map(
      templates.rows.map((row) => {
        const template = parseTemplate(row);
        return [template.id, template] as const;
      }),
    );
    const parsedAssignments = assignments.rows.map(parseAssignment);
    return classrooms.rows.map((row) => {
      const classroom = parseClassroom(row);
      return {
        classroom,
        learnerAliases: parsedAliases.filter(
          (alias) => alias.classroomId === classroom.id,
        ),
        groups: parsedGroups.filter(
          (group) => group.classroomId === classroom.id,
        ),
        assignments: parsedAssignments
          .filter((assignment) => assignment.classroomId === classroom.id)
          .map((assignment) =>
            assignmentView(
              assignment,
              parsedTemplates,
              recipients.rows
                .filter(
                  (recipient) =>
                    recipient.assignment_id === assignment.id,
                )
                .map((recipient) => recipient.learner_alias_id),
            ),
          ),
      };
    });
  }

  async createClassroomGroup(
    input: CreateClassroomGroupInputV1,
  ): Promise<ClassroomGroup> {
    return this.transaction(async (client) => {
      await acquirePilotLock(client);
      const classroomResult = await client.query<ClassroomRow>(
        `SELECT classroom.*
         FROM compass_classrooms classroom
         JOIN compass_teacher_accounts teacher
           ON teacher.teacher_id = classroom.teacher_id
         WHERE classroom.classroom_id = $1
           AND classroom.teacher_id = $2
           AND classroom.status = 'active'
           AND classroom.expires_at > $3
           AND teacher.status = 'active'
           AND teacher.expires_at > $3`,
        [input.classroomId, input.teacherId, input.now],
      );
      const classroomRow = classroomResult.rows[0];
      if (!classroomRow) throw new ClassroomPilotError("classroom_not_found");
      const activeAliases = await client.query<AliasRow>(
        `SELECT * FROM compass_learner_aliases
         WHERE classroom_id = $1 AND status = 'active' AND expires_at > $2`,
        [input.classroomId, input.now],
      );
      const requestedIds = [...new Set(input.learnerAliasIds)];
      if (
        requestedIds.length !== input.learnerAliasIds.length ||
        requestedIds.some(
          (learnerAliasId) =>
            !activeAliases.rows.some(
              (row) => row.learner_alias_id === learnerAliasId,
            ),
        )
      ) {
        throw new ClassroomPilotError("assignment_target_not_found");
      }
      const groupId = `group_${randomUUID()}`;
      try {
        const groupResult = await client.query<GroupRow>(
          `INSERT INTO compass_classroom_groups
            (group_id, schema_version, classroom_id, label, created_at, expires_at)
           VALUES ($1, 'classroom_group.v1', $2, $3, $4, $5)
           RETURNING *`,
          [
            groupId,
            input.classroomId,
            input.label,
            input.now,
            Number(classroomRow.expires_at),
          ],
        );
        for (const learnerAliasId of requestedIds) {
          await client.query(
            `INSERT INTO compass_classroom_group_members (group_id, learner_alias_id)
             VALUES ($1, $2)`,
            [groupId, learnerAliasId],
          );
        }
        return parseGroup(groupResult.rows[0], requestedIds);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ClassroomPilotError("classroom_group_conflict");
        }
        throw error;
      }
    });
  }

  async createClassAssignment(
    input: CreateClassAssignmentInputV1,
  ): Promise<ClassroomAssignmentViewV1> {
    if (
      hashClassroomActivityContractV1(input.publication) !== input.contractHash
    ) {
      throw new ClassroomPilotError("assignment_contract_drift");
    }
    return this.transaction(async (client) => {
      await acquirePilotLock(client);
      const assignmentId = assignmentIdFromIdempotency(
        input.teacherId,
        input.idempotencyKey,
      );
      const existingResult = await client.query<AssignmentRow>(
        `SELECT * FROM compass_assignments WHERE assignment_id = $1`,
        [assignmentId],
      );
      const existingRow = existingResult.rows[0];
      if (existingRow) {
        const existing = parseAssignment(existingRow);
        if (!sameAssignmentIntent(existing, input)) {
          throw new ClassroomPilotError("assignment_idempotency_conflict");
        }
        await refreshAssignmentStatuses(client, input.now, input.teacherId);
        const [templateResult, recipientResult, refreshedResult] = await Promise.all([
          client.query<TemplateRow>(
            `SELECT * FROM compass_activity_templates WHERE template_id = $1`,
            [existing.templateId],
          ),
          client.query<{ learner_alias_id: string }>(
            `SELECT learner_alias_id FROM compass_assignment_recipients
             WHERE assignment_id = $1 ORDER BY learner_alias_id`,
            [existing.id],
          ),
          client.query<AssignmentRow>(
            `SELECT * FROM compass_assignments WHERE assignment_id = $1`,
            [existing.id],
          ),
        ]);
        const template = parseTemplate(templateResult.rows[0]);
        return assignmentView(
          parseAssignment(refreshedResult.rows[0]),
          new Map([[template.id, template]]),
          recipientResult.rows.map((row) => row.learner_alias_id),
        );
      }

      const classroomResult = await client.query<
        ClassroomRow & { teacher_expires_at: string | number }
      >(
        `SELECT classroom.*, teacher.expires_at AS teacher_expires_at
         FROM compass_classrooms classroom
         JOIN compass_teacher_accounts teacher
           ON teacher.teacher_id = classroom.teacher_id
         WHERE classroom.classroom_id = $1
           AND classroom.teacher_id = $2
           AND classroom.status = 'active'
           AND classroom.expires_at > $3
           AND teacher.status = 'active'
           AND teacher.expires_at > $3`,
        [input.classroomId, input.teacherId, input.now],
      );
      const classroomRow = classroomResult.rows[0];
      if (!classroomRow) throw new ClassroomPilotError("classroom_not_found");
      const recipientAliasIds = await resolveAssignmentRecipients(
        client,
        input,
      );
      if (recipientAliasIds.length === 0) {
        throw new ClassroomPilotError("assignment_target_empty");
      }

      const templateId = templateIdFromContract(
        input.teacherId,
        input.contractHash,
      );
      const existingTemplate = await client.query<TemplateRow>(
        `SELECT * FROM compass_activity_templates WHERE template_id = $1`,
        [templateId],
      );
      let template: ClassActivityTemplate;
      if (existingTemplate.rows[0]) {
        template = parseTemplate(existingTemplate.rows[0]);
        if (
          template.teacherId !== input.teacherId ||
          template.contractHash !== input.contractHash ||
          hashClassroomActivityContractV1(template.publication) !==
            input.contractHash
        ) {
          throw new ClassroomPilotError("assignment_contract_drift");
        }
      } else {
        const expiresAt = Math.min(
          input.now + CLASSROOM_RETENTION_V1.activityTemplateMs,
          Number(classroomRow.expires_at),
          Number(classroomRow.teacher_expires_at),
        );
        const parsedTemplate = ClassActivityTemplateV1.parse({
          schemaVersion: "class_activity_template.v1",
          id: templateId,
          teacherId: input.teacherId,
          publication: input.publication,
          contractHash: input.contractHash,
          createdAt: input.now,
          expiresAt,
        });
        const templateResult = await client.query<TemplateRow>(
          `INSERT INTO compass_activity_templates
            (template_id, schema_version, teacher_id, publication,
             contract_hash, created_at, expires_at)
           VALUES ($1, 'class_activity_template.v1', $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            parsedTemplate.id,
            parsedTemplate.teacherId,
            parsedTemplate.publication,
            parsedTemplate.contractHash,
            parsedTemplate.createdAt,
            parsedTemplate.expiresAt,
          ],
        );
        template = parseTemplate(templateResult.rows[0]);
      }
      if (input.closesAt > template.expiresAt) {
        throw new ClassroomPilotError("assignment_invalid_window");
      }
      const assignment = ClassAssignmentV1.parse({
        schemaVersion: "class_assignment.v1",
        id: assignmentId,
        classroomId: input.classroomId,
        templateId: template.id,
        createdByTeacherId: input.teacherId,
        target: input.target,
        contractHash: input.contractHash,
        assistancePolicy: input.publication.content.exercise.assistancePolicy,
        status: input.opensAt <= input.now ? "active" : "scheduled",
        createdAt: input.now,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        expiresAt: Math.min(
          input.closesAt + CLASSROOM_RETENTION_V1.assignmentMsAfterClose,
          Number(classroomRow.expires_at),
          template.expiresAt,
        ),
      });
      await client.query(
        `INSERT INTO compass_assignments
          (assignment_id, schema_version, classroom_id, template_id,
           created_by_teacher_id, target_kind, target_group_id,
           target_learner_alias_id, contract_hash, assistance_policy, status,
           created_at, opens_at, closes_at, expires_at)
         VALUES ($1, 'class_assignment.v1', $2, $3, $4, $5, $6, $7, $8,
                 $9, $10, $11, $12, $13, $14)`,
        [
          assignment.id,
          assignment.classroomId,
          assignment.templateId,
          assignment.createdByTeacherId,
          assignment.target.kind,
          assignment.target.kind === "group" ? assignment.target.groupId : null,
          assignment.target.kind === "learner"
            ? assignment.target.learnerAliasId
            : null,
          assignment.contractHash,
          assignment.assistancePolicy,
          assignment.status,
          assignment.createdAt,
          assignment.opensAt,
          assignment.closesAt,
          assignment.expiresAt,
        ],
      );
      for (const learnerAliasId of recipientAliasIds) {
        await client.query(
          `INSERT INTO compass_assignment_recipients
            (assignment_id, learner_alias_id, created_at)
           VALUES ($1, $2, $3)`,
          [assignment.id, learnerAliasId, input.now],
        );
      }
      return assignmentView(
        assignment,
        new Map([[template.id, template]]),
        recipientAliasIds,
      );
    });
  }

  async revokeClassAssignment(
    teacherId: string,
    classroomId: string,
    assignmentId: string,
    now: number,
  ): Promise<ClassroomAssignmentViewV1> {
    return this.transaction(async (client) => {
      const assignmentResult = await client.query<AssignmentRow>(
        `UPDATE compass_assignments
         SET status = 'revoked'
         WHERE assignment_id = $1
           AND classroom_id = $2
           AND created_by_teacher_id = $3
           AND EXISTS (
             SELECT 1 FROM compass_teacher_accounts teacher
             WHERE teacher.teacher_id = $3
               AND teacher.status = 'active'
               AND teacher.expires_at > $4
           )
         RETURNING *`,
        [assignmentId, classroomId, teacherId, now],
      );
      const row = assignmentResult.rows[0];
      if (!row) throw new ClassroomPilotError("assignment_not_found");
      const assignment = parseAssignment(row);
      const [templateResult, recipientResult] = await Promise.all([
        client.query<TemplateRow>(
          `SELECT * FROM compass_activity_templates WHERE template_id = $1`,
          [assignment.templateId],
        ),
        client.query<{ learner_alias_id: string }>(
          `SELECT learner_alias_id FROM compass_assignment_recipients
           WHERE assignment_id = $1 ORDER BY learner_alias_id`,
          [assignment.id],
        ),
      ]);
      const template = parseTemplate(templateResult.rows[0]);
      return assignmentView(
        assignment,
        new Map([[template.id, template]]),
        recipientResult.rows.map((recipient) => recipient.learner_alias_id),
      );
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
    return this.transaction(async (client) => {
      await acquirePilotLock(client);
      const result = await client.query<ClassroomRow>(
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
      await client.query(
        `UPDATE compass_assignments SET status = 'revoked'
         WHERE classroom_id = $1 AND status IN ('scheduled', 'active')`,
        [classroomId],
      );
      return parseClassroom(row);
    });
  }

  async removeLearnerAlias(
    teacherId: string,
    classroomId: string,
    learnerAliasId: string,
    now: number,
  ): Promise<void> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `DELETE FROM compass_learner_aliases
         WHERE learner_alias_id = $1
           AND classroom_id = $2
           AND EXISTS (
             SELECT 1 FROM compass_classrooms
             WHERE classroom_id = $2 AND teacher_id = $3
               AND EXISTS (
                 SELECT 1 FROM compass_teacher_accounts
                 WHERE teacher_id = $3 AND status = 'active' AND expires_at > $4
               )
           )`,
        [learnerAliasId, classroomId, teacherId, now],
      );
      if (result.rowCount !== 1) {
        throw new ClassroomPilotError("learner_alias_not_found");
      }
      await client.query(
        `DELETE FROM compass_classroom_groups
         WHERE classroom_id = $1
           AND group_id NOT IN (
             SELECT group_id FROM compass_classroom_group_members
           )`,
        [classroomId],
      );
    });
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
          assignments: [],
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
      ClassroomRow & {
        learner_alias_id: string;
        alias_schema_version: string;
        pseudonym: string;
        alias_status: string;
        alias_created_at: string | number;
        alias_expires_at: string | number;
      }
    >(
      `
        SELECT classroom.*, alias.learner_alias_id,
               alias.schema_version AS alias_schema_version,
               alias.pseudonym, alias.status AS alias_status,
               alias.created_at AS alias_created_at,
               alias.expires_at AS alias_expires_at
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
    await refreshAssignmentStatuses(this.pool, now);
    const assignmentRows = await this.pool.query<
      AssignmentRow & {
        publication: unknown;
        template_created_at: string | number;
        template_expires_at: string | number;
      }
    >(
      `SELECT assignment.*, template.publication,
              template.created_at AS template_created_at,
              template.expires_at AS template_expires_at
       FROM compass_assignments assignment
       JOIN compass_assignment_recipients recipient
         ON recipient.assignment_id = assignment.assignment_id
       JOIN compass_activity_templates template
         ON template.template_id = assignment.template_id
       WHERE recipient.learner_alias_id = $1
         AND assignment.classroom_id = $2
         AND assignment.status = 'active'
         AND assignment.opens_at <= $3
         AND assignment.closes_at > $3
         AND assignment.expires_at > $3
         AND template.expires_at > $3
       ORDER BY assignment.opens_at ASC`,
      [learnerAliasId, classroomId, now],
    );
    return {
      classroom: classroomProjection(classroom),
      learnerAlias: LearnerAliasV1.parse({
        schemaVersion: row.alias_schema_version,
        id: row.learner_alias_id,
        classroomId: classroomId,
        pseudonym: row.pseudonym,
        status: row.alias_status,
        createdAt: Number(row.alias_created_at),
        expiresAt: Number(row.alias_expires_at),
      }),
      assignments: assignmentRows.rows.map((assignmentRow) => {
        const assignment = parseAssignment(assignmentRow);
        const template = ClassActivityTemplateV1.parse({
          schemaVersion: "class_activity_template.v1",
          id: assignment.templateId,
          teacherId: assignment.createdByTeacherId,
          publication: assignmentRow.publication,
          contractHash: assignment.contractHash,
          createdAt: Number(assignmentRow.template_created_at),
          expiresAt: Number(assignmentRow.template_expires_at),
        });
        return assignmentView(
          assignment,
          new Map([[template.id, template]]),
          [learnerAliasId],
        );
      }),
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

function parseGroup(
  row: GroupRow,
  learnerAliasIds: readonly string[],
): ClassroomGroup {
  return ClassroomGroupV1.parse({
    schemaVersion: row.schema_version,
    id: row.group_id,
    classroomId: row.classroom_id,
    label: row.label,
    learnerAliasIds,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  });
}

function parseTemplate(row: TemplateRow): ClassActivityTemplate {
  return ClassActivityTemplateV1.parse({
    schemaVersion: row.schema_version,
    id: row.template_id,
    teacherId: row.teacher_id,
    publication: row.publication,
    contractHash: row.contract_hash,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  });
}

function parseAssignment(row: AssignmentRow): ClassAssignment {
  const target =
    row.target_kind === "classroom"
      ? { kind: "classroom" as const, classroomId: row.classroom_id }
      : row.target_kind === "group" && row.target_group_id
        ? { kind: "group" as const, groupId: row.target_group_id }
        : row.target_kind === "learner" && row.target_learner_alias_id
          ? {
              kind: "learner" as const,
              learnerAliasId: row.target_learner_alias_id,
            }
          : null;
  if (!target) throw new ClassroomPilotError("classroom_store_unavailable");
  return ClassAssignmentV1.parse({
    schemaVersion: row.schema_version,
    id: row.assignment_id,
    classroomId: row.classroom_id,
    templateId: row.template_id,
    createdByTeacherId: row.created_by_teacher_id,
    target,
    contractHash: row.contract_hash,
    assistancePolicy: row.assistance_policy,
    status: row.status,
    createdAt: Number(row.created_at),
    opensAt: Number(row.opens_at),
    closesAt: Number(row.closes_at),
    expiresAt: Number(row.expires_at),
  });
}

function assignmentView(
  assignment: ClassAssignment,
  templates: ReadonlyMap<string, ClassActivityTemplate>,
  recipientAliasIds: readonly string[],
): ClassroomAssignmentViewV1 {
  const template = templates.get(assignment.templateId);
  if (!template) throw new ClassroomPilotError("classroom_store_unavailable");
  return {
    assignment,
    publication: structuredClone(template.publication),
    recipientAliasIds: Object.freeze([...new Set(recipientAliasIds)].sort()),
  };
}

async function resolveAssignmentRecipients(
  client: Queryable,
  input: CreateClassAssignmentInputV1,
): Promise<string[]> {
  if (input.target.kind === "classroom") {
    if (input.target.classroomId !== input.classroomId) {
      throw new ClassroomPilotError("assignment_target_not_found");
    }
    const result = await client.query<{ learner_alias_id: string }>(
      `SELECT learner_alias_id FROM compass_learner_aliases
       WHERE classroom_id = $1 AND status = 'active' AND expires_at > $2
       ORDER BY learner_alias_id`,
      [input.classroomId, input.now],
    );
    return result.rows.map((row) => row.learner_alias_id);
  }
  if (input.target.kind === "group") {
    const group = await client.query<{ group_id: string }>(
      `SELECT group_id FROM compass_classroom_groups
       WHERE group_id = $1 AND classroom_id = $2 AND expires_at > $3`,
      [input.target.groupId, input.classroomId, input.now],
    );
    if (!group.rows[0]) {
      throw new ClassroomPilotError("classroom_group_not_found");
    }
    const result = await client.query<{ learner_alias_id: string }>(
      `SELECT alias.learner_alias_id
       FROM compass_classroom_group_members member
       JOIN compass_learner_aliases alias
         ON alias.learner_alias_id = member.learner_alias_id
       WHERE member.group_id = $1
         AND alias.classroom_id = $2
         AND alias.status = 'active'
         AND alias.expires_at > $3
       ORDER BY alias.learner_alias_id`,
      [input.target.groupId, input.classroomId, input.now],
    );
    return result.rows.map((row) => row.learner_alias_id);
  }
  const result = await client.query<{ learner_alias_id: string }>(
    `SELECT learner_alias_id FROM compass_learner_aliases
     WHERE learner_alias_id = $1 AND classroom_id = $2
       AND status = 'active' AND expires_at > $3`,
    [input.target.learnerAliasId, input.classroomId, input.now],
  );
  if (!result.rows[0]) {
    throw new ClassroomPilotError("assignment_target_not_found");
  }
  return [result.rows[0].learner_alias_id];
}

async function refreshAssignmentStatuses(
  client: Queryable,
  now: number,
  teacherId?: string,
): Promise<void> {
  await client.query(
    `UPDATE compass_assignments
     SET status = CASE
       WHEN closes_at <= $1 THEN 'closed'
       WHEN opens_at <= $1 THEN 'active'
       ELSE 'scheduled'
     END
     WHERE status IN ('scheduled', 'active')
       ${teacherId ? "AND created_by_teacher_id = $2" : ""}`,
    teacherId ? [now, teacherId] : [now],
  );
}

function assignmentIdFromIdempotency(
  teacherId: string,
  idempotencyKey: string,
): string {
  return `assignment_${createHash("sha256")
    .update(`${teacherId}\0${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function templateIdFromContract(
  teacherId: string,
  contractHash: string,
): string {
  return `template_${createHash("sha256")
    .update(`${teacherId}\0${contractHash}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function sameAssignmentIntent(
  assignment: ClassAssignment,
  input: CreateClassAssignmentInputV1,
): boolean {
  return (
    assignment.classroomId === input.classroomId &&
    assignment.createdByTeacherId === input.teacherId &&
    assignment.templateId ===
      templateIdFromContract(input.teacherId, input.contractHash) &&
    assignment.contractHash === input.contractHash &&
    assignment.opensAt === input.opensAt &&
    assignment.closesAt === input.closesAt &&
    JSON.stringify(assignment.target) === JSON.stringify(input.target) &&
    hashClassroomActivityContractV1(assignment.assistancePolicy) ===
      hashClassroomActivityContractV1(
        input.publication.content.exercise.assistancePolicy,
      )
  );
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

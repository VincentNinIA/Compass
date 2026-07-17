import { describe, expect, it } from "vitest";

import { authorizeClassroomAccessV1 } from "./access";
import { ClassroomStoreSnapshotV1 } from "./contracts";
import { ForbiddenPersistentDataError } from "./data-policy";
import {
  deleteClassroomCascadeV1,
  deleteLearnerAliasCascadeV1,
  purgeExpiredClassroomDataV1,
} from "./lifecycle";
import {
  ClassroomAccessDeniedError,
  MemoryClassroomStoreV1,
} from "./store";
import {
  CLASSROOM_TEST_NOW,
  createClassroomTestSnapshotV1,
} from "./test-fixtures";

const teacherA = {
  role: "teacher" as const,
  teacherId: "teacher_alpha-0001",
};
const teacherB = {
  role: "teacher" as const,
  teacherId: "teacher_beta-0002",
};
const learnerA = {
  role: "learner" as const,
  learnerAliasId: "learner_alpha-0001",
};
const learnerB = {
  role: "learner" as const,
  learnerAliasId: "learner_beta-0002",
};
const migrationActor = { role: "system" as const, purpose: "migration" as const };
const retentionActor = { role: "system" as const, purpose: "retention" as const };

describe("T25-C01 deny-by-default access matrix", () => {
  it("lets each teacher read only owned class records and factual evidence", () => {
    const snapshot = createClassroomTestSnapshotV1();
    expect(
      authorizeClassroomAccessV1(
        snapshot,
        teacherA,
        "read_assignment",
        { kind: "assignment", id: "assignment_alpha-0001" },
        CLASSROOM_TEST_NOW,
      ),
    ).toEqual({ allowed: true, reason: "authorized" });
    expect(
      authorizeClassroomAccessV1(
        snapshot,
        teacherA,
        "read_class_evidence",
        { kind: "learning_evidence", id: "evidence_alpha-0001" },
        CLASSROOM_TEST_NOW,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeClassroomAccessV1(
        snapshot,
        teacherB,
        "read_assignment",
        { kind: "assignment", id: "assignment_alpha-0001" },
        CLASSROOM_TEST_NOW,
      ),
    ).toEqual({ allowed: false, reason: "cross_class_forbidden" });
    expect(
      authorizeClassroomAccessV1(
        snapshot,
        teacherA,
        "read_checkpoint",
        { kind: "session_checkpoint", id: "checkpoint_alpha-0001" },
        CLASSROOM_TEST_NOW,
      ).allowed,
    ).toBe(false);
  });

  it("lets an alias access only targeted assignments and owned records", () => {
    const snapshot = createClassroomTestSnapshotV1();
    for (const [action, resource] of [
      [
        "read_own_assignment",
        { kind: "assignment", id: "assignment_alpha-0001" },
      ],
      [
        "read_own_evidence",
        { kind: "learning_evidence", id: "evidence_alpha-0001" },
      ],
      [
        "read_checkpoint",
        { kind: "session_checkpoint", id: "checkpoint_alpha-0001" },
      ],
    ] as const) {
      expect(
        authorizeClassroomAccessV1(
          snapshot,
          learnerA,
          action,
          resource,
          CLASSROOM_TEST_NOW,
        ).allowed,
      ).toBe(true);
      expect(
        authorizeClassroomAccessV1(
          snapshot,
          learnerB,
          action,
          resource,
          CLASSROOM_TEST_NOW,
        ).allowed,
      ).toBe(false);
    }
    expect(
      authorizeClassroomAccessV1(
        snapshot,
        learnerA,
        "read_roster",
        { kind: "learner_alias", id: "learner_alpha-0001" },
        CLASSROOM_TEST_NOW,
      ),
    ).toEqual({ allowed: false, reason: "role_action_forbidden" });
  });

  it("resolves group membership and closes expired or revoked actors", () => {
    const base = createClassroomTestSnapshotV1();
    const grouped = ClassroomStoreSnapshotV1.parse({
      ...base,
      assignments: base.assignments.map((assignment) =>
        assignment.id === "assignment_alpha-0001"
          ? {
              ...assignment,
              target: { kind: "group", groupId: "group_alpha-0001" },
            }
          : assignment,
      ),
    });
    expect(
      authorizeClassroomAccessV1(
        grouped,
        learnerA,
        "read_own_assignment",
        { kind: "assignment", id: "assignment_alpha-0001" },
        CLASSROOM_TEST_NOW,
      ).allowed,
    ).toBe(true);

    const expired = ClassroomStoreSnapshotV1.parse({
      ...base,
      learnerAliases: base.learnerAliases.map((alias) =>
        alias.id === learnerA.learnerAliasId
          ? { ...alias, status: "revoked" }
          : alias,
      ),
    });
    expect(
      authorizeClassroomAccessV1(
        expired,
        learnerA,
        "read_own_assignment",
        { kind: "assignment", id: "assignment_alpha-0001" },
        CLASSROOM_TEST_NOW,
      ),
    ).toEqual({ allowed: false, reason: "actor_inactive" });
  });

  it("reserves migration and retention privileges to their exact system purpose", () => {
    const snapshot = createClassroomTestSnapshotV1();
    expect(
      authorizeClassroomAccessV1(
        snapshot,
        migrationActor,
        "migrate_store",
        undefined,
        CLASSROOM_TEST_NOW,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeClassroomAccessV1(
        snapshot,
        migrationActor,
        "purge_expired",
        undefined,
        CLASSROOM_TEST_NOW,
      ).allowed,
    ).toBe(false);
    expect(
      authorizeClassroomAccessV1(
        snapshot,
        retentionActor,
        "purge_expired",
        undefined,
        CLASSROOM_TEST_NOW,
      ).allowed,
    ).toBe(true);
  });
});

describe("T25-C01 reference store and lifecycle", () => {
  it("serves one learner queue and rejects cross-class reads", () => {
    const store = new MemoryClassroomStoreV1(createClassroomTestSnapshotV1());
    expect(store.listAssignments(learnerA, CLASSROOM_TEST_NOW)).toHaveLength(1);
    expect(
      store.readAssignment(
        learnerA,
        "assignment_alpha-0001",
        CLASSROOM_TEST_NOW,
      )?.id,
    ).toBe("assignment_alpha-0001");
    expect(() =>
      store.readAssignment(
        teacherB,
        "assignment_alpha-0001",
        CLASSROOM_TEST_NOW,
      ),
    ).toThrowError(ClassroomAccessDeniedError);
  });

  it("accepts a current factual projection and refuses forbidden content before storage", () => {
    const snapshot = createClassroomTestSnapshotV1();
    const store = new MemoryClassroomStoreV1(snapshot);
    const evidence = snapshot.learningEvidence[0]!;
    const updated = store.upsertEvidence(
      learnerA,
      {
        ...evidence,
        exerciseXp: 40,
        updatedAt: CLASSROOM_TEST_NOW + 1,
      },
      CLASSROOM_TEST_NOW,
    );
    expect(updated.exerciseXp).toBe(40);
    expect(
      store.readEvidence(
        learnerA,
        "evidence_alpha-0001",
        CLASSROOM_TEST_NOW,
      )?.exerciseXp,
    ).toBe(40);
    expect(() =>
      store.upsertEvidence(
        learnerA,
        { ...evidence, transcript: "learner raw speech" },
        CLASSROOM_TEST_NOW,
      ),
    ).toThrowError(ForbiddenPersistentDataError);
    expect(() =>
      store.upsertEvidence(learnerB, evidence, CLASSROOM_TEST_NOW),
    ).toThrowError(ClassroomAccessDeniedError);
  });

  it("stores only the bounded semantic checkpoint and hides it from teachers", () => {
    const snapshot = createClassroomTestSnapshotV1();
    const store = new MemoryClassroomStoreV1(snapshot);
    const checkpoint = snapshot.sessionCheckpoints[0]!;
    expect(
      store.upsertCheckpoint(learnerA, checkpoint, CLASSROOM_TEST_NOW)
        .safeState.constructedMidpoints,
    ).toEqual(["E"]);
    expect(() =>
      store.readCheckpoint(
        teacherA,
        "checkpoint_alpha-0001",
        CLASSROOM_TEST_NOW,
      ),
    ).toThrowError(ClassroomAccessDeniedError);
    expect(() =>
      store.upsertCheckpoint(
        learnerA,
        {
          ...checkpoint,
          safeState: { ...checkpoint.safeState, base64: "AAAA" },
        },
        CLASSROOM_TEST_NOW,
      ),
    ).toThrowError(ForbiddenPersistentDataError);
  });

  it("deletes one class and every dependent alias, assignment, fact and checkpoint", () => {
    const snapshot = createClassroomTestSnapshotV1();
    const result = deleteClassroomCascadeV1(snapshot, "classroom_alpha-0001");
    expect(result.deleted).toEqual({
      teachers: 0,
      classrooms: 1,
      groups: 1,
      learnerAliases: 1,
      activityTemplates: 0,
      assignments: 1,
      learningEvidence: 1,
      sessionCheckpoints: 1,
    });
    expect(result.snapshot.classrooms.map(({ id }) => id)).toEqual([
      "classroom_beta-0002",
    ]);
    expect(result.snapshot.activityTemplates).toHaveLength(2);
  });

  it("enforces owner-only cascade deletion through the store", () => {
    const store = new MemoryClassroomStoreV1(createClassroomTestSnapshotV1());
    expect(() =>
      store.deleteClassroom(
        teacherB,
        "classroom_alpha-0001",
        CLASSROOM_TEST_NOW,
      ),
    ).toThrowError(ClassroomAccessDeniedError);
    expect(
      store.deleteClassroom(
        teacherA,
        "classroom_alpha-0001",
        CLASSROOM_TEST_NOW,
      ).classrooms,
    ).toBe(1);
    expect(
      store.exportForMigration(migrationActor).classrooms.map(({ id }) => id),
    ).toEqual(["classroom_beta-0002"]);
  });

  it("lets only the owning teacher remove an alias and its dependent records", () => {
    const grouped = ClassroomStoreSnapshotV1.parse({
      ...createClassroomTestSnapshotV1(),
      assignments: createClassroomTestSnapshotV1().assignments.map(
        (assignment) =>
          assignment.id === "assignment_alpha-0001"
            ? {
                ...assignment,
                target: { kind: "group", groupId: "group_alpha-0001" },
              }
            : assignment,
      ),
    });
    const directResult = deleteLearnerAliasCascadeV1(
      grouped,
      learnerA.learnerAliasId,
    );
    expect(directResult.deleted).toMatchObject({
      groups: 1,
      learnerAliases: 1,
      assignments: 1,
      learningEvidence: 1,
      sessionCheckpoints: 1,
    });

    const store = new MemoryClassroomStoreV1(grouped);
    expect(() =>
      store.deleteLearnerAlias(
        teacherB,
        learnerA.learnerAliasId,
        CLASSROOM_TEST_NOW,
      ),
    ).toThrowError(ClassroomAccessDeniedError);
    expect(
      store.deleteLearnerAlias(
        teacherA,
        learnerA.learnerAliasId,
        CLASSROOM_TEST_NOW,
      ),
    ).toMatchObject({
      groups: 1,
      learnerAliases: 1,
      assignments: 1,
      learningEvidence: 1,
      sessionCheckpoints: 1,
    });
  });

  it("purges evidence and checkpoints exactly at expiry", () => {
    const base = createClassroomTestSnapshotV1();
    const expiresAt = CLASSROOM_TEST_NOW + 1;
    const snapshot = ClassroomStoreSnapshotV1.parse({
      ...base,
      learningEvidence: base.learningEvidence.map((evidence) =>
        evidence.id === "evidence_alpha-0001"
          ? { ...evidence, expiresAt }
          : evidence,
      ),
      sessionCheckpoints: base.sessionCheckpoints.map((checkpoint) =>
        checkpoint.id === "checkpoint_alpha-0001"
          ? { ...checkpoint, expiresAt }
          : checkpoint,
      ),
    });
    const result = purgeExpiredClassroomDataV1(snapshot, expiresAt);
    expect(result.deleted.learningEvidence).toBe(1);
    expect(result.deleted.sessionCheckpoints).toBe(1);
    expect(result.snapshot.assignments).toHaveLength(2);
  });

  it("clears an expired join-code hash without deleting its class", () => {
    const snapshot = createClassroomTestSnapshotV1();
    const expiresAt = snapshot.classrooms[0]!.joinCodeExpiresAt!;
    const result = purgeExpiredClassroomDataV1(snapshot, expiresAt);
    const classroom = result.snapshot.classrooms.find(
      ({ id }) => id === "classroom_alpha-0001",
    );
    expect(classroom).toMatchObject({
      joinCodeHash: null,
      joinCodeIssuedAt: null,
      joinCodeExpiresAt: null,
    });
    expect(result.deleted.classrooms).toBe(0);
  });

  it("allows only the retention actor to mutate expiry state", () => {
    const base = createClassroomTestSnapshotV1();
    const expiresAt = CLASSROOM_TEST_NOW + 1;
    const snapshot = ClassroomStoreSnapshotV1.parse({
      ...base,
      learningEvidence: base.learningEvidence.map((evidence) => ({
        ...evidence,
        expiresAt,
      })),
    });
    const store = new MemoryClassroomStoreV1(snapshot);
    expect(() =>
      store.purgeExpired(migrationActor, expiresAt),
    ).toThrowError(ClassroomAccessDeniedError);
    expect(store.purgeExpired(retentionActor, expiresAt).learningEvidence).toBe(
      2,
    );
  });
});

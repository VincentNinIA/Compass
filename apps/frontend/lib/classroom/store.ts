import {
  authorizeClassroomAccessV1,
  type ClassroomAccessActionV1,
  type ClassroomAccessDecisionV1,
  type ClassroomActorV1,
  type ClassroomResourceV1,
} from "./access";
import {
  ClassroomStoreSnapshotV1,
  LearningEvidenceV1,
  SessionCheckpointV1,
  type ClassAssignmentV1,
  type ClassroomStoreSnapshotV1 as ClassroomSnapshot,
  type LearningEvidenceV1 as LearningEvidence,
  type SessionCheckpointV1 as SessionCheckpoint,
} from "./contracts";
import { assertNoForbiddenPersistentDataV1 } from "./data-policy";
import {
  deleteClassroomCascadeV1,
  deleteLearnerAliasCascadeV1,
  purgeExpiredClassroomDataV1,
  type ClassroomCascadeReportV1,
} from "./lifecycle";

export const CLASSROOM_STORE_TARGET_DRIVER = "postgresql-16" as const;
export const CLASSROOM_STORE_REFERENCE_DRIVER = "memory-reference" as const;

export class ClassroomAccessDeniedError extends Error {
  readonly reason: Extract<
    ClassroomAccessDecisionV1,
    { allowed: false }
  >["reason"];

  constructor(
    reason: Extract<
      ClassroomAccessDecisionV1,
      { allowed: false }
    >["reason"],
  ) {
    super("classroom_access_denied");
    this.name = "ClassroomAccessDeniedError";
    this.reason = reason;
  }
}

export interface ClassroomStoreV1 {
  readonly driver:
    | typeof CLASSROOM_STORE_TARGET_DRIVER
    | typeof CLASSROOM_STORE_REFERENCE_DRIVER;
  listAssignments(
    actor: ClassroomActorV1,
    now?: number,
  ): readonly ClassAssignmentV1[];
  readAssignment(
    actor: ClassroomActorV1,
    assignmentId: string,
    now?: number,
  ): ClassAssignmentV1 | undefined;
  readEvidence(
    actor: ClassroomActorV1,
    evidenceId: string,
    now?: number,
  ): LearningEvidence | undefined;
  upsertEvidence(
    actor: ClassroomActorV1,
    input: unknown,
    now?: number,
  ): LearningEvidence;
  readCheckpoint(
    actor: ClassroomActorV1,
    checkpointId: string,
    now?: number,
  ): SessionCheckpoint | undefined;
  upsertCheckpoint(
    actor: ClassroomActorV1,
    input: unknown,
    now?: number,
  ): SessionCheckpoint;
  deleteClassroom(
    actor: ClassroomActorV1,
    classroomId: string,
    now?: number,
  ): ClassroomCascadeReportV1;
  deleteLearnerAlias(
    actor: ClassroomActorV1,
    learnerAliasId: string,
    now?: number,
  ): ClassroomCascadeReportV1;
  purgeExpired(
    actor: ClassroomActorV1,
    now?: number,
  ): ClassroomCascadeReportV1;
  exportForMigration(actor: ClassroomActorV1): ClassroomSnapshot;
  replaceFromMigration(
    actor: ClassroomActorV1,
    snapshot: ClassroomSnapshot,
  ): void;
}

export class MemoryClassroomStoreV1 implements ClassroomStoreV1 {
  readonly driver = CLASSROOM_STORE_REFERENCE_DRIVER;
  #snapshot: ClassroomSnapshot;

  constructor(snapshot: ClassroomSnapshot) {
    assertNoForbiddenPersistentDataV1(snapshot);
    this.#snapshot = structuredClone(ClassroomStoreSnapshotV1.parse(snapshot));
  }

  listAssignments(
    actor: ClassroomActorV1,
    now = Date.now(),
  ): readonly ClassAssignmentV1[] {
    return Object.freeze(
      this.#snapshot.assignments
        .filter((assignment) => {
          const action =
            actor.role === "learner"
              ? "read_own_assignment"
              : "read_assignment";
          return authorizeClassroomAccessV1(
            this.#snapshot,
            actor,
            action,
            { kind: "assignment", id: assignment.id },
            now,
          ).allowed;
        })
        .map((assignment) => structuredClone(assignment)),
    );
  }

  readAssignment(
    actor: ClassroomActorV1,
    assignmentId: string,
    now = Date.now(),
  ): ClassAssignmentV1 | undefined {
    const assignment = this.#snapshot.assignments.find(
      ({ id }) => id === assignmentId,
    );
    if (!assignment) return undefined;
    authorizeOrThrow(
      this.#snapshot,
      actor,
      actor.role === "learner" ? "read_own_assignment" : "read_assignment",
      { kind: "assignment", id: assignmentId },
      now,
    );
    return structuredClone(assignment);
  }

  readEvidence(
    actor: ClassroomActorV1,
    evidenceId: string,
    now = Date.now(),
  ): LearningEvidence | undefined {
    const evidence = this.#snapshot.learningEvidence.find(
      ({ id }) => id === evidenceId,
    );
    if (!evidence) return undefined;
    authorizeOrThrow(
      this.#snapshot,
      actor,
      actor.role === "learner"
        ? "read_own_evidence"
        : "read_class_evidence",
      { kind: "learning_evidence", id: evidenceId },
      now,
    );
    return structuredClone(evidence);
  }

  upsertEvidence(
    actor: ClassroomActorV1,
    input: unknown,
    now = Date.now(),
  ): LearningEvidence {
    assertNoForbiddenPersistentDataV1(input);
    const evidence = LearningEvidenceV1.parse(input);
    const assignment = this.#snapshot.assignments.find(
      ({ id }) => id === evidence.assignmentId,
    );
    if (!assignment) throw new Error("assignment_missing");
    authorizeOrThrow(
      this.#snapshot,
      actor,
      "write_evidence",
      { kind: "assignment", id: assignment.id },
      now,
    );
    if (
      actor.role !== "learner" ||
      actor.learnerAliasId !== evidence.learnerAliasId
    ) {
      throw new ClassroomAccessDeniedError("cross_class_forbidden");
    }
    if (evidence.expiresAt > assignment.expiresAt) {
      throw new Error("evidence_outlives_assignment");
    }
    const previous = this.#snapshot.learningEvidence.find(
      (candidate) =>
        candidate.assignmentId === evidence.assignmentId &&
        candidate.learnerAliasId === evidence.learnerAliasId,
    );
    if (previous && previous.id !== evidence.id) {
      throw new Error("evidence_identity_conflict");
    }
    if (previous && evidence.updatedAt < previous.updatedAt) {
      throw new Error("stale_evidence_update");
    }
    this.#snapshot = ClassroomStoreSnapshotV1.parse({
      ...this.#snapshot,
      learningEvidence: [
        evidence,
        ...this.#snapshot.learningEvidence.filter(
          ({ id }) => id !== evidence.id,
        ),
      ],
    });
    return structuredClone(evidence);
  }

  readCheckpoint(
    actor: ClassroomActorV1,
    checkpointId: string,
    now = Date.now(),
  ): SessionCheckpoint | undefined {
    const checkpoint = this.#snapshot.sessionCheckpoints.find(
      ({ id }) => id === checkpointId,
    );
    if (!checkpoint) return undefined;
    authorizeOrThrow(
      this.#snapshot,
      actor,
      "read_checkpoint",
      { kind: "session_checkpoint", id: checkpointId },
      now,
    );
    return structuredClone(checkpoint);
  }

  upsertCheckpoint(
    actor: ClassroomActorV1,
    input: unknown,
    now = Date.now(),
  ): SessionCheckpoint {
    assertNoForbiddenPersistentDataV1(input);
    const checkpoint = SessionCheckpointV1.parse(input);
    const assignment = this.#snapshot.assignments.find(
      ({ id }) => id === checkpoint.assignmentId,
    );
    if (!assignment) throw new Error("assignment_missing");
    authorizeOrThrow(
      this.#snapshot,
      actor,
      "write_checkpoint",
      { kind: "assignment", id: assignment.id },
      now,
    );
    if (
      actor.role !== "learner" ||
      actor.learnerAliasId !== checkpoint.learnerAliasId
    ) {
      throw new ClassroomAccessDeniedError("cross_class_forbidden");
    }
    if (checkpoint.expiresAt > assignment.expiresAt) {
      throw new Error("checkpoint_outlives_assignment");
    }
    const previous = this.#snapshot.sessionCheckpoints.find(
      (candidate) =>
        candidate.assignmentId === checkpoint.assignmentId &&
        candidate.learnerAliasId === checkpoint.learnerAliasId,
    );
    if (previous && previous.id !== checkpoint.id) {
      throw new Error("checkpoint_identity_conflict");
    }
    if (previous && checkpoint.createdAt < previous.createdAt) {
      throw new Error("stale_checkpoint_update");
    }
    this.#snapshot = ClassroomStoreSnapshotV1.parse({
      ...this.#snapshot,
      sessionCheckpoints: [
        checkpoint,
        ...this.#snapshot.sessionCheckpoints.filter(
          ({ id }) => id !== checkpoint.id,
        ),
      ],
    });
    return structuredClone(checkpoint);
  }

  deleteClassroom(
    actor: ClassroomActorV1,
    classroomId: string,
    now = Date.now(),
  ): ClassroomCascadeReportV1 {
    authorizeOrThrow(
      this.#snapshot,
      actor,
      "delete_classroom",
      { kind: "classroom", id: classroomId },
      now,
    );
    const result = deleteClassroomCascadeV1(this.#snapshot, classroomId);
    this.#snapshot = result.snapshot;
    return result.deleted;
  }

  deleteLearnerAlias(
    actor: ClassroomActorV1,
    learnerAliasId: string,
    now = Date.now(),
  ): ClassroomCascadeReportV1 {
    authorizeOrThrow(
      this.#snapshot,
      actor,
      "delete_learner_alias",
      { kind: "learner_alias", id: learnerAliasId },
      now,
    );
    const result = deleteLearnerAliasCascadeV1(
      this.#snapshot,
      learnerAliasId,
    );
    this.#snapshot = result.snapshot;
    return result.deleted;
  }

  purgeExpired(
    actor: ClassroomActorV1,
    now = Date.now(),
  ): ClassroomCascadeReportV1 {
    authorizeOrThrow(this.#snapshot, actor, "purge_expired", undefined, now);
    const result = purgeExpiredClassroomDataV1(this.#snapshot, now);
    this.#snapshot = result.snapshot;
    return result.deleted;
  }

  exportForMigration(actor: ClassroomActorV1): ClassroomSnapshot {
    authorizeOrThrow(this.#snapshot, actor, "migrate_store");
    return structuredClone(this.#snapshot);
  }

  replaceFromMigration(
    actor: ClassroomActorV1,
    snapshot: ClassroomSnapshot,
  ): void {
    authorizeOrThrow(this.#snapshot, actor, "migrate_store");
    assertNoForbiddenPersistentDataV1(snapshot);
    this.#snapshot = structuredClone(ClassroomStoreSnapshotV1.parse(snapshot));
  }
}

function authorizeOrThrow(
  snapshot: ClassroomSnapshot,
  actor: ClassroomActorV1,
  action: ClassroomAccessActionV1,
  resource?: ClassroomResourceV1,
  now?: number,
): void {
  const decision = authorizeClassroomAccessV1(
    snapshot,
    actor,
    action,
    resource,
    now,
  );
  if (!decision.allowed) throw new ClassroomAccessDeniedError(decision.reason);
}

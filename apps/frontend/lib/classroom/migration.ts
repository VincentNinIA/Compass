import { z } from "zod";

import {
  ClassroomStoreSnapshotV1,
  createEmptyClassroomStoreV1,
  type ClassroomStoreSnapshotV1 as ClassroomSnapshot,
} from "./contracts";

export const CLASSROOM_STORE_V0_SCHEMA_VERSION = "classroom_store.v0" as const;

export const ClassroomStoreSnapshotV0 = z.strictObject({
  schemaVersion: z.literal(CLASSROOM_STORE_V0_SCHEMA_VERSION),
  records: z.array(z.never()).length(0),
});

export type ClassroomStoreSnapshotV0 = z.infer<
  typeof ClassroomStoreSnapshotV0
>;

export function migrateClassroomStoreV0ToV1(
  input: ClassroomStoreSnapshotV0,
): ClassroomSnapshot {
  ClassroomStoreSnapshotV0.parse(input);
  return createEmptyClassroomStoreV1();
}

export function downgradeClassroomStoreV1ToV0(
  input: ClassroomSnapshot,
): ClassroomStoreSnapshotV0 {
  const snapshot = ClassroomStoreSnapshotV1.parse(input);
  const recordCount =
    snapshot.teachers.length +
    snapshot.classrooms.length +
    snapshot.groups.length +
    snapshot.learnerAliases.length +
    snapshot.activityTemplates.length +
    snapshot.assignments.length +
    snapshot.learningEvidence.length +
    snapshot.sessionCheckpoints.length;
  if (recordCount > 0) throw new Error("migration_would_drop_classroom_data");
  return {
    schemaVersion: CLASSROOM_STORE_V0_SCHEMA_VERSION,
    records: [],
  };
}

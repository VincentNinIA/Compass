import { normalizeCommand, stableHash } from "@/lib/geogebra/snapshot";
import type {
  CompletedConstructionAction,
  ConstructionSnapshot,
  SceneObjectOwner,
  SnapshotObject,
} from "@/types/geogebra";

export type FactStatus = "unknown" | "missing" | "verified";

export type FactForDelta = {
  relationKey: string;
  status: FactStatus;
};

export type MeaningfulDeltaReason =
  | "student_construction_changed"
  | "facts_changed"
  | "construction_and_facts_changed"
  | "no_semantic_change"
  | "non_student_change"
  | "snapshot_unstable"
  | "action_snapshot_mismatch"
  | "ownership_missing"
  | "facts_unavailable";

export type MeaningfulDelta = {
  isMeaningful: boolean;
  constructionChanged: boolean;
  factsChanged: boolean;
  changedStudentObjects: readonly string[];
  previousFactSignature: string;
  currentFactSignature: string;
  missingRelationKeys: readonly string[];
  reason: MeaningfulDeltaReason;
};

export type StudentConstructionFingerprint = {
  hash: string;
  objects: readonly CanonicalStudentObject[];
};

export type RepeatedBlockState = {
  stepId: string;
  missingRelationSignature: string;
  count: number;
  lastActionId: string | null;
  processedActionIds: readonly string[];
};

type CanonicalStudentObject = {
  name: string;
  kind: SnapshotObject["kind"];
  command: string;
};

export function createStudentConstructionFingerprint(
  snapshot: ConstructionSnapshot,
): StudentConstructionFingerprint | null {
  if (!snapshot.complete) return null;
  const objects = snapshot.objects
    .filter((object) => object.owner === "student")
    .map(({ name, kind, command }) => ({
      name,
      kind,
      command: normalizeCommand(command),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    hash: stableHash(JSON.stringify({ version: 1, objects })),
    objects,
  };
}

export function createFactSignature(facts: readonly FactForDelta[]): string {
  return facts
    .map(({ relationKey, status }) => `${relationKey}:${status}`)
    .sort()
    .join("|");
}

export function deriveMissingRelationKeys(
  facts: readonly FactForDelta[],
): readonly string[] {
  return [
    ...new Set(
      facts
        .filter(({ status }) => status === "missing" || status === "unknown")
        .map(({ relationKey }) => relationKey),
    ),
  ].sort();
}

export function createMissingRelationSignature(
  missingRelationKeys: readonly string[],
): string {
  return [...new Set(missingRelationKeys)].sort().join("|");
}

export function deriveMeaningfulDelta(input: {
  action: CompletedConstructionAction;
  previousSnapshot: ConstructionSnapshot;
  currentSnapshot: ConstructionSnapshot;
  previousFacts: readonly FactForDelta[];
  currentFacts: readonly FactForDelta[];
}): MeaningfulDelta {
  const previousFactSignature = createFactSignature(input.previousFacts);
  const currentFactSignature = createFactSignature(input.currentFacts);
  const missingRelationKeys = deriveMissingRelationKeys(input.currentFacts);
  const base = {
    previousFactSignature,
    currentFactSignature,
    missingRelationKeys,
  };
  if (input.currentFacts.length === 0) {
    return notMeaningful(base, "facts_unavailable");
  }
  const previousConstruction = createStudentConstructionFingerprint(
    input.previousSnapshot,
  );
  const currentConstruction = createStudentConstructionFingerprint(
    input.currentSnapshot,
  );

  if (!previousConstruction || !currentConstruction) {
    return notMeaningful(base, "snapshot_unstable");
  }
  if (
    input.action.revision !== input.currentSnapshot.revision ||
    input.action.snapshotHash !== input.currentSnapshot.hash
  ) {
    return notMeaningful(base, "action_snapshot_mismatch");
  }

  const owners = ownershipByName(
    input.previousSnapshot.objects,
    input.currentSnapshot.objects,
  );
  const invalidOwnership =
    input.action.affectedNames.some((name) => !owners.has(name)) ||
    input.action.studentAffectedNames.some(
      (name) =>
        !input.action.affectedNames.includes(name) ||
        owners.get(name) !== "student",
    );
  if (invalidOwnership) return notMeaningful(base, "ownership_missing");

  const changedStudentObjects = changedObjects(
    previousConstruction.objects,
    currentConstruction.objects,
  );
  const constructionChanged = changedStudentObjects.length > 0;
  const factsChanged = previousFactSignature !== currentFactSignature;
  const hasStudentOwnership =
    input.action.studentAffectedNames.length > 0 ||
    input.action.affectedNames.some((name) => owners.get(name) === "student");

  if (!hasStudentOwnership) {
    return {
      ...notMeaningful(base, "non_student_change"),
      constructionChanged,
      factsChanged,
      changedStudentObjects,
    };
  }
  if (!constructionChanged && !factsChanged) {
    return notMeaningful(base, "no_semantic_change");
  }
  return {
    isMeaningful: true,
    constructionChanged,
    factsChanged,
    changedStudentObjects,
    ...base,
    reason:
      constructionChanged && factsChanged
        ? "construction_and_facts_changed"
        : constructionChanged
          ? "student_construction_changed"
          : "facts_changed",
  };
}

export function createRepeatedBlockState(stepId: string): RepeatedBlockState {
  return {
    stepId,
    missingRelationSignature: "",
    count: 0,
    lastActionId: null,
    processedActionIds: [],
  };
}

export function reduceRepeatedBlockState(
  current: RepeatedBlockState,
  input: {
    stepId: string;
    actionId: string;
    delta: MeaningfulDelta;
  },
): RepeatedBlockState {
  const base =
    current.stepId === input.stepId
      ? current
      : createRepeatedBlockState(input.stepId);
  if (base.processedActionIds.includes(input.actionId)) return base;

  const processedActionIds = [...base.processedActionIds, input.actionId];
  const missingRelationSignature = createMissingRelationSignature(
    input.delta.missingRelationKeys,
  );
  if (!input.delta.isMeaningful) {
    return { ...base, processedActionIds };
  }
  if (missingRelationSignature.length === 0) {
    return {
      ...base,
      missingRelationSignature: "",
      count: 0,
      lastActionId: input.actionId,
      processedActionIds,
    };
  }
  return {
    ...base,
    missingRelationSignature,
    count:
      missingRelationSignature === base.missingRelationSignature
        ? base.count + 1
        : 1,
    lastActionId: input.actionId,
    processedActionIds,
  };
}

function notMeaningful(
  signatures: Pick<
    MeaningfulDelta,
    | "previousFactSignature"
    | "currentFactSignature"
    | "missingRelationKeys"
  >,
  reason: MeaningfulDeltaReason,
): MeaningfulDelta {
  return {
    isMeaningful: false,
    constructionChanged: false,
    factsChanged: false,
    changedStudentObjects: [],
    ...signatures,
    reason,
  };
}

function ownershipByName(
  previous: readonly SnapshotObject[],
  current: readonly SnapshotObject[],
): ReadonlyMap<string, SceneObjectOwner> {
  const owners = new Map<string, SceneObjectOwner>();
  for (const object of [...previous, ...current]) owners.set(object.name, object.owner);
  return owners;
}

function changedObjects(
  previous: readonly CanonicalStudentObject[],
  current: readonly CanonicalStudentObject[],
): readonly string[] {
  const before = new Map(previous.map((object) => [object.name, object]));
  const after = new Map(current.map((object) => [object.name, object]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(
      (name) =>
        JSON.stringify(before.get(name)) !== JSON.stringify(after.get(name)),
    )
    .sort();
}

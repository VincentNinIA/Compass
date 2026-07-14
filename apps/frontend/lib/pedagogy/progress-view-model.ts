import {
  getPedagogyInvariantViolations,
  type PedagogyRelationKey,
  type PedagogyState,
  type VerifiedFactStatus,
} from "./state";

export type ProgressPropertyViewModel = {
  relationKey: PedagogyRelationKey;
  label: string;
  status: VerifiedFactStatus;
  evidenceId: string | null;
};

export type ProgressViewModel = {
  score: 0 | 1 | 2;
  total: 2;
  properties: readonly [
    ProgressPropertyViewModel,
    ProgressPropertyViewModel,
  ];
  announcement: string;
};

const PROPERTY_DEFINITIONS = [
  { relationKey: "perpendicular", label: "Perpendicular to AB" },
  {
    relationKey: "passes_midpoint",
    label: "Passes through the midpoint of AB",
  },
] as const;

export function initialProgressViewModel(): ProgressViewModel {
  return {
    score: 0,
    total: 2,
    properties: [unknownProperty(0), unknownProperty(1)],
    announcement: "",
  };
}

export function selectProgressViewModel(
  state: PedagogyState,
  previous?: ProgressViewModel,
): ProgressViewModel {
  if (
    getPedagogyInvariantViolations(state).length > 0 ||
    !hasExpectedFactShape(state)
  ) {
    return withAnnouncement(
      initialProgressViewModel(),
      previous,
      "Local evidence needs revalidation.",
    );
  }

  const properties: ProgressViewModel["properties"] = [
    currentProperty(state, 0),
    currentProperty(state, 1),
  ];
  const verified = properties.filter(
    (property) => property.status === "verified",
  ).length as 0 | 1 | 2;
  const model: ProgressViewModel = {
    score: verified,
    total: 2,
    properties,
    announcement: "",
  };
  return withAnnouncement(model, previous, progressAnnouncement(model, previous));
}

function hasExpectedFactShape(state: PedagogyState): boolean {
  if (state.verifiedFacts.length === 0) return true;
  return (
    state.verifiedFacts.length === PROPERTY_DEFINITIONS.length &&
    PROPERTY_DEFINITIONS.every(
      ({ relationKey }) =>
        state.verifiedFacts.filter(
          (fact) => fact.relationKey === relationKey,
        ).length === 1,
    ) &&
    state.verifiedFacts.every((fact) => {
      const evidence = state.evidenceById[fact.evidenceId];
      return (
        evidence !== undefined &&
        evidence.relation === fact.relationKey &&
        evidence.revision === state.revision &&
        evidence.snapshotHash === state.studentSnapshotHash &&
        fact.status === (evidence.pass ? "verified" : "missing")
      );
    })
  );
}

function unknownProperty(index: 0 | 1): ProgressPropertyViewModel {
  return {
    ...PROPERTY_DEFINITIONS[index],
    status: "unknown",
    evidenceId: null,
  };
}

function currentProperty(
  state: PedagogyState,
  index: 0 | 1,
): ProgressPropertyViewModel {
  const { relationKey, label } = PROPERTY_DEFINITIONS[index];
  const fact = state.verifiedFacts.find(
    (candidate) => candidate.relationKey === relationKey,
  );
  const evidence = fact ? state.evidenceById[fact.evidenceId] : undefined;
  const current =
    fact !== undefined &&
    evidence !== undefined &&
    evidence.relation === relationKey &&
    evidence.revision === state.revision &&
    evidence.snapshotHash === state.studentSnapshotHash;
  return {
    relationKey,
    label,
    status: current ? fact.status : "unknown",
    evidenceId: current ? fact.evidenceId : null,
  };
}

function withAnnouncement(
  model: ProgressViewModel,
  previous: ProgressViewModel | undefined,
  announcement: string,
): ProgressViewModel {
  if (!previous || sameFacts(model, previous)) return model;
  return { ...model, announcement };
}

function progressAnnouncement(
  current: ProgressViewModel,
  previous?: ProgressViewModel,
): string {
  if (!previous || sameFacts(current, previous)) return "";
  const changes = current.properties
    .filter(
      (property, index) =>
        property.status !== previous.properties[index]?.status,
    )
    .map((property) => `${property.label}: ${statusLabel(property.status)}`);
  return `Construction progress ${current.score} of ${current.total}. ${changes.join("; ")}.`;
}

function statusLabel(status: VerifiedFactStatus): string {
  if (status === "verified") return "verified";
  if (status === "missing") return "not yet verified";
  return "needs revalidation";
}

function sameFacts(
  left: ProgressViewModel,
  right: ProgressViewModel,
): boolean {
  return left.properties.every(
    (property, index) => property.status === right.properties[index]?.status,
  );
}

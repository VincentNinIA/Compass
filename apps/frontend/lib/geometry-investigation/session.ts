import type {
  GeometryEvidenceCaptureV1,
  GeometryInvestigationV1,
  GeometryMissionV1,
  GeometryWorldObjectV2,
  GeometryWorldV2,
} from "./contracts";

export const GEOMETRY_SESSION_PHASES_V1 = [
  "loading",
  "ready",
  "constructing",
  "exploring",
  "conjecturing",
  "verifying",
  "justifying",
  "transferring",
  "completed",
  "recovering",
  "fatal",
] as const;

export type GeometrySessionPhaseV1 =
  (typeof GEOMETRY_SESSION_PHASES_V1)[number];
export type GeometryMissionStatusV1 =
  | "locked"
  | "active"
  | "completed"
  | "verified";

export type GeometryMissionProgressV1 = Readonly<{
  missionId: string;
  order: number;
  status: GeometryMissionStatusV1;
  evidenceIds: readonly string[];
  missingEvidenceIds: readonly string[];
  completedAtRevision?: number;
}>;

export type GeometryMissionAttemptV1 = Readonly<{
  missionId: string;
  count: number;
  repeatedBlockCount: number;
  explicitHelpRequestCount: number;
  lastActionId?: string;
  lastMissingSignature: string;
  processedActionIds: readonly string[];
  processedHelpRequestIds: readonly string[];
  deliveredLevels: readonly (1 | 2 | 3 | 4)[];
  proactiveSignatures: readonly string[];
}>;

export type GeometrySessionStateV1 = Readonly<{
  activityId: string;
  epoch: number;
  revision: number;
  phase: GeometrySessionPhaseV1;
  world?: GeometryWorldV2;
  captures: readonly GeometryEvidenceCaptureV1[];
  missions: readonly GeometryMissionProgressV1[];
  activeMissionId?: string;
  reflections: Readonly<{
    conjectureCompleted: boolean;
    transferCompleted: boolean;
    completedJustificationStepIds: readonly string[];
  }>;
  attempts: Readonly<Record<string, GeometryMissionAttemptV1>>;
  processedReflectionIds: readonly string[];
  demonstrationsViewed: readonly string[];
  assistance: Readonly<{
    highestLevelUsed: 0 | 1 | 2 | 3 | 4;
    deliveredDirectiveIds: readonly string[];
  }>;
  xpLedger: Readonly<Record<string, 0 | 10 | 20>>;
  rejectionCount: number;
  fatalReason?: string;
}>;

export type GeometrySessionEventV1 =
  | Readonly<{
      type: "activity_ready";
      activityId: string;
      epoch: number;
      revision: number;
    }>
  | Readonly<{ type: "world_committed"; world: GeometryWorldV2 }>
  | Readonly<{
      type: "captures_changed";
      activityId: string;
      epoch: number;
      revision: number;
      captures: readonly GeometryEvidenceCaptureV1[];
    }>
  | Readonly<{
      type: "reflection_completed";
      activityId: string;
      epoch: number;
      revision: number;
      reflectionId: string;
      kind: "conjecture" | "transfer";
      hasText: boolean;
    }>
  | Readonly<{
      type: "justification_step_completed";
      activityId: string;
      epoch: number;
      revision: number;
      completionId: string;
      stepId: string;
    }>
  | Readonly<{
      type: "attempt_recorded";
      activityId: string;
      epoch: number;
      revision: number;
      missionId: string;
      actionId: string;
    }>
  | Readonly<{
      type: "explicit_help_requested";
      activityId: string;
      epoch: number;
      revision: number;
      missionId: string;
      requestId: string;
    }>
  | Readonly<{
      type: "assistance_delivered";
      activityId: string;
      epoch: number;
      revision: number;
      missionId: string;
      directiveId: string;
      source: "proactive" | "explicit";
      level: 1 | 2 | 3 | 4;
      blockSignature?: string;
    }>
  | Readonly<{
      type: "demonstration_viewed";
      activityId: string;
      epoch: number;
      revision: number;
      stepId: string;
    }>
  | Readonly<{
      type: "restore_started";
      activityId: string;
      epoch: number;
      revision: number;
    }>
  | Readonly<{ type: "restore_completed"; world: GeometryWorldV2 }>
  | Readonly<{
      type: "fatal";
      activityId: string;
      reason: string;
    }>;

type MissionEvaluation = Readonly<{
  satisfied: boolean;
  verified: boolean;
  evidenceIds: readonly string[];
  missingEvidenceIds: readonly string[];
}>;

export function createGeometrySessionStateV1(
  activity: GeometryInvestigationV1,
): GeometrySessionStateV1 {
  return freezeState({
    activityId: activity.id,
    epoch: 0,
    revision: 0,
    phase: "loading",
    captures: [],
    missions: activity.missions.map((mission, index) => ({
      missionId: mission.id,
      order: mission.order,
      status: index === 0 ? "active" : "locked",
      evidenceIds: [],
      missingEvidenceIds: [...mission.requiredEvidence],
    })),
    activeMissionId: activity.missions[0]?.id,
    reflections: {
      conjectureCompleted: false,
      transferCompleted: false,
      completedJustificationStepIds: [],
    },
    attempts: {},
    processedReflectionIds: [],
    demonstrationsViewed: [],
    assistance: { highestLevelUsed: 0, deliveredDirectiveIds: [] },
    xpLedger: {},
    rejectionCount: 0,
  });
}

export function reduceGeometrySessionV1(
  activity: GeometryInvestigationV1,
  state: GeometrySessionStateV1,
  event: GeometrySessionEventV1,
): GeometrySessionStateV1 {
  if (activity.id !== state.activityId) return reject(state);
  if (event.type === "fatal") {
    return event.activityId === state.activityId
      ? freezeState({ ...state, phase: "fatal", fatalReason: event.reason })
      : reject(state);
  }
  if (state.phase === "fatal") return reject(state);

  if (event.type === "activity_ready") {
    if (
      state.phase !== "loading" ||
      event.activityId !== state.activityId ||
      event.epoch < 0 ||
      event.revision < 0
    ) {
      return reject(state);
    }
    return freezeState({
      ...state,
      epoch: event.epoch,
      revision: event.revision,
      phase: "ready",
    });
  }

  if (event.type === "world_committed" || event.type === "restore_completed") {
    const world = event.world;
    if (
      world.activityId !== state.activityId ||
      world.epoch < state.epoch ||
      (world.epoch === state.epoch && world.revision < state.revision)
    ) {
      return reject(state);
    }
    const base = {
      ...state,
      epoch: world.epoch,
      revision: world.revision,
      world,
      phase:
        state.phase === "loading"
          ? "ready" as const
          : state.phase === "recovering"
            ? "constructing" as const
            : state.phase,
    };
    if (base.phase === "ready" && !hasApprovedScaffold(activity, world)) {
      return freezeState(base);
    }
    return deriveMissionProgress(activity, {
      ...base,
      phase: base.phase === "ready" ? "constructing" : base.phase,
    });
  }

  if (event.type === "restore_started") {
    return matchesAnchor(state, event)
      ? freezeState({ ...state, phase: "recovering" })
      : reject(state);
  }

  if (!matchesAnchor(state, event)) return reject(state);

  if (event.type === "captures_changed") {
    const captures = event.captures.filter(
      (capture) => capture.activityId === state.activityId,
    );
    if (captures.length !== event.captures.length || hasDuplicateIds(captures)) {
      return reject(state);
    }
    return deriveMissionProgress(activity, { ...state, captures });
  }

  if (event.type === "reflection_completed") {
    if (
      !event.hasText ||
      !validEventId(event.reflectionId) ||
      state.processedReflectionIds.includes(event.reflectionId)
    ) {
      return reject(state);
    }
    return deriveMissionProgress(activity, {
      ...state,
      reflections: {
        ...state.reflections,
        ...(event.kind === "conjecture"
          ? { conjectureCompleted: true }
          : { transferCompleted: true }),
      },
      processedReflectionIds: [
        ...state.processedReflectionIds,
        event.reflectionId,
      ],
    });
  }

  if (event.type === "justification_step_completed") {
    const validStep = activity.demonstrationSteps.some(
      ({ id }) => id === event.stepId,
    );
    if (
      !validStep ||
      !validEventId(event.completionId) ||
      state.processedReflectionIds.includes(event.completionId)
    ) {
      return reject(state);
    }
    return deriveMissionProgress(activity, {
      ...state,
      reflections: {
        ...state.reflections,
        completedJustificationStepIds: unique([
          ...state.reflections.completedJustificationStepIds,
          event.stepId,
        ]),
      },
      processedReflectionIds: [
        ...state.processedReflectionIds,
        event.completionId,
      ],
    });
  }

  if (event.type === "demonstration_viewed") {
    if (!activity.demonstrationSteps.some(({ id }) => id === event.stepId)) {
      return reject(state);
    }
    return freezeState({
      ...state,
      demonstrationsViewed: unique([
        ...state.demonstrationsViewed,
        event.stepId,
      ]),
    });
  }

  if (event.type === "attempt_recorded") {
    if (!validEventId(event.actionId) || !missionExists(activity, event.missionId)) {
      return reject(state);
    }
    const current = attemptFor(state, event.missionId);
    if (current.processedActionIds.includes(event.actionId)) return reject(state);
    const progress = state.missions.find(
      ({ missionId }) => missionId === event.missionId,
    );
    const signature = (progress?.missingEvidenceIds ?? []).join("|");
    const repeatedBlockCount =
      signature.length > 0 && signature === current.lastMissingSignature
        ? current.repeatedBlockCount + 1
        : signature.length > 0
          ? 1
          : 0;
    return withAttempt(state, event.missionId, {
      ...current,
      count: current.count + 1,
      repeatedBlockCount,
      lastActionId: event.actionId,
      lastMissingSignature: signature,
      processedActionIds: [...current.processedActionIds, event.actionId],
    });
  }

  if (event.type === "explicit_help_requested") {
    if (!validEventId(event.requestId) || !missionExists(activity, event.missionId)) {
      return reject(state);
    }
    const current = attemptFor(state, event.missionId);
    if (current.processedHelpRequestIds.includes(event.requestId)) {
      return reject(state);
    }
    return withAttempt(state, event.missionId, {
      ...current,
      explicitHelpRequestCount: current.explicitHelpRequestCount + 1,
      processedHelpRequestIds: [
        ...current.processedHelpRequestIds,
        event.requestId,
      ],
    });
  }

  if (event.type === "assistance_delivered") {
    if (
      !missionExists(activity, event.missionId) ||
      !validEventId(event.directiveId) ||
      state.assistance.deliveredDirectiveIds.includes(event.directiveId)
    ) {
      return reject(state);
    }
    const current = attemptFor(state, event.missionId);
    return withAttempt(
      freezeState({
        ...state,
        assistance: {
          highestLevelUsed: Math.max(
            state.assistance.highestLevelUsed,
            event.level,
          ) as 0 | 1 | 2 | 3 | 4,
          deliveredDirectiveIds: [
            ...state.assistance.deliveredDirectiveIds,
            event.directiveId,
          ],
        },
      }),
      event.missionId,
      {
        ...current,
        deliveredLevels: unique([...current.deliveredLevels, event.level]),
        proactiveSignatures:
          event.source === "proactive" && event.blockSignature
            ? unique([...current.proactiveSignatures, event.blockSignature])
            : current.proactiveSignatures,
      },
    );
  }

  return reject(state);
}

export function evaluateGeometryMissionV1(
  activity: GeometryInvestigationV1,
  state: GeometrySessionStateV1,
  mission: GeometryMissionV1,
): MissionEvaluation {
  const world = state.world;
  const currentPassingFacts = new Set(
    (world?.facts ?? [])
      .filter(
        (fact) =>
          fact.pass &&
          fact.epoch === world?.epoch &&
          fact.revision === world?.revision &&
          fact.snapshotHash === world?.snapshotHash,
      )
      .map(({ id }) => id),
  );

  if (mission.kind === "construct") {
    if (mission.requiredEvidence.length > 0) {
      return fromRequiredFacts(mission, currentPassingFacts);
    }
    const cycle = constructionCycle(activity, world);
    return {
      satisfied: cycle.ok,
      verified: cycle.ok,
      evidenceIds: cycle.ok ? cycle.objectNames : [],
      missingEvidenceIds: cycle.ok ? [] : ["student_construction_cycle"],
    };
  }

  if (mission.kind === "capture") {
    const capture = state.captures.find(
      (candidate) =>
        candidate.missionId === mission.id &&
        candidate.actor === "learner" &&
        mission.requiredEvidence.every((id) => candidate.factIds.includes(id)),
    );
    return capture
      ? {
          satisfied: true,
          verified: true,
          evidenceIds: [capture.id, ...mission.requiredEvidence],
          missingEvidenceIds: [],
        }
      : {
          satisfied: false,
          verified: false,
          evidenceIds: [],
          missingEvidenceIds: [`learner_capture_${mission.id}`],
        };
  }

  if (mission.kind === "conjecture") {
    return localCompletion(
      state.reflections.conjectureCompleted,
      "local_conjecture",
    );
  }

  if (mission.kind === "verify") {
    const captureMissions = activity.missions.filter(
      (candidate) =>
        candidate.kind === "capture" && candidate.order < mission.order,
    );
    const evidenceIds: string[] = [];
    const missingEvidenceIds: string[] = [];
    for (const captureMission of captureMissions) {
      const capture = state.captures.find(
        (candidate) =>
          candidate.missionId === captureMission.id &&
          candidate.actor === "learner",
      );
      if (!capture) {
        missingEvidenceIds.push(`learner_capture_${captureMission.id}`);
        continue;
      }
      for (const factId of mission.requiredEvidence) {
        if (capture.factIds.includes(factId)) evidenceIds.push(factId);
        else missingEvidenceIds.push(`${capture.id}_${factId}`.slice(0, 80));
      }
      evidenceIds.push(capture.id);
    }
    return {
      satisfied:
        captureMissions.length > 0 && missingEvidenceIds.length === 0,
      verified: captureMissions.length > 0 && missingEvidenceIds.length === 0,
      evidenceIds: unique(evidenceIds),
      missingEvidenceIds: unique(missingEvidenceIds),
    };
  }

  if (mission.kind === "justify") {
    const facts = fromRequiredFacts(mission, currentPassingFacts);
    const requiredSteps = activity.demonstrationSteps
      .filter(({ missionId }) => missionId === mission.id)
      .map(({ id }) => id);
    const missingSteps = requiredSteps
      .filter(
        (id) =>
          !state.reflections.completedJustificationStepIds.includes(id),
      )
      .map((id) => `justification_step_${id}`);
    return {
      satisfied: facts.satisfied && requiredSteps.length > 0 && missingSteps.length === 0,
      verified: facts.satisfied && requiredSteps.length > 0 && missingSteps.length === 0,
      evidenceIds: [
        ...facts.evidenceIds,
        ...requiredSteps.filter((id) => !missingSteps.includes(`justification_step_${id}`)),
      ],
      missingEvidenceIds: [...facts.missingEvidenceIds, ...missingSteps],
    };
  }

  if (mission.kind === "transfer") {
    return localCompletion(state.reflections.transferCompleted, "local_transfer");
  }

  return {
    satisfied: false,
    verified: false,
    evidenceIds: [],
    missingEvidenceIds: [...mission.requiredEvidence],
  };
}

export function geometryExerciseXpV1(state: GeometrySessionStateV1): number {
  return Object.values(state.xpLedger).reduce<number>(
    (sum, credit) => sum + credit,
    0,
  );
}

function deriveMissionProgress(
  activity: GeometryInvestigationV1,
  input: GeometrySessionStateV1,
): GeometrySessionStateV1 {
  if (!input.world) return freezeState(input);
  const missions: GeometryMissionProgressV1[] = [];
  let priorSatisfied = true;
  let activeMissionId: string | undefined;
  for (const mission of activity.missions) {
    const evaluation = evaluateGeometryMissionV1(activity, input, mission);
    const previous = input.missions.find(
      ({ missionId }) => missionId === mission.id,
    );
    let status: GeometryMissionStatusV1;
    if (!priorSatisfied) status = "locked";
    else if (evaluation.satisfied) {
      status = evaluation.verified ? "verified" : "completed";
    } else {
      status = "active";
      activeMissionId = mission.id;
      priorSatisfied = false;
    }
    missions.push({
      missionId: mission.id,
      order: mission.order,
      status,
      evidenceIds: evaluation.evidenceIds,
      missingEvidenceIds: evaluation.missingEvidenceIds,
      ...((status === "verified" || status === "completed") &&
      previous?.completedAtRevision === undefined
        ? { completedAtRevision: input.revision }
        : previous?.completedAtRevision !== undefined
          ? { completedAtRevision: previous.completedAtRevision }
          : {}),
    });
  }
  const activeMission = activity.missions.find(
    ({ id }) => id === activeMissionId,
  );
  const xpLedger = { ...input.xpLedger };
  for (const mission of missions) {
    const earned =
      mission.status === "verified"
        ? 20
        : mission.status === "completed"
          ? 10
          : 0;
    xpLedger[mission.missionId] = Math.max(
      xpLedger[mission.missionId] ?? 0,
      earned,
    ) as 0 | 10 | 20;
  }
  return freezeState({
    ...input,
    missions,
    xpLedger,
    ...(activeMissionId ? { activeMissionId } : { activeMissionId: undefined }),
    phase: activeMission ? phaseForMission(activeMission) : "completed",
  });
}

function fromRequiredFacts(
  mission: GeometryMissionV1,
  passingFacts: ReadonlySet<string>,
): MissionEvaluation {
  const evidenceIds = mission.requiredEvidence.filter((id) => passingFacts.has(id));
  const missingEvidenceIds = mission.requiredEvidence.filter(
    (id) => !passingFacts.has(id),
  );
  return {
    satisfied: mission.requiredEvidence.length > 0 && missingEvidenceIds.length === 0,
    verified: mission.requiredEvidence.length > 0 && missingEvidenceIds.length === 0,
    evidenceIds,
    missingEvidenceIds,
  };
}

function localCompletion(completed: boolean, evidenceId: string): MissionEvaluation {
  return {
    satisfied: completed,
    verified: false,
    evidenceIds: completed ? [evidenceId] : [],
    missingEvidenceIds: completed ? [] : [evidenceId],
  };
}

function constructionCycle(
  activity: GeometryInvestigationV1,
  world: GeometryWorldV2 | undefined,
): Readonly<{ ok: boolean; objectNames: readonly string[] }> {
  if (!world) return { ok: false, objectNames: [] };
  const vertices = unique(
    activity.relationDefinitions
      .filter(({ relation }) => relation === "midpoint")
      .map(({ objects }) => objects[0])
      .filter(Boolean),
  );
  if (vertices.length < 3) return { ok: false, objectNames: [] };
  const studentObjects = world.objects.filter(({ owner }) => owner === "student");
  const polygon = studentObjects.find(
    (object) =>
      object.type.toLowerCase().includes("polygon") &&
      sameSet(object.parents, vertices),
  );
  if (polygon) return { ok: true, objectNames: [polygon.name] };
  const edges = vertices.map((from, index) => [
    from,
    vertices[(index + 1) % vertices.length],
  ] as const);
  const objects = edges.map(([from, to]) =>
    studentObjects.find(
      (object) =>
        isSegmentLike(object) && sameSet(object.parents, [from, to]),
    ),
  );
  return objects.every(Boolean)
    ? { ok: true, objectNames: objects.map((object) => object!.name) }
    : { ok: false, objectNames: [] };
}

function hasApprovedScaffold(
  activity: GeometryInvestigationV1,
  world: GeometryWorldV2,
): boolean {
  const byName = new Map(world.objects.map((object) => [object.name, object]));
  if (
    !activity.scaffold.freePoints.every(
      ({ label }) => byName.get(label)?.owner === "scaffold",
    )
  ) {
    return false;
  }
  return activity.scaffold.edges.every(({ from, to }) =>
    world.objects.some(
      (object) =>
        object.owner === "scaffold" &&
        isSegmentLike(object) &&
        sameSet(object.parents, [from, to]),
    ),
  );
}

function isSegmentLike(object: GeometryWorldObjectV2): boolean {
  const type = object.type.toLowerCase();
  return type.includes("segment") || type.includes("line") || type.includes("ray");
}

function phaseForMission(mission: GeometryMissionV1): GeometrySessionPhaseV1 {
  if (mission.kind === "construct") return "constructing";
  if (mission.kind === "capture" || mission.kind === "manipulate") return "exploring";
  if (mission.kind === "conjecture") return "conjecturing";
  if (mission.kind === "verify") return "verifying";
  if (mission.kind === "justify") return "justifying";
  if (mission.kind === "transfer") return "transferring";
  return "constructing";
}

function matchesAnchor(
  state: GeometrySessionStateV1,
  event: { activityId: string; epoch: number; revision: number },
): boolean {
  return (
    event.activityId === state.activityId &&
    event.epoch === state.epoch &&
    event.revision === state.revision
  );
}

function attemptFor(
  state: GeometrySessionStateV1,
  missionId: string,
): GeometryMissionAttemptV1 {
  return (
    state.attempts[missionId] ?? {
      missionId,
      count: 0,
      repeatedBlockCount: 0,
      explicitHelpRequestCount: 0,
      lastMissingSignature: "",
      processedActionIds: [],
      processedHelpRequestIds: [],
      deliveredLevels: [],
      proactiveSignatures: [],
    }
  );
}

function withAttempt(
  state: GeometrySessionStateV1,
  missionId: string,
  attempt: GeometryMissionAttemptV1,
): GeometrySessionStateV1 {
  return freezeState({
    ...state,
    attempts: { ...state.attempts, [missionId]: attempt },
  });
}

function missionExists(
  activity: GeometryInvestigationV1,
  missionId: string,
): boolean {
  return activity.missions.some(({ id }) => id === missionId);
}

function validEventId(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value);
}

function hasDuplicateIds(values: readonly { id: string }[]): boolean {
  return new Set(values.map(({ id }) => id)).size !== values.length;
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value) => expected.includes(value))
  );
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function reject(state: GeometrySessionStateV1): GeometrySessionStateV1 {
  return freezeState({ ...state, rejectionCount: state.rejectionCount + 1 });
}

function freezeState(state: GeometrySessionStateV1): GeometrySessionStateV1 {
  return Object.freeze({
    ...state,
    captures: Object.freeze([...state.captures]),
    missions: Object.freeze(
      state.missions.map((mission) =>
        Object.freeze({
          ...mission,
          evidenceIds: Object.freeze([...mission.evidenceIds]),
          missingEvidenceIds: Object.freeze([...mission.missingEvidenceIds]),
        }),
      ),
    ),
    reflections: Object.freeze({
      ...state.reflections,
      completedJustificationStepIds: Object.freeze([
        ...state.reflections.completedJustificationStepIds,
      ]),
    }),
    attempts: Object.freeze(
      Object.fromEntries(
        Object.entries(state.attempts).map(([missionId, attempt]) => [
          missionId,
          Object.freeze({
            ...attempt,
            processedActionIds: Object.freeze([...attempt.processedActionIds]),
            processedHelpRequestIds: Object.freeze([
              ...attempt.processedHelpRequestIds,
            ]),
            deliveredLevels: Object.freeze([...attempt.deliveredLevels]),
            proactiveSignatures: Object.freeze([
              ...attempt.proactiveSignatures,
            ]),
          }),
        ]),
      ),
    ),
    processedReflectionIds: Object.freeze([...state.processedReflectionIds]),
    demonstrationsViewed: Object.freeze([...state.demonstrationsViewed]),
    assistance: Object.freeze({
      ...state.assistance,
      deliveredDirectiveIds: Object.freeze([
        ...state.assistance.deliveredDirectiveIds,
      ]),
    }),
    xpLedger: Object.freeze({ ...state.xpLedger }),
  });
}

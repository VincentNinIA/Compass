import {
  GeometryLearningSessionReportV1,
  type GeometryInvestigationV1,
  type GeometryLearningSessionReportV1 as GeometryLearningSessionReportV1Type,
} from "./contracts";
import {
  geometryExerciseXpV1,
  type GeometrySessionStateV1,
} from "./session";

export function createGeometryLearningSessionReportV1(
  activity: GeometryInvestigationV1,
  state: GeometrySessionStateV1,
  updatedAt = Date.now(),
): GeometryLearningSessionReportV1Type {
  const currentFacts = (state.world?.facts ?? []).filter(
    (fact) =>
      fact.pass &&
      fact.epoch === state.world?.epoch &&
      fact.revision === state.world?.revision &&
      fact.snapshotHash === state.world?.snapshotHash,
  );
  const midpointIds = new Set(
    activity.relationDefinitions
      .filter(({ relation }) => relation === "midpoint")
      .map(({ id }) => id),
  );
  const parallelIds = new Set(
    activity.relationDefinitions
      .filter(({ relation }) => relation === "parallel")
      .map(({ id }) => id),
  );
  const learnerCaptures = state.captures.filter(
    ({ actor }) => actor === "learner",
  );
  const completedMissions = state.missions.filter(({ status }) =>
    ["completed", "verified"].includes(status),
  ).length;
  const verifiedMissions = state.missions.filter(
    ({ status }) => status === "verified",
  ).length;
  const justificationMission = activity.missions.find(
    ({ kind }) => kind === "justify",
  );

  return GeometryLearningSessionReportV1.parse({
    schemaVersion: "geometry_learning_session_report.v1",
    exerciseId: activity.id,
    totalMissions: activity.missions.length,
    completedMissions,
    verifiedMissions,
    capturedConfigurations: [
      ...new Set(learnerCaptures.map(({ configuration }) => configuration)),
    ],
    exactMidpoints: currentFacts.filter(({ id }) => midpointIds.has(id)).length,
    verifiedParallelPairs: learnerCaptures.reduce(
      (count, capture) =>
        count + capture.factIds.filter((id) => parallelIds.has(id)).length,
      0,
    ),
    conjectureCompleted: state.reflections.conjectureCompleted,
    justificationCompleted: Boolean(
      justificationMission &&
        state.missions.find(
          ({ missionId }) => missionId === justificationMission.id,
        )?.status === "verified",
    ),
    transferCompleted: state.reflections.transferCompleted,
    assistance: {
      highestLevelUsed: state.assistance.highestLevelUsed,
      demonstrationsViewed: state.demonstrationsViewed.length,
    },
    exerciseXp: geometryExerciseXpV1(state),
    updatedAt,
  });
}

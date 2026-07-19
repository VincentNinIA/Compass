import { z } from "zod";

import { GeneralExerciseReadyV1 } from "@/lib/exercise/general-exercise-contracts";

export const GEOMETRY_INVESTIGATION_SCHEMA_VERSION =
  "geometry_investigation.v1" as const;
export const GEOMETRY_WORLD_SCHEMA_VERSION = "geometry_world.v2" as const;
export const GEOMETRY_WORLD_DELTA_SCHEMA_VERSION =
  "geometry_world_delta.v2" as const;
export const GEOMETRY_EVIDENCE_CAPTURE_SCHEMA_VERSION =
  "geometry_evidence_capture.v1" as const;
export const GEOMETRY_LEARNING_REPORT_SCHEMA_VERSION =
  "geometry_learning_session_report.v1" as const;

export const GEOMETRY_RELATIONS_V1 = [
  "midpoint",
  "parallel",
  "perpendicular",
  "equal_length",
  "point_on",
  "non_collinear",
  "parallelogram",
  "configuration_type",
] as const;

export const GEOMETRY_CONFIGURATION_TYPES_V1 = [
  "convex",
  "concave",
  "crossed",
  "degenerate",
] as const;

export const GEOMETRY_ACTIONS_V1 = [
  "inspect_geometry_workspace",
  "activate_geometry_tool",
  "highlight_geometry_objects",
  "preview_geometry_variation",
  "initialize_geometry_activity",
  "create_geometry_variation",
  "classify_geometry_configuration",
  "check_geometry_relation",
  "capture_geometry_evidence",
  "restore_geometry_checkpoint",
  "demonstrate_geometry_step",
  "focus_geometry_view",
] as const;

const Identifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const ObjectName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/);
const ShortText = z.string().trim().min(1).max(240);
const InstructionText = z.string().trim().min(1).max(1_200);
const GuidanceText = z.string().trim().max(2_400);
const FiniteCoordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const SnapshotHash = z.string().min(1).max(128);
const ToleranceVersion = z.string().trim().min(1).max(80);

export const GeometryAssistancePolicyV1 = z.strictObject({
  mode: z.enum(["light", "standard", "reinforced"]),
  maxProactiveLevel: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  allowToolActivation: z.boolean(),
  allowTemporaryHighlight: z.boolean(),
  allowAssistantVariationAfterConsent: z.boolean(),
  allowDemonstrationAfterConsent: z.boolean(),
});

export const GeometryScaffoldPointV1 = z.strictObject({
  label: z.enum(["A", "B", "C", "D"]),
  x: FiniteCoordinate,
  y: FiniteCoordinate,
});

export const GeometryScaffoldEdgeV1 = z.strictObject({
  from: z.enum(["A", "B", "C", "D"]),
  to: z.enum(["A", "B", "C", "D"]),
});

export const GeometryScaffoldV1 = z.strictObject({
  version: z.literal("varignon-scaffold.v1"),
  freePoints: z.array(GeometryScaffoldPointV1).length(4),
  edges: z.array(GeometryScaffoldEdgeV1).length(4),
});

export const GeometryMissionV1 = z.strictObject({
  id: Identifier,
  order: z.number().int().min(1).max(32),
  kind: z.enum([
    "construct",
    "manipulate",
    "capture",
    "conjecture",
    "verify",
    "justify",
    "transfer",
  ]),
  title: ShortText,
  instruction: InstructionText,
  requiredEvidence: z.array(Identifier).max(16),
  allowedActions: z.array(z.enum(GEOMETRY_ACTIONS_V1)).max(12),
  completion: z.enum(["deterministic", "learner_reflection", "hybrid"]),
});

export type GeometryMissionV1 = z.infer<typeof GeometryMissionV1>;

export const GeometryRelationDefinitionV1 = z.strictObject({
  id: Identifier,
  relation: z.enum(GEOMETRY_RELATIONS_V1),
  objects: z.array(ObjectName).min(1).max(8),
  expected: z.union([
    z.boolean(),
    z.literal("convex"),
    z.literal("concave"),
    z.literal("crossed"),
  ]),
  toleranceVersion: ToleranceVersion,
});

export type GeometryRelationDefinitionV1 = z.infer<
  typeof GeometryRelationDefinitionV1
>;

export const GeometryHintV1 = z.strictObject({
  id: Identifier,
  missionId: Identifier,
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  prompt: InstructionText,
  action: z
    .enum(["activate_tool", "highlight_objects", "demonstrate_step"])
    .optional(),
  objectNames: z.array(ObjectName).max(8),
});

export type GeometryHintV1 = z.infer<typeof GeometryHintV1>;

export const GeometryDemonstrationStepV1 = z.strictObject({
  id: Identifier,
  missionId: Identifier,
  order: z.number().int().min(1).max(32),
  narration: InstructionText,
  operation: z.enum([
    "highlight",
    "create_temporary_object",
    "move_temporary_point",
    "restore",
  ]),
  objectNames: z.array(ObjectName).max(8),
});

export type GeometryDemonstrationStepV1 = z.infer<
  typeof GeometryDemonstrationStepV1
>;

const GeometryInvestigationShapeV1 = z.strictObject({
  schemaVersion: z.literal(GEOMETRY_INVESTIGATION_SCHEMA_VERSION),
  id: Identifier,
  locale: z.enum(["fr", "en"]),
  title: ShortText,
  level: ShortText,
  topic: z.literal("geometry"),
  template: z.literal("varignon.v1"),
  objective: InstructionText,
  targetedDifficulties: z.array(ShortText).max(8),
  teacherGuidance: GuidanceText,
  assistancePolicy: GeometryAssistancePolicyV1,
  scaffold: GeometryScaffoldV1,
  missions: z.array(GeometryMissionV1).length(9),
  relationDefinitions: z.array(GeometryRelationDefinitionV1).min(1).max(32),
  hintLadder: z.array(GeometryHintV1).max(32),
  demonstrationSteps: z.array(GeometryDemonstrationStepV1).max(32),
  conjecturePrompt: InstructionText,
  proofPrompts: z.array(InstructionText).min(1).max(12),
  transferPrompt: InstructionText,
});

const VARIGNON_MISSION_KINDS = [
  "construct",
  "construct",
  "capture",
  "capture",
  "capture",
  "conjecture",
  "verify",
  "justify",
  "transfer",
] as const;

export const GeometryInvestigationV1 = GeometryInvestigationShapeV1.superRefine(
  (activity, context) => {
    const missionIds = activity.missions.map(({ id }) => id);
    const relationIds = activity.relationDefinitions.map(({ id }) => id);
    const hintIds = activity.hintLadder.map(({ id }) => id);
    const demonstrationIds = activity.demonstrationSteps.map(({ id }) => id);

    addUniqueIssue(context, missionIds, ["missions"], "duplicate_mission_id");
    addUniqueIssue(
      context,
      relationIds,
      ["relationDefinitions"],
      "duplicate_relation_id",
    );
    addUniqueIssue(context, hintIds, ["hintLadder"], "duplicate_hint_id");
    addUniqueIssue(
      context,
      demonstrationIds,
      ["demonstrationSteps"],
      "duplicate_demonstration_id",
    );

    const pointLabels = activity.scaffold.freePoints.map(({ label }) => label);
    addUniqueIssue(
      context,
      pointLabels,
      ["scaffold", "freePoints"],
      "duplicate_scaffold_label",
    );
    if ([...pointLabels].sort().join("") !== "ABCD") {
      addIssue(context, ["scaffold", "freePoints"], "scaffold_must_define_abcd");
    }

    const canonicalEdges = activity.scaffold.edges.map(
      ({ from, to }) => `${from}${to}`,
    );
    addUniqueIssue(
      context,
      canonicalEdges,
      ["scaffold", "edges"],
      "duplicate_scaffold_edge",
    );
    if (
      canonicalEdges.some((edge) => edge[0] === edge[1]) ||
      [...canonicalEdges].sort().join(",") !== "AB,BC,CD,DA"
    ) {
      addIssue(context, ["scaffold", "edges"], "scaffold_must_define_ab_bc_cd_da");
    }

    activity.missions.forEach((mission, index) => {
      if (mission.order !== index + 1) {
        addIssue(context, ["missions", index, "order"], "mission_order_invalid");
      }
      if (mission.id !== `V${index + 1}`) {
        addIssue(context, ["missions", index, "id"], "varignon_mission_id_invalid");
      }
      if (mission.kind !== VARIGNON_MISSION_KINDS[index]) {
        addIssue(context, ["missions", index, "kind"], "varignon_mission_kind_invalid");
      }
      addUniqueIssue(
        context,
        mission.requiredEvidence,
        ["missions", index, "requiredEvidence"],
        "duplicate_required_evidence",
      );
      addUniqueIssue(
        context,
        mission.allowedActions,
        ["missions", index, "allowedActions"],
        "duplicate_allowed_action",
      );
      for (const evidenceId of mission.requiredEvidence) {
        if (!relationIds.includes(evidenceId)) {
          addIssue(
            context,
            ["missions", index, "requiredEvidence"],
            "undeclared_relation",
          );
        }
      }
    });

    activity.relationDefinitions.forEach((definition, index) => {
      addUniqueIssue(
        context,
        definition.objects,
        ["relationDefinitions", index, "objects"],
        "duplicate_relation_object",
      );
      if (
        definition.relation === "configuration_type" &&
        typeof definition.expected === "boolean"
      ) {
        addIssue(
          context,
          ["relationDefinitions", index, "expected"],
          "configuration_expected_invalid",
        );
      }
      if (
        definition.relation !== "configuration_type" &&
        typeof definition.expected !== "boolean"
      ) {
        addIssue(
          context,
          ["relationDefinitions", index, "expected"],
          "boolean_expected_required",
        );
      }
    });

    const missionIdSet = new Set(missionIds);
    for (const [index, hint] of activity.hintLadder.entries()) {
      if (!missionIdSet.has(hint.missionId)) {
        addIssue(context, ["hintLadder", index, "missionId"], "unknown_mission_id");
      }
    }
    activity.demonstrationSteps.forEach((step, index) => {
      if (!missionIdSet.has(step.missionId)) {
        addIssue(
          context,
          ["demonstrationSteps", index, "missionId"],
          "unknown_mission_id",
        );
      }
      if (step.order !== index + 1) {
        addIssue(
          context,
          ["demonstrationSteps", index, "order"],
          "demonstration_order_invalid",
        );
      }
    });

    const maxLevelByMode = { light: 1, standard: 2, reinforced: 3 } as const;
    if (
      activity.assistancePolicy.maxProactiveLevel >
      maxLevelByMode[activity.assistancePolicy.mode]
    ) {
      addIssue(
        context,
        ["assistancePolicy", "maxProactiveLevel"],
        "assistance_policy_incoherent",
      );
    }
  },
);

export type GeometryInvestigationV1 = z.infer<typeof GeometryInvestigationV1>;

export const GeometryFactV1 = z.strictObject({
  id: Identifier,
  relation: z.enum(GEOMETRY_RELATIONS_V1),
  objects: z.array(ObjectName).min(1).max(8),
  pass: z.boolean(),
  observed: z.array(z.number().finite()).max(16),
  tolerance: z.number().finite().nonnegative(),
  toleranceVersion: ToleranceVersion,
  epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  snapshotHash: SnapshotHash,
});

export type GeometryFactV1 = z.infer<typeof GeometryFactV1>;

export const GeometryConfigurationV1 = z.strictObject({
  type: z.enum(GEOMETRY_CONFIGURATION_TYPES_V1),
  orientation: z.enum(["clockwise", "counterclockwise", "none"]),
  intersections: z.array(z.enum(["AB_CD", "BC_DA"])).max(2),
  toleranceVersion: ToleranceVersion,
  epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  snapshotHash: SnapshotHash,
});

export type GeometryConfigurationV1 = z.infer<typeof GeometryConfigurationV1>;

export const GeometryWorldObjectV2 = z.strictObject({
  name: ObjectName,
  type: z.string().trim().min(1).max(80),
  command: z.string().trim().max(240),
  parents: z.array(ObjectName).max(16),
  dependencyStatus: z.enum(["known", "unknown"]),
  owner: z.enum(["scaffold", "student", "assistant", "hint", "temporary"]),
  x: FiniteCoordinate.optional(),
  y: FiniteCoordinate.optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  visible: z.boolean(),
});

export type GeometryWorldObjectV2 = z.infer<typeof GeometryWorldObjectV2>;

export const GeometryWorldChangeV2 = z.strictObject({
  kind: z.enum([
    "initial",
    "add",
    "remove",
    "update",
    "drag_end",
    "moved_geos",
    "set_mode",
    "select",
    "deselect",
    "undo",
    "redo",
    "focus_view",
  ]),
  objectNames: z.array(ObjectName).max(40),
  terminal: z.boolean(),
  actor: z.enum(["learner", "assistant", "system"]),
  occurredAt: z.number().int().nonnegative(),
});

export type GeometryWorldChangeV2 = z.infer<typeof GeometryWorldChangeV2>;

const GeometryWorldShapeV2 = z.strictObject({
  schemaVersion: z.literal(GEOMETRY_WORLD_SCHEMA_VERSION),
  activityId: Identifier,
  epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  snapshotHash: SnapshotHash,
  objectCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  objects: z.array(GeometryWorldObjectV2).max(40),
  facts: z.array(GeometryFactV1).max(128),
  configuration: GeometryConfigurationV1.optional(),
  change: GeometryWorldChangeV2,
});

export const GeometryWorldV2 = GeometryWorldShapeV2.superRefine(
  (world, context) => {
    addUniqueIssue(
      context,
      world.objects.map(({ name }) => name),
      ["objects"],
      "duplicate_world_object",
    );
    addUniqueIssue(
      context,
      world.facts.map(({ id }) => id),
      ["facts"],
      "duplicate_fact_id",
    );
    if (
      (!world.truncated && world.objectCount !== world.objects.length) ||
      (world.truncated && world.objectCount <= world.objects.length)
    ) {
      addIssue(context, ["objectCount"], "world_object_count_invalid");
    }
    for (const [index, fact] of world.facts.entries()) {
      if (
        fact.epoch !== world.epoch ||
        fact.revision !== world.revision ||
        fact.snapshotHash !== world.snapshotHash
      ) {
        addIssue(context, ["facts", index], "stale_world_fact");
      }
    }
    if (
      world.configuration &&
      (world.configuration.epoch !== world.epoch ||
        world.configuration.revision !== world.revision ||
        world.configuration.snapshotHash !== world.snapshotHash)
    ) {
      addIssue(context, ["configuration"], "stale_world_configuration");
    }
  },
);

export type GeometryWorldV2 = z.infer<typeof GeometryWorldV2>;

export const GeometryWorldDeltaV2 = z.strictObject({
  schemaVersion: z.literal(GEOMETRY_WORLD_DELTA_SCHEMA_VERSION),
  activityId: Identifier,
  epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  previousRevision: z.number().int().nonnegative().nullable(),
  snapshotHash: SnapshotHash,
  added: z.array(GeometryWorldObjectV2).max(40),
  removed: z.array(ObjectName).max(40),
  changed: z.array(GeometryWorldObjectV2).max(40),
  objectCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  change: GeometryWorldChangeV2,
});

export type GeometryWorldDeltaV2 = z.infer<typeof GeometryWorldDeltaV2>;

export const GeometryEvidenceCaptureV1 = z.strictObject({
  schemaVersion: z.literal(GEOMETRY_EVIDENCE_CAPTURE_SCHEMA_VERSION),
  id: Identifier,
  activityId: Identifier,
  missionId: Identifier,
  configuration: z.enum(["convex", "concave", "crossed"]),
  epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  snapshotHash: SnapshotHash,
  checkpointId: Identifier,
  objectNames: z.array(ObjectName).min(1).max(40),
  factIds: z.array(Identifier).min(1).max(32),
  createdAt: z.number().int().nonnegative(),
  actor: z.enum(["learner", "assistant_demo"]),
});

export type GeometryEvidenceCaptureV1 = z.infer<
  typeof GeometryEvidenceCaptureV1
>;

const GeometryLearningSessionReportShapeV1 = z.strictObject({
  schemaVersion: z.literal(GEOMETRY_LEARNING_REPORT_SCHEMA_VERSION),
  exerciseId: Identifier,
  totalMissions: z.number().int().min(1).max(32),
  completedMissions: z.number().int().nonnegative().max(32),
  verifiedMissions: z.number().int().nonnegative().max(32),
  capturedConfigurations: z.array(z.enum(["convex", "concave", "crossed"])).max(3),
  exactMidpoints: z.number().int().nonnegative().max(4),
  verifiedParallelPairs: z.number().int().nonnegative().max(6),
  conjectureCompleted: z.boolean(),
  justificationCompleted: z.boolean(),
  transferCompleted: z.boolean(),
  assistance: z.strictObject({
    highestLevelUsed: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
    ]),
    demonstrationsViewed: z.number().int().nonnegative().max(32),
  }),
  exerciseXp: z.number().int().nonnegative().max(10_000),
  updatedAt: z.number().int().nonnegative(),
});

export const GeometryLearningSessionReportV1 =
  GeometryLearningSessionReportShapeV1.superRefine((report, context) => {
    if (report.completedMissions > report.totalMissions) {
      addIssue(context, ["completedMissions"], "completed_missions_invalid");
    }
    if (report.verifiedMissions > report.completedMissions) {
      addIssue(context, ["verifiedMissions"], "verified_missions_invalid");
    }
    addUniqueIssue(
      context,
      report.capturedConfigurations,
      ["capturedConfigurations"],
      "duplicate_configuration",
    );
  });

export type GeometryLearningSessionReportV1 = z.infer<
  typeof GeometryLearningSessionReportV1
>;

export const TeacherExerciseV2 = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("general_exercise"),
    exercise: GeneralExerciseReadyV1,
  }),
  z.strictObject({
    kind: z.literal("geometry_investigation"),
    exercise: GeometryInvestigationV1,
  }),
]);

export type TeacherExerciseV2 = z.infer<typeof TeacherExerciseV2>;

export function parseGeometryInvestigationV1(
  input: unknown,
): GeometryInvestigationV1 {
  return GeometryInvestigationV1.parse(input);
}

export function parseTeacherExerciseV2(input: unknown): TeacherExerciseV2 {
  return TeacherExerciseV2.parse(input);
}

function addUniqueIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[],
  message: string,
) {
  if (new Set(values).size !== values.length) addIssue(context, path, message);
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
) {
  context.addIssue({ code: "custom", path, message });
}

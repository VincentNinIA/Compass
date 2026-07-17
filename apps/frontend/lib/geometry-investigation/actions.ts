import { z } from "zod";

export const GEOMETRY_INVESTIGATION_C04_MODEL_ACTIONS_V1 = [
  "inspect_geometry_workspace",
  "activate_geometry_tool",
  "highlight_geometry_objects",
  "create_geometry_variation",
  "classify_geometry_configuration",
  "check_geometry_relation",
  "focus_geometry_view",
] as const;

export const GEOMETRY_INVESTIGATION_C05_MODEL_ACTIONS_V1 = [
  "capture_geometry_evidence",
  "restore_geometry_checkpoint",
  "demonstrate_geometry_step",
] as const;

export const GEOMETRY_INVESTIGATION_MODEL_ACTIONS_V1 = [
  ...GEOMETRY_INVESTIGATION_C04_MODEL_ACTIONS_V1,
  ...GEOMETRY_INVESTIGATION_C05_MODEL_ACTIONS_V1,
] as const;

export const GEOMETRY_INVESTIGATION_INTERNAL_ACTIONS_V1 = [
  "initialize_geometry_activity",
] as const;

export const GEOMETRY_INVESTIGATION_ACTIONS_C04 = [
  ...GEOMETRY_INVESTIGATION_C04_MODEL_ACTIONS_V1,
  ...GEOMETRY_INVESTIGATION_INTERNAL_ACTIONS_V1,
] as const;

export const GEOMETRY_INVESTIGATION_ACTIONS_V1 = [
  ...GEOMETRY_INVESTIGATION_MODEL_ACTIONS_V1,
  ...GEOMETRY_INVESTIGATION_INTERNAL_ACTIONS_V1,
] as const;

export type GeometryInvestigationActionC04 =
  (typeof GEOMETRY_INVESTIGATION_ACTIONS_C04)[number];
export type GeometryInvestigationActionV1 =
  (typeof GEOMETRY_INVESTIGATION_ACTIONS_V1)[number];
export type GeometryInvestigationModelActionV1 =
  (typeof GEOMETRY_INVESTIGATION_MODEL_ACTIONS_V1)[number];

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
const Epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Names = z.array(ObjectName).max(40);
const OneToFourNames = z.array(ObjectName).min(1).max(4).refine(unique);
const OrderedLabels = z.array(ObjectName).length(4).refine(unique);

const Common = {
  activityId: Identifier,
  epoch: Epoch,
  revision: Revision,
} as const;

export const InspectGeometryWorkspaceArgumentsV1 = z.strictObject({
  ...Common,
  scope: z.enum(["all", "selection", "mission"]),
  names: Names.refine(unique),
});

export const ActivateGeometryToolArgumentsV1 = z.strictObject({
  ...Common,
  tool: z.enum([
    "move",
    "point",
    "midpoint",
    "segment",
    "line",
    "ray",
    "polygon",
    "parallel",
    "perpendicular",
    "relation",
  ]),
});

export const HighlightGeometryObjectsArgumentsV1 = z.strictObject({
  ...Common,
  names: OneToFourNames,
  style: z.enum(["focus", "hint", "relation"]),
  durationMs: z.number().int().min(1_000).max(8_000),
});

export const InitializeGeometryActivityArgumentsV1 = z.strictObject({
  ...Common,
  scaffoldVersion: z.literal("varignon-scaffold.v1"),
});

export const CreateGeometryVariationArgumentsV1 = z.strictObject({
  ...Common,
  target: z.enum(["convex", "concave", "crossed"]),
  movingPoint: z.enum(["A", "B", "C", "D"]),
  consentToken: z
    .string()
    .min(16)
    .max(160)
    .regex(/^[A-Za-z0-9_.:-]+$/),
});

export const ClassifyGeometryConfigurationArgumentsV1 = z.strictObject({
  ...Common,
  labels: OrderedLabels,
});

export const CheckGeometryRelationArgumentsV1 = z.strictObject({
  ...Common,
  relationId: Identifier,
});

export const CaptureGeometryEvidenceArgumentsV1 = z.strictObject({
  ...Common,
  missionId: Identifier,
  configuration: z.enum(["convex", "concave", "crossed"]),
  requiredFactIds: z.array(Identifier).min(1).max(16).refine(unique),
});

const PrivilegedToken = z
  .string()
  .min(16)
  .max(160)
  .regex(/^[A-Za-z0-9_.:-]+$/);

export const RestoreGeometryCheckpointArgumentsV1 = z.strictObject({
  ...Common,
  checkpointId: Identifier,
  confirmationId: PrivilegedToken,
});

export const DemonstrateGeometryStepArgumentsV1 = z.strictObject({
  ...Common,
  stepId: Identifier,
  consentToken: PrivilegedToken,
  speed: z.enum(["reduced", "normal"]),
});

const FocusTargetV1 = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("objects"),
    names: OneToFourNames,
  }),
  z
    .strictObject({
      kind: z.literal("box"),
      xMin: z.number().finite().min(-1_000_000).max(1_000_000),
      xMax: z.number().finite().min(-1_000_000).max(1_000_000),
      yMin: z.number().finite().min(-1_000_000).max(1_000_000),
      yMax: z.number().finite().min(-1_000_000).max(1_000_000),
    })
    .refine((box) => box.xMin < box.xMax && box.yMin < box.yMax),
]);

export const FocusGeometryViewArgumentsV1 = z.strictObject({
  ...Common,
  target: FocusTargetV1,
  margin: z.number().finite().min(0.05).max(1),
});

export const GEOMETRY_ACTION_SCHEMAS_C04 = {
  inspect_geometry_workspace: InspectGeometryWorkspaceArgumentsV1,
  activate_geometry_tool: ActivateGeometryToolArgumentsV1,
  highlight_geometry_objects: HighlightGeometryObjectsArgumentsV1,
  initialize_geometry_activity: InitializeGeometryActivityArgumentsV1,
  create_geometry_variation: CreateGeometryVariationArgumentsV1,
  classify_geometry_configuration: ClassifyGeometryConfigurationArgumentsV1,
  check_geometry_relation: CheckGeometryRelationArgumentsV1,
  focus_geometry_view: FocusGeometryViewArgumentsV1,
} as const;

export const GEOMETRY_ACTION_SCHEMAS_V1 = {
  ...GEOMETRY_ACTION_SCHEMAS_C04,
  capture_geometry_evidence: CaptureGeometryEvidenceArgumentsV1,
  restore_geometry_checkpoint: RestoreGeometryCheckpointArgumentsV1,
  demonstrate_geometry_step: DemonstrateGeometryStepArgumentsV1,
} as const;

export type GeometryActionArgumentsC04 = {
  [Name in GeometryInvestigationActionC04]: z.infer<
    (typeof GEOMETRY_ACTION_SCHEMAS_C04)[Name]
  >;
};

export type GeometryActionArgumentsValueC04 =
  GeometryActionArgumentsC04[GeometryInvestigationActionC04];

export type GeometryActionArgumentsV1 = {
  [Name in GeometryInvestigationActionV1]: z.infer<
    (typeof GEOMETRY_ACTION_SCHEMAS_V1)[Name]
  >;
};

export type GeometryActionArgumentsValueV1 =
  GeometryActionArgumentsV1[GeometryInvestigationActionV1];

type JsonSchema = Readonly<{
  type: "object";
  properties: Readonly<Record<string, unknown>>;
  required: readonly string[];
  additionalProperties: false;
}>;

const commonJsonSchema = {
  activityId: {
    type: "string",
    minLength: 1,
    maxLength: 80,
    pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
  },
  epoch: { type: "integer", minimum: 0 },
  revision: { type: "integer", minimum: 0 },
} as const;

const objectNameJsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: "^[A-Za-z][A-Za-z0-9_]*$",
} as const;

const oneToFourNamesJsonSchema = {
  type: "array",
  minItems: 1,
  maxItems: 4,
  uniqueItems: true,
  items: objectNameJsonSchema,
} as const;

function parameters(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): JsonSchema {
  return {
    type: "object",
    properties: { ...commonJsonSchema, ...properties },
    required: ["activityId", "epoch", "revision", ...required],
    additionalProperties: false,
  };
}

function functionTool(
  name: GeometryInvestigationModelActionV1,
  description: string,
  schema: JsonSchema,
) {
  return {
    type: "function" as const,
    name,
    description,
    parameters: schema,
  };
}

export const GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS = [
  functionTool(
    "inspect_geometry_workspace",
    "Read a bounded current geometry workspace without changing it.",
    parameters(
      {
        scope: { type: "string", enum: ["all", "selection", "mission"] },
        names: {
          type: "array",
          minItems: 0,
          maxItems: 40,
          uniqueItems: true,
          items: objectNameJsonSchema,
        },
      },
      ["scope", "names"],
    ),
  ),
  functionTool(
    "activate_geometry_tool",
    "Activate one approved GeoGebra toolbar tool without creating an object.",
    parameters(
      {
        tool: {
          type: "string",
          enum: [
            "move",
            "point",
            "midpoint",
            "segment",
            "line",
            "ray",
            "polygon",
            "parallel",
            "perpendicular",
            "relation",
          ],
        },
      },
      ["tool"],
    ),
  ),
  functionTool(
    "highlight_geometry_objects",
    "Temporarily and reversibly highlight one to four existing objects.",
    parameters(
      {
        names: oneToFourNamesJsonSchema,
        style: { type: "string", enum: ["focus", "hint", "relation"] },
        durationMs: { type: "integer", minimum: 1_000, maximum: 8_000 },
      },
      ["names", "style", "durationMs"],
    ),
  ),
  functionTool(
    "create_geometry_variation",
    "With a current one-shot consent token, move one free scaffold point to a deterministic target configuration. Coordinates are application-owned.",
    parameters(
      {
        target: { type: "string", enum: ["convex", "concave", "crossed"] },
        movingPoint: { type: "string", enum: ["A", "B", "C", "D"] },
        consentToken: {
          type: "string",
          minLength: 16,
          maxLength: 160,
          pattern: "^[A-Za-z0-9_.:-]+$",
        },
      },
      ["target", "movingPoint", "consentToken"],
    ),
  ),
  functionTool(
    "classify_geometry_configuration",
    "Deterministically classify four ordered existing points.",
    parameters(
      {
        labels: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          uniqueItems: true,
          items: objectNameJsonSchema,
        },
      },
      ["labels"],
    ),
  ),
  functionTool(
    "check_geometry_relation",
    "Evaluate one relation already declared by the current activity.",
    parameters(
      {
        relationId: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
        },
      },
      ["relationId"],
    ),
  ),
  functionTool(
    "focus_geometry_view",
    "Reversibly focus the view on existing objects or on a bounded logical box.",
    parameters(
      {
        target: {
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["objects"] },
                names: oneToFourNamesJsonSchema,
              },
              required: ["kind", "names"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["box"] },
                xMin: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
                xMax: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
                yMin: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
                yMax: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
              },
              required: ["kind", "xMin", "xMax", "yMin", "yMax"],
              additionalProperties: false,
            },
          ],
        },
        margin: { type: "number", minimum: 0.05, maximum: 1 },
      },
      ["target", "margin"],
    ),
  ),
  functionTool(
    "capture_geometry_evidence",
    "Atomically capture current experimental evidence after a learner action; no Base64 is returned.",
    parameters(
      {
        missionId: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
        },
        configuration: {
          type: "string",
          enum: ["convex", "concave", "crossed"],
        },
        requiredFactIds: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          uniqueItems: true,
          items: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
          },
        },
      },
      ["missionId", "configuration", "requiredFactIds"],
    ),
  ),
  functionTool(
    "restore_geometry_checkpoint",
    "Restore one same-activity checkpoint after a current visible confirmation.",
    parameters(
      {
        checkpointId: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
        },
        confirmationId: {
          type: "string",
          minLength: 16,
          maxLength: 160,
          pattern: "^[A-Za-z0-9_.:-]+$",
        },
      },
      ["checkpointId", "confirmationId"],
    ),
  ),
  functionTool(
    "demonstrate_geometry_step",
    "Play one activity-approved demonstration step after prior attempt and explicit consent.",
    parameters(
      {
        stepId: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
        },
        consentToken: {
          type: "string",
          minLength: 16,
          maxLength: 160,
          pattern: "^[A-Za-z0-9_.:-]+$",
        },
        speed: { type: "string", enum: ["reduced", "normal"] },
      },
      ["stepId", "consentToken", "speed"],
    ),
  ),
] as const;

export function isGeometryInvestigationActionC04(
  value: string,
): value is GeometryInvestigationActionC04 {
  return (GEOMETRY_INVESTIGATION_ACTIONS_C04 as readonly string[]).includes(value);
}

export function isGeometryInvestigationActionV1(
  value: string,
): value is GeometryInvestigationActionV1 {
  return (GEOMETRY_INVESTIGATION_ACTIONS_V1 as readonly string[]).includes(value);
}

export function isGeometryInvestigationModelActionV1(
  value: string,
): value is GeometryInvestigationModelActionV1 {
  return (GEOMETRY_INVESTIGATION_MODEL_ACTIONS_V1 as readonly string[]).includes(
    value,
  );
}

export function parseGeometryActionArgumentsC04<
  Name extends GeometryInvestigationActionC04,
>(
  name: Name,
  source: string,
  maxBytes = 8 * 1024,
):
  | { ok: true; value: GeometryActionArgumentsC04[Name] }
  | { ok: false; message: string } {
  if (new TextEncoder().encode(source).byteLength > maxBytes) {
    return { ok: false, message: "Action arguments are too large." };
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, message: "Action arguments are not valid JSON." };
  }
  const parsed = GEOMETRY_ACTION_SCHEMAS_C04[name].safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data as GeometryActionArgumentsC04[Name] }
    : { ok: false, message: "Action arguments do not match the strict schema." };
}

export function parseGeometryActionArgumentsV1<
  Name extends GeometryInvestigationActionV1,
>(
  name: Name,
  source: string,
  maxBytes = 8 * 1024,
):
  | { ok: true; value: GeometryActionArgumentsV1[Name] }
  | { ok: false; message: string } {
  if (new TextEncoder().encode(source).byteLength > maxBytes) {
    return { ok: false, message: "Action arguments are too large." };
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, message: "Action arguments are not valid JSON." };
  }
  const parsed = GEOMETRY_ACTION_SCHEMAS_V1[name].safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data as GeometryActionArgumentsV1[Name] }
    : { ok: false, message: "Action arguments do not match the strict schema." };
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

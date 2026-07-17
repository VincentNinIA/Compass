export const TOOL_NAMES = [
  "read_construction",
  "initialize_exercise",
  "check_relation",
  "highlight_objects",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type RelationName = "perpendicular" | "passes_midpoint";
export type HighlightStyle = "focus" | "hint";

export type ToolArguments = {
  read_construction: { revision: number };
  initialize_exercise: { planId: string; expectedRevision: number };
  check_relation: { relation: RelationName; objects: string[]; revision: number };
  highlight_objects: {
    names: string[];
    style: HighlightStyle;
    ttlMs: number;
    revision: number;
  };
};

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

function tool(name: ToolName, description: string, parameters: JsonSchema) {
  return { type: "function" as const, name, description, parameters };
}

const revision = { type: "integer", minimum: 0 } as const;
const names = {
  type: "array",
  minItems: 1,
  maxItems: 4,
  uniqueItems: true,
  items: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,31}$" },
} as const;

const relationObjects = {
  ...names,
  minItems: 2,
  maxItems: 3,
} as const;

export const REALTIME_TOOL_DEFINITIONS = [
  tool("read_construction", "Read the canonical construction at an exact revision.", {
    type: "object",
    properties: { revision },
    required: ["revision"],
    additionalProperties: false,
  }),
  tool("initialize_exercise", "Initialize only a previously confirmed exercise plan.", {
    type: "object",
    properties: {
      planId: { type: "string", minLength: 1, maxLength: 64 },
      expectedRevision: revision,
    },
    required: ["planId", "expectedRevision"],
    additionalProperties: false,
  }),
  tool("check_relation", "Check one deterministic geometric relation.", {
    type: "object",
    properties: {
      relation: { type: "string", enum: ["perpendicular", "passes_midpoint"] },
      objects: relationObjects,
      revision,
    },
    required: ["relation", "objects", "revision"],
    additionalProperties: false,
  }),
  tool("highlight_objects", "Temporarily highlight existing objects without moving them.", {
    type: "object",
    properties: {
      names,
      style: { type: "string", enum: ["focus", "hint"] },
      ttlMs: { type: "integer", minimum: 100, maximum: 5_000 },
      revision,
    },
    required: ["names", "style", "ttlMs", "revision"],
    additionalProperties: false,
  }),
] as const;

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

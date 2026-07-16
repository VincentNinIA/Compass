export const GEOGEBRA_ASSIST_TOOL_NAMES = [
  "inspect_geogebra_workspace",
  "create_geogebra_point",
  "rename_geogebra_object",
  "move_geogebra_point",
  "style_geogebra_object",
  "draw_geogebra_line",
  "draw_geogebra_ray",
  "draw_geogebra_segment",
  "draw_geogebra_circle",
  "draw_geogebra_polygon",
] as const;

export type GeoGebraAssistToolName =
  (typeof GEOGEBRA_ASSIST_TOOL_NAMES)[number];

const LABEL_PROPERTY = {
  type: "string",
  pattern: "^[A-Za-z][A-Za-z0-9_]{0,31}$",
} as const;

const COLOR_PROPERTY = {
  type: "string",
  enum: ["green", "blue", "red", "black"],
  description: "Requested display color. Use black when no color was requested.",
} as const;

const POINT_PAIR_PROPERTIES = {
  pointA: {
    ...LABEL_PROPERTY,
    description: "Label of the first existing GeoGebra point, for example F.",
  },
  pointB: {
    ...LABEL_PROPERTY,
    description: "Label of the second existing GeoGebra point, for example G.",
  },
  color: COLOR_PROPERTY,
} as const;

export const GEOGEBRA_ASSIST_TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "inspect_geogebra_workspace",
    description:
      "Read a bounded inventory of the learner's current embedded GeoGebra workspace. Use when the learner asks what is on the board or before an action whose target is uncertain.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_geogebra_point",
    description:
      "Create one named free point at explicit coordinates. Call only when the learner explicitly asks Compass to place that point.",
    parameters: {
      type: "object",
      properties: {
        label: LABEL_PROPERTY,
        x: { type: "number", minimum: -10000, maximum: 10000 },
        y: { type: "number", minimum: -10000, maximum: 10000 },
        color: COLOR_PROPERTY,
      },
      required: ["label", "x", "y", "color"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "rename_geogebra_object",
    description:
      "Rename one existing GeoGebra object. The new label must be unused. Call only after the learner explicitly asks for that rename.",
    parameters: {
      type: "object",
      properties: {
        currentName: LABEL_PROPERTY,
        newName: LABEL_PROPERTY,
      },
      required: ["currentName", "newName"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "move_geogebra_point",
    description:
      "Move one existing free point to explicit coordinates. Call only after an explicit learner request.",
    parameters: {
      type: "object",
      properties: {
        point: LABEL_PROPERTY,
        x: { type: "number", minimum: -10000, maximum: 10000 },
        y: { type: "number", minimum: -10000, maximum: 10000 },
      },
      required: ["point", "x", "y"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "style_geogebra_object",
    description:
      "Apply a supported color and label visibility to one existing GeoGebra object after an explicit learner request.",
    parameters: {
      type: "object",
      properties: {
        objectName: LABEL_PROPERTY,
        color: COLOR_PROPERTY,
        labelVisible: { type: "boolean" },
      },
      required: ["objectName", "color", "labelVisible"],
      additionalProperties: false,
    },
  },
  ...(["line", "ray", "segment"] as const).map((kind) => ({
    type: "function" as const,
    name: `draw_geogebra_${kind}` as const,
    description:
      kind === "line"
        ? "Create one infinite line through two existing points after an explicit learner request."
        : kind === "ray"
          ? "Create one ray whose origin is pointA and which passes through pointB after an explicit learner request."
          : "Create one segment with endpoints pointA and pointB after an explicit learner request.",
    parameters: {
      type: "object",
      properties: POINT_PAIR_PROPERTIES,
      required: ["pointA", "pointB", "color"],
      additionalProperties: false,
    },
  })),
  {
    type: "function",
    name: "draw_geogebra_circle",
    description:
      "Create one circle with an existing center point through another existing point after an explicit learner request.",
    parameters: {
      type: "object",
      properties: {
        center: LABEL_PROPERTY,
        throughPoint: LABEL_PROPERTY,
        color: COLOR_PROPERTY,
      },
      required: ["center", "throughPoint", "color"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "draw_geogebra_polygon",
    description:
      "Create one polygon from 3 to 8 distinct existing points in the requested order after an explicit learner request.",
    parameters: {
      type: "object",
      properties: {
        pointLabels: {
          type: "array",
          minItems: 3,
          maxItems: 8,
          uniqueItems: true,
          items: LABEL_PROPERTY,
        },
        color: COLOR_PROPERTY,
      },
      required: ["pointLabels", "color"],
      additionalProperties: false,
    },
  },
] as const;

export function isGeoGebraAssistToolName(
  value: string,
): value is GeoGebraAssistToolName {
  return (GEOGEBRA_ASSIST_TOOL_NAMES as readonly string[]).includes(value);
}

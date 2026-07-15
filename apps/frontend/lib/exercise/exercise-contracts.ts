import { z } from "zod";

const EXTRACTION_SCHEMA_VERSION = "exercise_extraction.v1" as const;
const PLAN_SCHEMA_VERSION = "exercise_plan.v1" as const;

export const EXERCISE_AMBIGUITY_CODES_V1 = [
  "missing_labels",
  "unreadable_text",
  "conflicting_instruction",
  "missing_segment",
] as const;

export type ExerciseAmbiguityCodeV1 =
  (typeof EXERCISE_AMBIGUITY_CODES_V1)[number];

export const EXERCISE_CLARIFICATION_MESSAGES_V1 = Object.freeze({
  missing_labels: "What are the labels of the segment endpoints?",
  unreadable_text: "Which construction does the instruction ask for?",
  conflicting_instruction:
    "Should you construct the perpendicular bisector of AB?",
  missing_segment: "Which two points define the segment?",
} satisfies Record<ExerciseAmbiguityCodeV1, string>);

export type ExerciseClarificationMessageV1 =
  (typeof EXERCISE_CLARIFICATION_MESSAGES_V1)[ExerciseAmbiguityCodeV1];

export const EXERCISE_READY_INSTRUCTION_V1 =
  "Construct the perpendicular bisector of segment AB." as const;
export const EXERCISE_UNSUPPORTED_MESSAGE_V1 =
  "This exercise is outside the supported demo." as const;
export const EXERCISE_REFUSAL_MESSAGE_V1 =
  "The model declined to analyze this exercise." as const;

export function getExerciseClarificationMessageV1(
  code: ExerciseAmbiguityCodeV1,
): ExerciseClarificationMessageV1 {
  return EXERCISE_CLARIFICATION_MESSAGES_V1[code];
}

export const ExerciseExtractionWireV1 = z.strictObject({
  schemaVersion: z.literal(EXTRACTION_SCHEMA_VERSION),
  outcome: z.enum(["ready", "needs_clarification", "unsupported"]),
  language: z.enum(["en", "fr", "unknown"]),
  instruction: z.string().nullable(),
  pointLabels: z.array(z.string()),
  segmentEndpoints: z.tuple([z.string(), z.string()]).nullable(),
  requestedConstruction: z
    .enum(["perpendicular_bisector", "other"])
    .nullable(),
  learningObjective: z
    .literal("perpendicular_bisector_equidistance")
    .nullable(),
  ambiguityCode: z.enum(EXERCISE_AMBIGUITY_CODES_V1).nullable(),
  clarificationQuestion: z.string().nullable(),
  unsupportedReason: z.string().nullable(),
});

export type ExerciseExtractionWireV1 = z.infer<
  typeof ExerciseExtractionWireV1
>;

export const ExerciseReadyClientExtractionV1 = z.strictObject({
  schemaVersion: z.literal(EXTRACTION_SCHEMA_VERSION),
  outcome: z.literal("ready"),
  language: z.enum(["en", "fr", "unknown"]),
  instruction: z.literal(EXERCISE_READY_INSTRUCTION_V1),
  pointLabels: z.tuple([z.literal("A"), z.literal("B")]),
  segmentEndpoints: z.tuple([z.literal("A"), z.literal("B")]),
  requestedConstruction: z.literal("perpendicular_bisector"),
  learningObjective: z.literal("perpendicular_bisector_equidistance"),
  ambiguityCode: z.null(),
  clarificationQuestion: z.null(),
  unsupportedReason: z.null(),
});

export type ExerciseReadyClientExtractionV1 = z.infer<
  typeof ExerciseReadyClientExtractionV1
>;

const PlanPointA = z.strictObject({
  kind: z.literal("point"),
  label: z.literal("A"),
  coordinates: z.strictObject({
    x: z.literal(-3),
    y: z.literal(0),
  }),
});

const PlanPointB = z.strictObject({
  kind: z.literal("point"),
  label: z.literal("B"),
  coordinates: z.strictObject({
    x: z.literal(3),
    y: z.literal(0),
  }),
});

const PlanSegmentAB = z.strictObject({
  kind: z.literal("segment"),
  label: z.literal("AB"),
  endpoints: z.tuple([z.literal("A"), z.literal("B")]),
});

const PerpendicularTarget = z.strictObject({
  relation: z.literal("perpendicular"),
  subject: z.literal("perpendicular_bisector_of_AB"),
  reference: z.literal("AB"),
});

const MidpointTarget = z.strictObject({
  relation: z.literal("passes_through_midpoint"),
  subject: z.literal("perpendicular_bisector_of_AB"),
  reference: z.literal("AB"),
});

export const ExercisePlanV1 = z.strictObject({
  schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  exerciseId: z.literal("demo-perpendicular-bisector-01"),
  givens: z.tuple([PlanPointA, PlanPointB, PlanSegmentAB]),
  studentMustCreate: z.tuple([
    z.literal("perpendicular_bisector_of_AB"),
  ]),
  targetRelations: z.tuple([PerpendicularTarget, MidpointTarget]),
  initializationPolicy: z.literal("create_givens_only"),
});

export type ExercisePlanV1 = z.infer<typeof ExercisePlanV1>;

export type ExerciseContractErrorV1 =
  | {
      code: "invalid_extraction";
      reason:
        | "wire_schema_invalid"
        | "ready_fields_invalid"
        | "clarification_fields_invalid"
        | "unsupported_fields_invalid"
        | "outcome_not_ready";
      message: string;
    }
  | {
      code: "invalid_plan";
      reason: "plan_schema_invalid";
      message: string;
    };

export type ExerciseExtractionValidationV1 =
  | { success: true; data: ExerciseExtractionWireV1 }
  | { success: false; error: ExerciseContractErrorV1 };

export type ExercisePlanValidationV1 =
  | { success: true; data: ExercisePlanV1 }
  | { success: false; error: ExerciseContractErrorV1 };

const ERROR_MESSAGES = {
  wire_schema_invalid: "The extraction does not match exercise_extraction.v1.",
  ready_fields_invalid:
    "The ready extraction is inconsistent with the supported exercise.",
  clarification_fields_invalid:
    "The clarification extraction must contain one ambiguity and one question.",
  unsupported_fields_invalid:
    "The unsupported extraction must contain a safe reason and no ambiguity.",
  outcome_not_ready: "Only a ready extraction can produce an exercise plan.",
  plan_schema_invalid: "The exercise plan does not match exercise_plan.v1.",
} as const;

export class ExerciseContractError extends Error {
  readonly code: ExerciseContractErrorV1["code"];
  readonly reason: ExerciseContractErrorV1["reason"];

  constructor(readonly detail: ExerciseContractErrorV1) {
    super(detail.message);
    this.name = "ExerciseContractError";
    this.code = detail.code;
    this.reason = detail.reason;
  }
}

function invalidExtraction(
  reason: Extract<ExerciseContractErrorV1, { code: "invalid_extraction" }>["reason"],
): ExerciseContractErrorV1 {
  return {
    code: "invalid_extraction",
    reason,
    message: ERROR_MESSAGES[reason],
  };
}

function invalidPlan(): ExerciseContractErrorV1 {
  return {
    code: "invalid_plan",
    reason: "plan_schema_invalid",
    message: ERROR_MESSAGES.plan_schema_invalid,
  };
}

function isUsefulText(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

function hasCanonicalPointLabels(labels: string[]): boolean {
  return (
    labels.length === 2 &&
    labels.includes("A") &&
    labels.includes("B") &&
    new Set(labels).size === 2
  );
}

function hasCanonicalSegment(
  endpoints: [string, string] | null,
): endpoints is ["A", "B"] {
  return endpoints?.[0] === "A" && endpoints[1] === "B";
}

function hasCoherentClarificationAmbiguity(
  extraction: ExerciseExtractionWireV1,
): boolean {
  switch (extraction.ambiguityCode) {
    case "missing_labels":
      return (
        extraction.segmentEndpoints === null &&
        extraction.pointLabels.length < 2 &&
        new Set(extraction.pointLabels).size === extraction.pointLabels.length &&
        extraction.pointLabels.every((label) => label === "A" || label === "B")
      );
    case "unreadable_text":
      return extraction.instruction === null;
    case "conflicting_instruction":
      return (
        isUsefulText(extraction.instruction) &&
        hasCanonicalPointLabels(extraction.pointLabels) &&
        hasCanonicalSegment(extraction.segmentEndpoints) &&
        extraction.requestedConstruction === null
      );
    case "missing_segment":
      return (
        hasCanonicalPointLabels(extraction.pointLabels) &&
        extraction.segmentEndpoints === null
      );
    case null:
      return false;
  }
}

function hasCoherentClarificationIntent(
  extraction: ExerciseExtractionWireV1,
): boolean {
  if (extraction.requestedConstruction === "perpendicular_bisector") {
    return (
      extraction.learningObjective ===
      "perpendicular_bisector_equidistance"
    );
  }

  return (
    extraction.requestedConstruction === null &&
    extraction.learningObjective === null
  );
}

function semanticError(
  extraction: ExerciseExtractionWireV1,
): ExerciseContractErrorV1 | null {
  if (extraction.outcome === "ready") {
    const valid =
      isUsefulText(extraction.instruction) &&
      hasCanonicalPointLabels(extraction.pointLabels) &&
      hasCanonicalSegment(extraction.segmentEndpoints) &&
      extraction.requestedConstruction === "perpendicular_bisector" &&
      extraction.learningObjective ===
        "perpendicular_bisector_equidistance" &&
      extraction.ambiguityCode === null &&
      extraction.clarificationQuestion === null &&
      extraction.unsupportedReason === null;
    return valid ? null : invalidExtraction("ready_fields_invalid");
  }

  if (extraction.outcome === "needs_clarification") {
    const valid =
      hasCoherentClarificationAmbiguity(extraction) &&
      hasCoherentClarificationIntent(extraction) &&
      isUsefulText(extraction.clarificationQuestion) &&
      extraction.unsupportedReason === null;
    return valid ? null : invalidExtraction("clarification_fields_invalid");
  }

  const valid =
    isUsefulText(extraction.unsupportedReason) &&
    extraction.requestedConstruction === "other" &&
    extraction.learningObjective === null &&
    extraction.ambiguityCode === null &&
    extraction.clarificationQuestion === null;
  return valid ? null : invalidExtraction("unsupported_fields_invalid");
}

export function validateExerciseExtractionWireV1(
  input: unknown,
): ExerciseExtractionValidationV1 {
  const parsed = ExerciseExtractionWireV1.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: invalidExtraction("wire_schema_invalid"),
    };
  }

  const error = semanticError(parsed.data);
  return error
    ? { success: false, error }
    : { success: true, data: parsed.data };
}

export function validateExercisePlanV1(
  input: unknown,
): ExercisePlanValidationV1 {
  const parsed = ExercisePlanV1.safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, error: invalidPlan() };
}

export function createExerciseReadyClientExtractionV1(
  input: unknown,
): ExerciseReadyClientExtractionV1 {
  const extraction = validateExerciseExtractionWireV1(input);
  if (!extraction.success) {
    throw new ExerciseContractError(extraction.error);
  }
  if (extraction.data.outcome !== "ready") {
    throw new ExerciseContractError(invalidExtraction("outcome_not_ready"));
  }

  return ExerciseReadyClientExtractionV1.parse({
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    outcome: "ready",
    language: extraction.data.language,
    instruction: EXERCISE_READY_INSTRUCTION_V1,
    pointLabels: ["A", "B"],
    segmentEndpoints: ["A", "B"],
    requestedConstruction: "perpendicular_bisector",
    learningObjective: "perpendicular_bisector_equidistance",
    ambiguityCode: null,
    clarificationQuestion: null,
    unsupportedReason: null,
  });
}

const CANONICAL_PLAN_INPUT = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  exerciseId: "demo-perpendicular-bisector-01",
  givens: [
    {
      kind: "point",
      label: "A",
      coordinates: { x: -3, y: 0 },
    },
    {
      kind: "point",
      label: "B",
      coordinates: { x: 3, y: 0 },
    },
    {
      kind: "segment",
      label: "AB",
      endpoints: ["A", "B"],
    },
  ],
  studentMustCreate: ["perpendicular_bisector_of_AB"],
  targetRelations: [
    {
      relation: "perpendicular",
      subject: "perpendicular_bisector_of_AB",
      reference: "AB",
    },
    {
      relation: "passes_through_midpoint",
      subject: "perpendicular_bisector_of_AB",
      reference: "AB",
    },
  ],
  initializationPolicy: "create_givens_only",
} as const satisfies z.input<typeof ExercisePlanV1>;

export function deriveExercisePlanV1(input: unknown): ExercisePlanV1 {
  const extraction = validateExerciseExtractionWireV1(input);
  if (!extraction.success) {
    throw new ExerciseContractError(extraction.error);
  }
  if (extraction.data.outcome !== "ready") {
    throw new ExerciseContractError(invalidExtraction("outcome_not_ready"));
  }

  const plan = validateExercisePlanV1(CANONICAL_PLAN_INPUT);
  if (!plan.success) {
    throw new ExerciseContractError(plan.error);
  }
  return plan.data;
}

type JsonSchemaObject = Record<string, unknown>;

function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStructuredOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeStructuredOutputSchema);
  }
  if (!isJsonSchemaObject(value)) return value;

  const normalized: JsonSchemaObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$schema" || key === "prefixItems") continue;
    normalized[key] = normalizeStructuredOutputSchema(child);
  }

  if (Array.isArray(value.prefixItems)) {
    const tupleItems = value.prefixItems.map(normalizeStructuredOutputSchema);
    const [firstItem, ...remainingItems] = tupleItems;
    if (
      firstItem === undefined ||
      remainingItems.some(
        (item) => JSON.stringify(item) !== JSON.stringify(firstItem),
      )
    ) {
      throw new Error(
        "Structured Outputs cannot represent a heterogeneous tuple in this contract.",
      );
    }
    normalized.items = firstItem;
    normalized.minItems = tupleItems.length;
    normalized.maxItems = tupleItems.length;
  }

  return normalized;
}

export function createExerciseExtractionWireV1JsonSchema(): JsonSchemaObject {
  const generated = z.toJSONSchema(ExerciseExtractionWireV1, {
    target: "draft-2020-12",
  });
  const normalized = normalizeStructuredOutputSchema(generated);
  if (!isJsonSchemaObject(normalized)) {
    throw new Error("exercise_extraction.v1 did not produce an object schema.");
  }
  return normalized;
}

export const EXERCISE_EXTRACTION_WIRE_V1_JSON_SCHEMA =
  createExerciseExtractionWireV1JsonSchema();

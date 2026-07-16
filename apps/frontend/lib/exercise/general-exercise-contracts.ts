import { z } from "zod";

export const GENERAL_EXERCISE_SCHEMA_VERSION = "general_exercise.v1" as const;

export const GENERAL_EXERCISE_SUBJECTS_V1 = [
  "mathematics",
  "physics",
  "chemistry",
  "biology",
  "history",
  "geography",
  "language_arts",
  "foreign_language",
  "computer_science",
  "economics",
  "other",
  "unknown",
] as const;

export const GENERAL_EXERCISE_AMBIGUITY_CODES_V1 = [
  "unreadable_text",
  "cropped_content",
  "missing_context",
  "conflicting_content",
] as const;

export type GeneralExerciseAmbiguityCodeV1 =
  (typeof GENERAL_EXERCISE_AMBIGUITY_CODES_V1)[number];

export const GENERAL_EXERCISE_CLARIFICATION_MESSAGES_V1 = Object.freeze({
  unreadable_text: "What does the exercise say?",
  cropped_content: "Can you include the full exercise in the photo?",
  missing_context: "What information belongs with the question?",
  conflicting_content: "Which instruction should I follow?",
} satisfies Record<GeneralExerciseAmbiguityCodeV1, string>);

export const GENERAL_EXERCISE_REFUSAL_MESSAGE_V1 =
  "The model declined to analyze this exercise." as const;

const BoundedTitle = z.string().trim().min(1).max(160);
const BoundedStatement = z.string().trim().min(1).max(6_000);
const BoundedTask = z.string().trim().min(1).max(1_000);
const BoundedConcept = z.string().trim().min(1).max(160);
const BoundedQuestion = z.string().trim().min(1).max(300);

export const GeneralExerciseWireV1 = z.strictObject({
  schemaVersion: z.literal(GENERAL_EXERCISE_SCHEMA_VERSION),
  outcome: z.enum(["ready", "needs_clarification"]),
  language: z.enum(["en", "fr", "unknown"]),
  subject: z.enum(GENERAL_EXERCISE_SUBJECTS_V1),
  title: BoundedTitle.nullable(),
  statement: BoundedStatement.nullable(),
  tasks: z.array(BoundedTask).max(16),
  concepts: z.array(BoundedConcept).max(16),
  ambiguityCode: z.enum(GENERAL_EXERCISE_AMBIGUITY_CODES_V1).nullable(),
  clarificationQuestion: BoundedQuestion.nullable(),
});

export type GeneralExerciseWireV1 = z.infer<typeof GeneralExerciseWireV1>;

export const GeneralExerciseReadyV1 = GeneralExerciseWireV1.extend({
  outcome: z.literal("ready"),
  statement: BoundedStatement,
  tasks: z.array(BoundedTask).min(1).max(16),
  ambiguityCode: z.null(),
  clarificationQuestion: z.null(),
});

export type GeneralExerciseReadyV1 = z.infer<typeof GeneralExerciseReadyV1>;

export type GeneralExerciseValidationV1 =
  | { success: true; data: GeneralExerciseWireV1 }
  | {
      success: false;
      error: "wire_schema_invalid" | "ready_fields_invalid" | "clarification_fields_invalid";
    };

export function validateGeneralExerciseWireV1(
  input: unknown,
): GeneralExerciseValidationV1 {
  const parsed = GeneralExerciseWireV1.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "wire_schema_invalid" };
  }

  const exercise = parsed.data;
  if (exercise.outcome === "ready") {
    const ready = GeneralExerciseReadyV1.safeParse(exercise);
    if (!ready.success) {
      return { success: false, error: "ready_fields_invalid" };
    }
    return { success: true, data: ready.data };
  }

  if (
    exercise.ambiguityCode === null ||
    exercise.clarificationQuestion === null ||
    exercise.tasks.length > 0
  ) {
    return { success: false, error: "clarification_fields_invalid" };
  }
  return { success: true, data: exercise };
}

export function parseGeneralExerciseReadyV1(input: unknown): GeneralExerciseReadyV1 {
  const validated = validateGeneralExerciseWireV1(input);
  if (!validated.success || validated.data.outcome !== "ready") {
    throw new Error("invalid_general_exercise_ready");
  }
  return GeneralExerciseReadyV1.parse(validated.data);
}

export function getGeneralExerciseClarificationMessageV1(
  code: GeneralExerciseAmbiguityCodeV1,
): string {
  return GENERAL_EXERCISE_CLARIFICATION_MESSAGES_V1[code];
}

export function createGeneralExerciseWireV1JsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(GeneralExerciseWireV1, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;
}

export const GENERAL_EXERCISE_WIRE_V1_JSON_SCHEMA =
  createGeneralExerciseWireV1JsonSchema();

export type TeacherGuidanceContextV1 = {
  learningObjective: string;
  teacherInstructions: string;
  targetDifficulties: string[];
  likelyMisconceptions: string[];
  hintSequence: string[];
};

export type GeneralExerciseContextV1 = Pick<
  GeneralExerciseReadyV1,
  "language" | "subject" | "title" | "statement" | "tasks" | "concepts"
> & {
  teacherGuidance?: TeacherGuidanceContextV1;
};

export function createGeneralExerciseContextV1(
  exercise: GeneralExerciseReadyV1,
  teacherGuidance?: TeacherGuidanceContextV1,
): GeneralExerciseContextV1 {
  return {
    language: exercise.language,
    subject: exercise.subject,
    title: exercise.title,
    statement: exercise.statement,
    tasks: [...exercise.tasks],
    concepts: [...exercise.concepts],
    ...(teacherGuidance
      ? {
          teacherGuidance: {
            ...teacherGuidance,
            targetDifficulties: [...teacherGuidance.targetDifficulties],
            likelyMisconceptions: [...teacherGuidance.likelyMisconceptions],
            hintSequence: [...teacherGuidance.hintSequence],
          },
        }
      : {}),
  };
}

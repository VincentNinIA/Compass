import { z } from "zod";

import {
  GeometryInvestigationV1,
  type GeometryInvestigationV1 as GeometryInvestigation,
} from "@/lib/geometry-investigation/contracts";
import { getVarignonActivityV1 } from "@/lib/geometry-investigation/varignon";

import type { TeacherReviewCheck } from "./exercise";

export const TEACHER_EXERCISE_V2_SCHEMA_VERSION =
  "teacher_exercise.v2" as const;
export const TEACHER_EXERCISE_PUBLICATION_V2_SCHEMA_VERSION =
  "teacher_exercise_publication.v2" as const;

const TeacherPublicationId = z
  .string()
  .regex(/^teacher_[a-z0-9-]{8,80}$/);

export const TeacherExerciseDraftV2 = z.strictObject({
  schemaVersion: z.literal(TEACHER_EXERCISE_V2_SCHEMA_VERSION),
  source: z.literal("manual"),
  content: z.strictObject({
    kind: z.literal("geometry_investigation"),
    exercise: GeometryInvestigationV1,
  }),
  estimatedMinutes: z.number().int().min(10).max(90),
});

export type TeacherExerciseDraftV2 = z.infer<typeof TeacherExerciseDraftV2>;

export const TeacherExercisePublicationV2 = TeacherExerciseDraftV2.extend({
  schemaVersion: z.literal(
    TEACHER_EXERCISE_PUBLICATION_V2_SCHEMA_VERSION,
  ),
  id: TeacherPublicationId,
  publishedAt: z.number().int().nonnegative(),
});

export type TeacherExercisePublicationV2 = z.infer<
  typeof TeacherExercisePublicationV2
>;

export type TeacherGeometryDraftReviewV1 = Readonly<{
  publishable: boolean;
  checks: readonly TeacherReviewCheck[];
}>;

export function createTeacherGeometryDraftV2(
  locale: "fr" | "en",
): TeacherExerciseDraftV2 {
  return TeacherExerciseDraftV2.parse({
    schemaVersion: TEACHER_EXERCISE_V2_SCHEMA_VERSION,
    source: "manual",
    content: {
      kind: "geometry_investigation",
      exercise: structuredClone(getVarignonActivityV1(locale)),
    },
    estimatedMinutes: 35,
  });
}

export function reviewTeacherGeometryDraftV2(
  input: unknown,
): TeacherGeometryDraftReviewV1 {
  const parsed = TeacherExerciseDraftV2.safeParse(input);
  if (!parsed.success) {
    return {
      publishable: false,
      checks: blockedChecks("The investigation draft is incomplete or invalid."),
    };
  }
  const activity = parsed.data.content.exercise;
  const uniqueMissionInstructions = new Set(
    activity.missions.map(({ instruction }) => instruction.toLocaleLowerCase()),
  );
  const safeContent = !containsUnsafeWording(activity);
  const hasSupportContext =
    activity.targetedDifficulties.length > 0 ||
    activity.teacherGuidance.trim().length > 0;
  const checks: TeacherReviewCheck[] = [
    {
      role: "didactics",
      status:
        uniqueMissionInstructions.size === activity.missions.length
          ? "pass"
          : "blocked",
      message:
        uniqueMissionInstructions.size === activity.missions.length
          ? "The nine ordered missions are distinct and structurally valid."
          : "Two mission instructions are identical.",
    },
    {
      role: "difficulty",
      status: hasSupportContext ? "pass" : "warning",
      message: hasSupportContext
        ? "The investigation includes difficulty and support context."
        : "Add a difficulty or teacher guidance before sharing.",
    },
    {
      role: "safety",
      status: safeContent ? "pass" : "blocked",
      message: safeContent
        ? "The editable wording contains no prompt override or secret request."
        : "Remove prompt overrides or secret requests before sharing.",
    },
    {
      role: "cost",
      status: "pass",
      message: "The validated Varignon template is prepared locally.",
    },
  ];
  return {
    publishable: checks.every(({ status }) => status !== "blocked"),
    checks: Object.freeze(checks.map((check) => Object.freeze(check))),
  };
}

export function updateTeacherGeometryActivityV2(
  draft: TeacherExerciseDraftV2,
  update: (activity: GeometryInvestigation) => GeometryInvestigation,
): TeacherExerciseDraftV2 {
  return TeacherExerciseDraftV2.parse({
    ...draft,
    content: {
      kind: "geometry_investigation",
      exercise: GeometryInvestigationV1.parse(
        update(structuredClone(draft.content.exercise)),
      ),
    },
  });
}

function blockedChecks(message: string): readonly TeacherReviewCheck[] {
  return Object.freeze([
    Object.freeze({ role: "didactics", status: "blocked", message }),
    Object.freeze({
      role: "difficulty",
      status: "blocked",
      message: "Support cannot be reviewed until the activity is valid.",
    }),
    Object.freeze({
      role: "safety",
      status: "blocked",
      message: "Invalid activity content cannot be published.",
    }),
    Object.freeze({
      role: "cost",
      status: "pass",
      message: "The validated Varignon template is prepared locally.",
    }),
  ] satisfies TeacherReviewCheck[]);
}

function containsUnsafeWording(activity: GeometryInvestigation): boolean {
  const unsafePattern =
    /(ignore (all|the )?(previous|prior)|system prompt|developer message|api[_ -]?key|secret|ignore (toutes? |les )?instructions? précédentes?|clé api|révèle (le |la |les )?secret)/i;
  return [
    activity.title,
    activity.objective,
    activity.teacherGuidance,
    activity.conjecturePrompt,
    activity.transferPrompt,
    ...activity.targetedDifficulties,
    ...activity.proofPrompts,
    ...activity.missions.flatMap(({ title, instruction }) => [title, instruction]),
  ].some((value) => unsafePattern.test(value));
}

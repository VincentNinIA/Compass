import { z } from "zod";

import { GENERAL_EXERCISE_SUBJECTS_V1 } from "@/lib/exercise/general-exercise-contracts";

export const LEARNING_SESSION_REPORT_SCHEMA_VERSION =
  "learning_session_report.v1" as const;

export const LearningSessionReportV1 = z
  .strictObject({
    schemaVersion: z.literal(LEARNING_SESSION_REPORT_SCHEMA_VERSION),
    exerciseId: z.string().regex(/^teacher_[a-z0-9-]{8,80}$/),
    title: z.string().trim().min(1).max(160),
    subject: z.enum(GENERAL_EXERCISE_SUBJECTS_V1),
    totalMissions: z.number().int().min(1).max(16),
    completedMissions: z.number().int().min(0).max(16),
    verifiedMissions: z.number().int().min(0).max(16),
    reflectedMissions: z.number().int().min(0).max(16),
    exerciseXp: z.number().int().min(0).max(320),
    transferCompleted: z.boolean(),
    updatedAt: z.number().int().nonnegative(),
  })
  .superRefine((report, context) => {
    if (report.completedMissions > report.totalMissions) {
      context.addIssue({
        code: "custom",
        path: ["completedMissions"],
        message: "completed_missions_exceed_total",
      });
    }
    if (report.verifiedMissions > report.completedMissions) {
      context.addIssue({
        code: "custom",
        path: ["verifiedMissions"],
        message: "verified_missions_exceed_completed",
      });
    }
    if (report.reflectedMissions > report.completedMissions) {
      context.addIssue({
        code: "custom",
        path: ["reflectedMissions"],
        message: "reflected_missions_exceed_completed",
      });
    }
  });

export type LearningSessionReportV1 = z.infer<typeof LearningSessionReportV1>;

export function parseLearningSessionReportV1(
  input: unknown,
): LearningSessionReportV1 {
  return LearningSessionReportV1.parse(input);
}

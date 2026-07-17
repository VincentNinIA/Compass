import { z } from "zod";

export const EXERCISE_PARSE_LOG_CODES = [
  "ready",
  "needs_clarification",
  "unsupported",
  "refused",
  "invalid_request",
  "invalid_image",
  "image_too_large",
  "image_normalization_unavailable",
  "openai_not_configured",
  "parse_rate_limited",
  "parse_unavailable",
  "parse_timeout",
  "invalid_model_output",
] as const;

export type ExerciseParseLogCode = (typeof EXERCISE_PARSE_LOG_CODES)[number];

const ExerciseParseLogEntrySchema = z
  .object({
    requestId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    status: z.enum(["completed", "failed"]),
    code: z.enum(EXERCISE_PARSE_LOG_CODES),
    durationMs: z.number().finite().nonnegative(),
    normalizedByteLength: z.number().int().nonnegative().nullable(),
    normalizedWidth: z.number().int().positive().nullable(),
    normalizedHeight: z.number().int().positive().nullable(),
    model: z.literal("gpt-5.6-terra"),
  })
  .strict();

export type ExerciseParseLogEntry = Readonly<
  z.infer<typeof ExerciseParseLogEntrySchema>
>;

export type ExerciseParseLogger = (entry: ExerciseParseLogEntry) => void;

/**
 * Runtime boundary for the only metadata that may leave the parse handler.
 * The default handler supplies no logger, so production is deliberately silent.
 */
export function emitExerciseParseLog(
  logger: ExerciseParseLogger | undefined,
  candidate: unknown,
): boolean {
  if (!logger) return false;

  const parsed = ExerciseParseLogEntrySchema.safeParse(candidate);
  if (!parsed.success) return false;

  try {
    logger(Object.freeze(parsed.data));
    return true;
  } catch {
    // Diagnostics must never change the user-visible route result.
    return false;
  }
}

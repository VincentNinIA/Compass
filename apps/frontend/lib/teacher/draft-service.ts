import {
  EXERCISE_IMAGE_LIMITS,
  ExerciseImageNormalizationError,
  normalizeExerciseImage,
  type NormalizedExerciseImage,
} from "@/lib/exercise/image-normalization";
import {
  createTeacherExerciseDraftV1,
  normalizeTeacherSubject,
  reviewTeacherExerciseDraft,
  TEACHER_DRAFT_MAX_MODEL_CALLS,
  TEACHER_DRAFT_MODEL,
  TEACHER_DRAFT_PROMPT,
  TEACHER_LEVELS_V1,
  type TeacherExerciseDraftV1,
  type TeacherExerciseModelDraftV1,
} from "./exercise";

const MAX_TEXT_FIELD = 1_200;
const MAX_MULTIPART_BYTES = EXERCISE_IMAGE_LIMITS.maxInputBytes + 64 * 1024;

export type TeacherDraftGenerationInput = {
  source: "upload" | "generated";
  prompt: string;
  imageDataUrl?: string;
};

export type TeacherDraftServiceDependencies = {
  generate?(input: TeacherDraftGenerationInput): Promise<unknown>;
  normalizeImage?(input: Buffer): Promise<NormalizedExerciseImage>;
};

type TeacherDraftErrorCode =
  | "invalid_request"
  | "invalid_image"
  | "draft_unconfigured"
  | "draft_unavailable"
  | "invalid_model_output";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
    },
  });
}

function error(code: TeacherDraftErrorCode, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

function singleText(formData: FormData, name: string): string | null {
  const values = formData.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const value = values[0].trim();
  return value.length <= MAX_TEXT_FIELD ? value : null;
}

function hasOnlyKnownFields(formData: FormData): boolean {
  const allowed = new Set([
    "source",
    "subject",
    "level",
    "theme",
    "difficulties",
    "teacherInstructions",
    "language",
    "image",
  ]);
  for (const key of formData.keys()) if (!allowed.has(key)) return false;
  return true;
}

function parseDifficulties(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildPrompt(fields: {
  subject: string;
  level: string;
  theme: string;
  difficulties: string[];
  teacherInstructions: string;
  language: string;
}): string {
  return [
    TEACHER_DRAFT_PROMPT,
    `Requested subject: ${normalizeTeacherSubject(fields.subject)}.`,
    `Requested level: ${fields.level}.`,
    `Requested language: ${fields.language === "en" ? "en" : "fr"}.`,
    `Theme or exercise description: ${fields.theme || "transcribe and structure the supplied exercise image"}.`,
    `Learner difficulties: ${fields.difficulties.join(" | ") || "not specified"}.`,
    `Teacher guidance: ${fields.teacherInstructions || "not specified"}.`,
  ].join("\n");
}

export function createTeacherDraftHandler(
  dependencies: TeacherDraftServiceDependencies = {},
) {
  return async function handleTeacherDraft(request: Request): Promise<Response> {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      return error("invalid_request", "Expected multipart form data.", 400);
    }
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
      return error("invalid_image", "The request is too large.", 413);
    }
    if (!dependencies.generate) {
      return error(
        "draft_unconfigured",
        "AI drafting is not configured. You can still create a manual draft.",
        503,
      );
    }

    let inputBytes: Buffer | undefined;
    let normalized: NormalizedExerciseImage | undefined;
    try {
      const formData = await request.formData();
      if (!hasOnlyKnownFields(formData)) {
        return error("invalid_request", "The request contains an unknown field.", 400);
      }
      const source = singleText(formData, "source");
      const subject = singleText(formData, "subject");
      const level = singleText(formData, "level");
      const theme = singleText(formData, "theme");
      const difficulties = singleText(formData, "difficulties");
      const teacherInstructions = singleText(formData, "teacherInstructions");
      const language = singleText(formData, "language");
      if (
        (source !== "upload" && source !== "generated") ||
        subject === null ||
        level === null ||
        !TEACHER_LEVELS_V1.includes(level as (typeof TEACHER_LEVELS_V1)[number]) ||
        (!theme && source !== "upload") ||
        difficulties === null ||
        teacherInstructions === null ||
        (language !== "en" && language !== "fr")
      ) {
        return error("invalid_request", "Complete the required teacher brief.", 400);
      }

      let imageDataUrl: string | undefined;
      const images = formData.getAll("image");
      if (source === "upload") {
        if (images.length !== 1 || !(images[0] instanceof File) || images[0].size === 0) {
          return error("invalid_request", "Choose one exercise image.", 400);
        }
        if (images[0].size > EXERCISE_IMAGE_LIMITS.maxInputBytes) {
          return error("invalid_image", "The image is too large.", 413);
        }
        inputBytes = Buffer.from(await images[0].arrayBuffer());
        normalized = await (dependencies.normalizeImage ?? normalizeExerciseImage)(
          inputBytes,
        );
        imageDataUrl = `data:image/jpeg;base64,${normalized.bytes.toString("base64")}`;
      } else if (images.length > 0) {
        return error("invalid_request", "Generated drafts do not accept an image.", 400);
      }

      const generationInput: TeacherDraftGenerationInput = {
        source,
        prompt: buildPrompt({
          subject,
          level,
          theme: theme ?? "",
          difficulties: parseDifficulties(difficulties),
          teacherInstructions,
          language,
        }),
        ...(imageDataUrl ? { imageDataUrl } : {}),
      };
      let modelDraft: TeacherExerciseModelDraftV1;
      try {
        modelDraft = (await dependencies.generate(
          generationInput,
        )) as TeacherExerciseModelDraftV1;
      } catch {
        return error(
          "draft_unavailable",
          "Compass could not prepare the draft. Use the manual fallback or retry.",
          503,
        );
      }

      let draft: TeacherExerciseDraftV1;
      try {
        draft = createTeacherExerciseDraftV1(source, modelDraft);
      } catch {
        return error(
          "invalid_model_output",
          "The generated draft did not pass the closed schema.",
          502,
        );
      }
      return json({
        draft,
        review: reviewTeacherExerciseDraft(draft),
        usage: {
          model: TEACHER_DRAFT_MODEL,
          maxModelCalls: TEACHER_DRAFT_MAX_MODEL_CALLS,
          actualModelCalls: 1,
        },
      });
    } catch (caught) {
      if (caught instanceof ExerciseImageNormalizationError) {
        return error("invalid_image", "The image could not be read safely.", 400);
      }
      return error("invalid_request", "The teacher draft request is invalid.", 400);
    } finally {
      inputBytes?.fill(0);
      normalized?.bytes.fill(0);
    }
  };
}

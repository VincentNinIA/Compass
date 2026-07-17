import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { withDemoAccessProtection } from "@/lib/demo-access/guard";
import { createTeacherDraftHandler } from "@/lib/teacher/draft-service";
import {
  TEACHER_DRAFT_MODEL,
  TeacherExerciseModelDraftV1,
} from "@/lib/teacher/exercise";

export const dynamic = "force-dynamic";

function createHandler() {
  const apiKey = process.env.OPENAI_API_KEY;
  return createTeacherDraftHandler({
    ...(apiKey
      ? {
          generate: async ({ prompt, imageDataUrl }) => {
            const openai = new OpenAI({ apiKey, maxRetries: 0 });
            const content: Array<
              | { type: "input_text"; text: string }
              | {
                  type: "input_image";
                  image_url: string;
                  detail: "high";
                }
            > = [{ type: "input_text", text: prompt }];
            if (imageDataUrl) {
              content.push({
                type: "input_image",
                image_url: imageDataUrl,
                detail: "high",
              });
            }
            const response = await openai.responses.parse({
              model: TEACHER_DRAFT_MODEL,
              store: false,
              tools: [],
              reasoning: { effort: "low" },
              max_output_tokens: 2_500,
              input: [{ role: "user", content }],
              text: {
                format: zodTextFormat(
                  TeacherExerciseModelDraftV1,
                  "teacher_exercise_draft_v1",
                ),
              },
            });
            return response.output_parsed;
          },
        }
      : {}),
  });
}

async function createDraft(request: Request): Promise<Response> {
  return createHandler()(request);
}

export const POST = withDemoAccessProtection(createDraft);

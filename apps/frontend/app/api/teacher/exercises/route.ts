import { z } from "zod";

import {
  parseTeacherExerciseDraftV1,
  reviewTeacherExerciseDraft,
} from "@/lib/teacher/exercise";
import {
  listTeacherExercises,
  publishTeacherExercise,
  TEACHER_EXERCISE_STORE_LIMIT,
} from "@/lib/teacher/store";

export const dynamic = "force-dynamic";

const PublishRequest = z.strictObject({ draft: z.unknown() });
const MAX_PUBLISH_BYTES = 32 * 1024;

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
    },
  });
}

export async function GET(): Promise<Response> {
  return response({
    exercises: listTeacherExercises(),
    persistence: "server_memory",
    limit: TEACHER_EXERCISE_STORE_LIMIT,
  });
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_PUBLISH_BYTES) {
    return response({ error: { code: "publish_too_large" } }, 413);
  }
  try {
    const body = PublishRequest.parse(JSON.parse(text));
    const draft = parseTeacherExerciseDraftV1(body.draft);
    const review = reviewTeacherExerciseDraft(draft);
    if (!review.publishable) {
      return response(
        { error: { code: "draft_not_publishable", review } },
        422,
      );
    }
    return response({ publication: publishTeacherExercise(draft), review }, 201);
  } catch {
    return response({ error: { code: "invalid_publish_request" } }, 400);
  }
}

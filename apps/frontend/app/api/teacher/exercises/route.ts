import { z } from "zod";

import { withDemoAccessProtection } from "@/lib/demo-access/guard";
import {
  TeacherExerciseDraftV1,
  parseTeacherExerciseDraftV1,
  reviewTeacherExerciseDraft,
} from "@/lib/teacher/exercise";
import {
  TeacherExerciseDraftV2,
  reviewTeacherGeometryDraftV2,
} from "@/lib/teacher/geometry-exercise";
import {
  listTeacherExercises,
  publishTeacherExercise,
  publishTeacherGeometryExercise,
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

async function listExercises(): Promise<Response> {
  return response({
    exercises: listTeacherExercises(),
    persistence: "server_memory",
    limit: TEACHER_EXERCISE_STORE_LIMIT,
  });
}

async function publishExercise(request: Request): Promise<Response> {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_PUBLISH_BYTES) {
    return response({ error: { code: "publish_too_large" } }, 413);
  }
  try {
    const body = PublishRequest.parse(JSON.parse(text));
    const geometryDraft = TeacherExerciseDraftV2.safeParse(body.draft);
    if (geometryDraft.success) {
      const review = reviewTeacherGeometryDraftV2(geometryDraft.data);
      if (!review.publishable) {
        return response(
          { error: { code: "draft_not_publishable", review } },
          422,
        );
      }
      return response(
        {
          publication: publishTeacherGeometryExercise(geometryDraft.data),
          review,
        },
        201,
      );
    }
    const generalDraft = TeacherExerciseDraftV1.safeParse(body.draft);
    if (!generalDraft.success) throw new Error("invalid_teacher_draft");
    const draft = parseTeacherExerciseDraftV1(generalDraft.data);
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

const protectedListExercises = withDemoAccessProtection(listExercises);

export function GET(
  request = new Request("http://localhost/api/teacher/exercises"),
): Promise<Response> {
  return protectedListExercises(request);
}
export const POST = withDemoAccessProtection(publishExercise);

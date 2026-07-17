import { type z } from "zod";

import { ClassroomPilotError } from "./pilot-store";

export const CLASSROOM_MAX_BODY_BYTES = 2 * 1024;

export function classroomJson(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      Pragma: "no-cache",
      ...headers,
    },
  });
}

export function classroomFailure(
  status: number,
  code: string,
  message: string,
): Response {
  return classroomJson(
    { error: { code, message, retryable: status >= 500 } },
    status,
  );
}

export async function parseClassroomJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | null> {
  if (
    request.headers.get("content-type")?.toLowerCase().split(";", 1)[0] !==
    "application/json"
  ) {
    return null;
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > CLASSROOM_MAX_BODY_BYTES
  ) {
    return null;
  }
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > CLASSROOM_MAX_BODY_BYTES) return null;
    return schema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",", 1)[0]
      ?.trim();
    const host = forwardedHost || request.headers.get("host")?.trim();
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim();
    const protocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : new URL(request.url).protocol;
    return Boolean(host) && parsedOrigin.host === host && parsedOrigin.protocol === protocol;
  } catch {
    return false;
  }
}

export function classroomErrorResponse(error: unknown): Response {
  if (error instanceof ClassroomPilotError) {
    switch (error.code) {
      case "join_code_invalid_or_expired":
        return classroomFailure(
          401,
          error.code,
          "The class code is invalid or expired.",
        );
      case "learner_alias_conflict":
      case "classroom_group_conflict":
        return classroomFailure(
          409,
          error.code,
          error.code === "learner_alias_conflict"
            ? "This pseudonym is already used in the class."
            : "This group name is already used in the class.",
        );
      case "assignment_contract_drift":
      case "assignment_idempotency_conflict":
        return classroomFailure(409, error.code, "The assignment preview changed.");
      case "assignment_invalid_window":
        return classroomFailure(400, error.code, "The assignment window is invalid.");
      case "assignment_target_empty":
        return classroomFailure(409, error.code, "The assignment target is empty.");
      case "classroom_archived":
        return classroomFailure(409, error.code, "The class is archived.");
      case "classroom_not_found":
      case "classroom_group_not_found":
      case "assignment_not_found":
      case "assignment_target_not_found":
      case "learner_alias_not_found":
        return classroomFailure(404, error.code, "The resource was not found.");
      case "teacher_revoked":
        return classroomFailure(403, error.code, "Teacher access was revoked.");
      case "join_code_collision":
      case "classroom_store_unavailable":
        return classroomFailure(
          503,
          "classroom_store_unavailable",
          "The class service is temporarily unavailable.",
        );
    }
  }
  return classroomFailure(
    503,
    "classroom_store_unavailable",
    "The class service is temporarily unavailable.",
  );
}

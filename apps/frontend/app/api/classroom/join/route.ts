import { z } from "zod";

import { withDemoAccessProtection } from "@/lib/demo-access/guard";
import {
  CLASSROOM_LEARNER_COOKIE_NAME,
  CLASSROOM_LEARNER_TTL_SECONDS,
  classroomCookieIsSecure,
  classroomErrorResponse,
  classroomFailure,
  classroomJson,
  getClassroomPilotRuntime,
  hasTrustedOrigin,
  inspectLearnerSession,
  issueLearnerSession,
  parseClassroomJson,
  readClassroomPilotConfig,
  serializeClassroomCookie,
} from "@/lib/classroom";

export const dynamic = "force-dynamic";

const JoinRequest = z.strictObject({
  code: z.string().trim().min(12).max(32),
  pseudonym: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u)
    .refine((value) => !value.includes("@")),
});

async function readMembership(request: Request): Promise<Response> {
  const inspection = inspectLearnerSession(request.headers.get("cookie"));
  if (inspection.status === "disabled") {
    return classroomJson({ status: "disabled" });
  }
  if (inspection.status !== "authorized") {
    return classroomFailure(
      inspection.status === "unavailable" ? 503 : 401,
      inspection.status === "unavailable"
        ? "classroom_pilot_unavailable"
        : "learner_session_required",
      inspection.status === "unavailable"
        ? "The class pilot is unavailable."
        : "A class session is required.",
    );
  }
  const runtime = getClassroomPilotRuntime();
  if (runtime.status !== "ready") {
    return classroomFailure(
      503,
      "classroom_pilot_unavailable",
      "The class pilot is unavailable.",
    );
  }
  try {
    const membership = await runtime.service.readLearnerMembership(
      inspection.classroomId,
      inspection.learnerAliasId,
    );
    if (!membership) {
      return classroomFailure(
        401,
        "learner_session_revoked",
        "The class session is no longer active.",
      );
    }
    return classroomJson({ membership: publicMembership(membership) });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

async function joinClass(request: Request): Promise<Response> {
  if (!hasTrustedOrigin(request)) {
    return classroomFailure(403, "origin_forbidden", "The origin is forbidden.");
  }
  const config = readClassroomPilotConfig();
  const runtime = getClassroomPilotRuntime();
  if (config.status !== "enabled" || runtime.status !== "ready") {
    return classroomFailure(
      503,
      "classroom_pilot_unavailable",
      "The class pilot is unavailable.",
    );
  }
  const payload = await parseClassroomJson(request, JoinRequest);
  if (!payload) {
    return classroomFailure(400, "invalid_request", "The request is invalid.");
  }
  try {
    const membership = await runtime.service.joinClassroom(
      payload.code,
      payload.pseudonym,
    );
    const issued = issueLearnerSession(
      membership.classroom.id,
      membership.learnerAlias.id,
      config,
    );
    return classroomJson(
      { membership: publicMembership(membership) },
      201,
      {
        "Set-Cookie": serializeClassroomCookie(
          CLASSROOM_LEARNER_COOKIE_NAME,
          issued.token,
          {
            maxAge: CLASSROOM_LEARNER_TTL_SECONDS,
            secure: classroomCookieIsSecure(request.url),
          },
        ),
      },
    );
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

async function leaveClass(request: Request): Promise<Response> {
  if (!hasTrustedOrigin(request)) {
    return classroomFailure(403, "origin_forbidden", "The origin is forbidden.");
  }
  return classroomJson(
    { status: "signed_out" },
    200,
    {
      "Set-Cookie": serializeClassroomCookie(
        CLASSROOM_LEARNER_COOKIE_NAME,
        "",
        { maxAge: 0, secure: classroomCookieIsSecure(request.url) },
      ),
    },
  );
}

function publicMembership(membership: {
  classroom: { id: string; label: string; expiresAt: number };
  learnerAlias: { id: string; pseudonym: string; expiresAt: number };
}) {
  return {
    classroom: {
      id: membership.classroom.id,
      label: membership.classroom.label,
      expiresAt: membership.classroom.expiresAt,
    },
    learnerAlias: {
      id: membership.learnerAlias.id,
      pseudonym: membership.learnerAlias.pseudonym,
      expiresAt: membership.learnerAlias.expiresAt,
    },
  };
}

export const GET = withDemoAccessProtection(readMembership);
export const POST = withDemoAccessProtection(joinClass);
export const DELETE = withDemoAccessProtection(leaveClass);

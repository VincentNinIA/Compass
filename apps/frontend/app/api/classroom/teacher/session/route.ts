import { z } from "zod";

import { withDemoAccessProtection } from "@/lib/demo-access/guard";
import {
  CLASSROOM_TEACHER_COOKIE_NAME,
  CLASSROOM_TEACHER_TTL_SECONDS,
  classroomCookieIsSecure,
  classroomErrorResponse,
  classroomFailure,
  classroomJson,
  classroomTeacherAuthSubjectHash,
  getClassroomPilotRuntime,
  hasTrustedOrigin,
  inspectTeacherSession,
  issueTeacherSession,
  parseClassroomJson,
  readClassroomPilotConfig,
  serializeClassroomCookie,
  verifyClassroomTeacherAccessCode,
} from "@/lib/classroom";

export const dynamic = "force-dynamic";

const LoginRequest = z.strictObject({
  code: z.string().min(8).max(128),
  locale: z.enum(["fr", "en"]),
});

async function getSession(request: Request): Promise<Response> {
  const inspection = inspectTeacherSession(request.headers.get("cookie"));
  if (inspection.status === "disabled") {
    return classroomJson({ status: "disabled" });
  }
  if (inspection.status === "unavailable") {
    return classroomFailure(
      503,
      "classroom_pilot_unavailable",
      "The class pilot is unavailable.",
    );
  }
  if (inspection.status === "required") {
    return classroomFailure(
      401,
      "teacher_session_required",
      "Teacher access is required.",
    );
  }
  return classroomJson({
    status: "authorized",
    expiresAt: inspection.expiresAt,
  });
}

async function login(request: Request): Promise<Response> {
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
  const payload = await parseClassroomJson(request, LoginRequest);
  if (!payload) {
    return classroomFailure(400, "invalid_request", "The request is invalid.");
  }
  if (!(await verifyClassroomTeacherAccessCode(payload.code, config))) {
    return classroomFailure(
      401,
      "teacher_access_invalid",
      "The teacher access code is invalid.",
    );
  }
  try {
    const teacher = await runtime.service.ensureTeacher(
      classroomTeacherAuthSubjectHash(config.teacherSubject),
      payload.locale,
    );
    const issued = issueTeacherSession(teacher.id, config);
    return classroomJson(
      { status: "authorized", expiresAt: issued.expiresAt },
      200,
      {
        "Set-Cookie": serializeClassroomCookie(
          CLASSROOM_TEACHER_COOKIE_NAME,
          issued.token,
          {
            maxAge: CLASSROOM_TEACHER_TTL_SECONDS,
            secure: classroomCookieIsSecure(request.url),
          },
        ),
      },
    );
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

async function logout(request: Request): Promise<Response> {
  if (!hasTrustedOrigin(request)) {
    return classroomFailure(403, "origin_forbidden", "The origin is forbidden.");
  }
  return classroomJson(
    { status: "signed_out" },
    200,
    {
      "Set-Cookie": serializeClassroomCookie(
        CLASSROOM_TEACHER_COOKIE_NAME,
        "",
        { maxAge: 0, secure: classroomCookieIsSecure(request.url) },
      ),
    },
  );
}

export const GET = withDemoAccessProtection(getSession);
export const POST = withDemoAccessProtection(login);
export const DELETE = withDemoAccessProtection(logout);

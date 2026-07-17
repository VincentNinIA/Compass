import { z } from "zod";

import { withDemoAccessProtection } from "@/lib/demo-access/guard";
import {
  classroomErrorResponse,
  classroomFailure,
  classroomJson,
  getClassroomPilotRuntime,
  hasTrustedOrigin,
  inspectTeacherSession,
  parseClassroomJson,
  type ClassroomPilotServiceV1,
  type ClassroomWithRosterV1,
} from "@/lib/classroom";

export const dynamic = "force-dynamic";

const CreateClassroomRequest = z.strictObject({
  label: z.string().trim().min(1).max(80).refine((value) => !value.includes("@")),
});

const ClassroomActionRequest = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("rotate_code"),
    classroomId: z.string().regex(/^classroom_[a-z0-9-]{8,80}$/),
  }),
  z.strictObject({
    action: z.literal("archive"),
    classroomId: z.string().regex(/^classroom_[a-z0-9-]{8,80}$/),
  }),
  z.strictObject({
    action: z.literal("remove_learner"),
    classroomId: z.string().regex(/^classroom_[a-z0-9-]{8,80}$/),
    learnerAliasId: z.string().regex(/^learner_[a-z0-9-]{8,80}$/),
  }),
]);

function teacherContext(request: Request):
  | { response: Response }
  | { teacherId: string; service: ClassroomPilotServiceV1 } {
  const inspection = inspectTeacherSession(request.headers.get("cookie"));
  if (inspection.status !== "authorized") {
    return {
      response: classroomFailure(
        inspection.status === "unavailable" ? 503 : 401,
        inspection.status === "unavailable"
          ? "classroom_pilot_unavailable"
          : "teacher_session_required",
        inspection.status === "unavailable"
          ? "The class pilot is unavailable."
          : "Teacher access is required.",
      ),
    } as const;
  }
  const runtime = getClassroomPilotRuntime();
  if (runtime.status !== "ready") {
    return {
      response: classroomFailure(
        503,
        "classroom_pilot_unavailable",
        "The class pilot is unavailable.",
      ),
    } as const;
  }
  return {
    teacherId: inspection.teacherId,
    service: runtime.service,
  } as const;
}

async function listClasses(request: Request): Promise<Response> {
  const context = teacherContext(request);
  if ("response" in context) return context.response;
  try {
    const classrooms = await context.service.listClassrooms(context.teacherId);
    return classroomJson({ classrooms: classrooms.map(publicClassroom) });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

async function createClass(request: Request): Promise<Response> {
  if (!hasTrustedOrigin(request)) {
    return classroomFailure(403, "origin_forbidden", "The origin is forbidden.");
  }
  const context = teacherContext(request);
  if ("response" in context) return context.response;
  const payload = await parseClassroomJson(request, CreateClassroomRequest);
  if (!payload) {
    return classroomFailure(400, "invalid_request", "The request is invalid.");
  }
  try {
    const result = await context.service.createClassroom(
      context.teacherId,
      payload.label,
    );
    return classroomJson(
      {
        classroom: publicClassroom({
          classroom: result.classroom,
          learnerAliases: [],
          groups: [],
          assignments: [],
        }),
        joinCode: result.joinCode,
      },
      201,
    );
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

async function mutateClass(request: Request): Promise<Response> {
  if (!hasTrustedOrigin(request)) {
    return classroomFailure(403, "origin_forbidden", "The origin is forbidden.");
  }
  const context = teacherContext(request);
  if ("response" in context) return context.response;
  const payload = await parseClassroomJson(request, ClassroomActionRequest);
  if (!payload) {
    return classroomFailure(400, "invalid_request", "The request is invalid.");
  }
  try {
    if (payload.action === "rotate_code") {
      const result = await context.service.rotateJoinCode(
        context.teacherId,
        payload.classroomId,
      );
      return classroomJson({
        classroom: publicClassroom({
          classroom: result.classroom,
          learnerAliases: [],
          groups: [],
          assignments: [],
        }),
        joinCode: result.joinCode,
      });
    }
    if (payload.action === "archive") {
      const classroom = await context.service.archiveClassroom(
        context.teacherId,
        payload.classroomId,
      );
      return classroomJson({
        classroom: publicClassroom({
          classroom,
          learnerAliases: [],
          groups: [],
          assignments: [],
        }),
      });
    }
    await context.service.removeLearnerAlias(
      context.teacherId,
      payload.classroomId,
      payload.learnerAliasId,
    );
    return classroomJson({ status: "removed" });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

function publicClassroom(entry: ClassroomWithRosterV1) {
  return {
    id: entry.classroom.id,
    label: entry.classroom.label,
    status: entry.classroom.status,
    createdAt: entry.classroom.createdAt,
    joinCodeExpiresAt: entry.classroom.joinCodeExpiresAt,
    expiresAt: entry.classroom.expiresAt,
    learnerAliases: entry.learnerAliases.map((alias) => ({
      id: alias.id,
      pseudonym: alias.pseudonym,
      createdAt: alias.createdAt,
      expiresAt: alias.expiresAt,
    })),
    groups: entry.groups.map((group) => ({
      id: group.id,
      label: group.label,
      learnerAliasIds: group.learnerAliasIds,
      createdAt: group.createdAt,
      expiresAt: group.expiresAt,
    })),
    assignments: entry.assignments.map((view) => ({
      id: view.assignment.id,
      status: view.assignment.status,
      target: view.assignment.target,
      contractHash: view.assignment.contractHash,
      assistancePolicy: view.assignment.assistancePolicy,
      opensAt: view.assignment.opensAt,
      closesAt: view.assignment.closesAt,
      createdAt: view.assignment.createdAt,
      recipientAliasIds: view.recipientAliasIds,
      publication: view.publication,
    })),
  };
}

export const GET = withDemoAccessProtection(listClasses);
export const POST = withDemoAccessProtection(createClass);
export const PATCH = withDemoAccessProtection(mutateClass);

import { z } from "zod";

import { withDemoAccessProtection } from "@/lib/demo-access/guard";
import {
  CLASSROOM_VARIGNON_CATALOG_ID,
  classroomErrorResponse,
  classroomFailure,
  classroomJson,
  getClassroomPilotRuntime,
  hasTrustedOrigin,
  inspectTeacherSession,
  parseClassroomJson,
  type ClassroomPilotServiceV1,
} from "@/lib/classroom";

export const dynamic = "force-dynamic";

const ClassroomId = z.string().regex(/^classroom_[a-z0-9-]{8,80}$/);
const LearnerAliasId = z.string().regex(/^learner_[a-z0-9-]{8,80}$/);
const GroupId = z.string().regex(/^group_[a-z0-9-]{8,80}$/);
const AssignmentId = z.string().regex(/^assignment_[a-z0-9-]{8,80}$/);
const ContractHash = z.string().regex(/^[a-f0-9]{64}$/);

const AssignmentTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("classroom"), classroomId: ClassroomId }),
  z.strictObject({ kind: z.literal("group"), groupId: GroupId }),
  z.strictObject({ kind: z.literal("learner"), learnerAliasId: LearnerAliasId }),
]);

const AssignmentAction = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create_group"),
    classroomId: ClassroomId,
    label: z.string().trim().min(1).max(80).refine((value) => !value.includes("@")),
    learnerAliasIds: z.array(LearnerAliasId).min(1).max(32),
  }),
  z.strictObject({
    action: z.literal("assign"),
    catalogId: z.literal(CLASSROOM_VARIGNON_CATALOG_ID),
    classroomId: ClassroomId,
    target: AssignmentTarget,
    locale: z.enum(["fr", "en"]),
    expectedContractHash: ContractHash,
    idempotencyKey: z.string().regex(/^[a-z0-9-]{16,80}$/),
    opensAt: z.number().int().nonnegative(),
    closesAt: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("revoke"),
    classroomId: ClassroomId,
    assignmentId: AssignmentId,
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
    };
  }
  const runtime = getClassroomPilotRuntime();
  if (runtime.status !== "ready") {
    return {
      response: classroomFailure(
        503,
        "classroom_pilot_unavailable",
        "The class pilot is unavailable.",
      ),
    };
  }
  return { teacherId: inspection.teacherId, service: runtime.service };
}

async function readCatalog(request: Request): Promise<Response> {
  const context = teacherContext(request);
  if ("response" in context) return context.response;
  const locale = new URL(request.url).searchParams.get("locale") === "fr" ? "fr" : "en";
  return classroomJson({
    catalog: context.service.getActivityCatalog(locale).map((entry) => ({
      catalogId: entry.catalogId,
      sourceDocument: entry.sourceDocument,
      sourceSha256: entry.sourceSha256,
      locale: entry.locale,
      contractHash: entry.contractHash,
      publication: entry.publication,
    })),
  });
}

async function mutateAssignments(request: Request): Promise<Response> {
  if (!hasTrustedOrigin(request)) {
    return classroomFailure(403, "origin_forbidden", "The origin is forbidden.");
  }
  const context = teacherContext(request);
  if ("response" in context) return context.response;
  const payload = await parseClassroomJson(request, AssignmentAction);
  if (!payload) {
    return classroomFailure(400, "invalid_request", "The request is invalid.");
  }
  try {
    if (payload.action === "create_group") {
      const group = await context.service.createClassroomGroup(
        context.teacherId,
        payload,
      );
      return classroomJson({ group }, 201);
    }
    if (payload.action === "assign") {
      const assignment = await context.service.createClassAssignment(
        context.teacherId,
        payload,
      );
      return classroomJson({ assignment }, 201);
    }
    const assignment = await context.service.revokeClassAssignment(
      context.teacherId,
      payload.classroomId,
      payload.assignmentId,
    );
    return classroomJson({ assignment });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

export const GET = withDemoAccessProtection(readCatalog);
export const POST = withDemoAccessProtection(mutateAssignments);

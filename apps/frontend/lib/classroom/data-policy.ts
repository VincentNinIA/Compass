export const PERSISTED_CLASSROOM_ENTITIES_V1 = [
  "teacher",
  "classroom",
  "group",
  "learner_alias",
  "activity_template",
  "assignment",
  "learning_evidence",
  "session_checkpoint",
] as const;

export type PersistedClassroomEntityV1 =
  (typeof PERSISTED_CLASSROOM_ENTITIES_V1)[number];

export type PersistedFieldPolicyV1 = Readonly<{
  entity: PersistedClassroomEntityV1;
  field: string;
  purpose: string;
  authority: "teacher" | "learner" | "system";
  retention: string;
}>;

const policy = (
  entity: PersistedClassroomEntityV1,
  field: string,
  purpose: string,
  authority: PersistedFieldPolicyV1["authority"],
  retention: string,
): PersistedFieldPolicyV1 =>
  Object.freeze({ entity, field, purpose, authority, retention });

export const PERSISTED_FIELD_CATALOG_V1 = Object.freeze([
  policy("teacher", "schemaVersion", "Reject incompatible teacher records.", "system", "Record lifetime."),
  policy("teacher", "id", "Own classes and assignments without storing an email.", "system", "180 days maximum."),
  policy("teacher", "authSubjectHash", "Bind a server-managed pilot credential without storing its subject.", "system", "180 days maximum."),
  policy("teacher", "locale", "Render the pilot workspace language.", "teacher", "180 days maximum."),
  policy("teacher", "status", "Revoke teacher access.", "system", "180 days maximum; purge after revocation window."),
  policy("teacher", "createdAt", "Audit bounded account creation.", "system", "180 days maximum."),
  policy("teacher", "expiresAt", "Drive automatic account purge.", "system", "Until purge."),

  policy("classroom", "schemaVersion", "Reject incompatible class records.", "system", "Record lifetime."),
  policy("classroom", "id", "Link aliases, groups and assignments.", "system", "90 days maximum."),
  policy("classroom", "teacherId", "Enforce class ownership.", "system", "90 days maximum."),
  policy("classroom", "label", "Let the teacher distinguish pilot classes.", "teacher", "90 days maximum; no school identifiers requested."),
  policy("classroom", "joinCodeHash", "Verify a rotating join code without storing the code.", "system", "Until code expiry; then cleared by retention purge."),
  policy("classroom", "joinCodeIssuedAt", "Prove the rotation window starts at issuance.", "system", "Until code expiry; 24-hour window maximum."),
  policy("classroom", "status", "Archive or revoke class access.", "teacher", "90 days maximum."),
  policy("classroom", "createdAt", "Bound the pilot class lifetime.", "system", "90 days maximum."),
  policy("classroom", "joinCodeExpiresAt", "Reject and purge stale join codes.", "system", "24 hours maximum after issuance."),
  policy("classroom", "expiresAt", "Drive class cascade deletion.", "system", "Until purge."),

  policy("group", "schemaVersion", "Reject incompatible group records.", "system", "Record lifetime."),
  policy("group", "id", "Target one bounded learner subset.", "teacher", "Class lifetime."),
  policy("group", "classroomId", "Prevent cross-class membership.", "system", "Class lifetime."),
  policy("group", "label", "Let the teacher identify a pilot group.", "teacher", "Class lifetime."),
  policy("group", "learnerAliasIds", "Define group recipients by pseudonymous IDs only.", "teacher", "Class lifetime."),
  policy("group", "learnerAliasIds[]", "Identify one pseudonymous group member.", "teacher", "Class lifetime."),
  policy("group", "createdAt", "Audit bounded group creation.", "system", "Class lifetime."),
  policy("group", "expiresAt", "Drive group and targeted-assignment purge.", "system", "Until purge."),

  policy("learner_alias", "schemaVersion", "Reject incompatible alias records.", "system", "Record lifetime."),
  policy("learner_alias", "id", "Own assignments, facts and checkpoints pseudonymously.", "system", "90 days maximum."),
  policy("learner_alias", "classroomId", "Enforce class isolation.", "system", "90 days maximum."),
  policy("learner_alias", "pseudonym", "Show a chosen non-nominative classroom label.", "learner", "90 days maximum."),
  policy("learner_alias", "status", "Revoke learner access.", "teacher", "90 days maximum."),
  policy("learner_alias", "createdAt", "Bound alias lifetime.", "system", "90 days maximum."),
  policy("learner_alias", "expiresAt", "Drive alias evidence/checkpoint purge.", "system", "Until purge."),

  policy("activity_template", "schemaVersion", "Reject incompatible approved templates.", "system", "Record lifetime."),
  policy("activity_template", "id", "Reference an immutable approved activity.", "teacher", "90 days maximum."),
  policy("activity_template", "teacherId", "Enforce template ownership.", "system", "90 days maximum."),
  policy("activity_template", "publication", "Replay the exact teacher-approved Varignon contract.", "teacher", "90 days maximum; teacher-authored content only."),
  policy("activity_template", "publication.*", "Preserve the fields of the strict teacher_exercise_publication.v2 contract.", "teacher", "90 days maximum; same lifetime as the template."),
  policy("activity_template", "contractHash", "Detect contract drift before resume.", "system", "90 days maximum."),
  policy("activity_template", "createdAt", "Audit approval time.", "system", "90 days maximum."),
  policy("activity_template", "expiresAt", "Drive template and assignment purge.", "system", "Until purge."),

  policy("assignment", "schemaVersion", "Reject incompatible assignments.", "system", "Record lifetime."),
  policy("assignment", "id", "Link queue, facts and checkpoint.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "classroomId", "Enforce assignment class boundary.", "system", "Close plus 30 days maximum."),
  policy("assignment", "templateId", "Reference the immutable approved contract.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "createdByTeacherId", "Enforce author ownership.", "system", "Close plus 30 days maximum."),
  policy("assignment", "target", "Target a class, group or one alias without identity data.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "target.kind", "Select the closed classroom, group or learner target variant.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "target.classroomId", "Bind a classroom target to the assignment class.", "teacher", "Close plus 30 days maximum when the classroom variant is selected."),
  policy("assignment", "target.groupId", "Bind a group target to the assignment class.", "teacher", "Close plus 30 days maximum when the group variant is selected."),
  policy("assignment", "target.learnerAliasId", "Bind an individual target to one pseudonymous alias.", "teacher", "Close plus 30 days maximum when the learner variant is selected."),
  policy("assignment", "contractHash", "Reject resume against another activity version.", "system", "Close plus 30 days maximum."),
  policy("assignment", "assistancePolicy", "Apply the approved bounded help level.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "assistancePolicy.mode", "Select the approved bounded assistance profile.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "assistancePolicy.maxProactiveLevel", "Cap proactive help before explicit learner consent.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "assistancePolicy.allowToolActivation", "Authorize tool selection without constructing for the learner.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "assistancePolicy.allowTemporaryHighlight", "Authorize temporary visual focus.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "assistancePolicy.allowAssistantVariationAfterConsent", "Authorize a new geometry variation after consent.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "assistancePolicy.allowDemonstrationAfterConsent", "Authorize a visual demonstration after consent.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "status", "Schedule, close or revoke work.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "createdAt", "Audit assignment creation.", "system", "Close plus 30 days maximum."),
  policy("assignment", "opensAt", "Keep future work out of the learner queue.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "closesAt", "Stop learner writes after the work window.", "teacher", "Close plus 30 days maximum."),
  policy("assignment", "expiresAt", "Drive assignment/evidence/checkpoint purge.", "system", "Until purge."),

  policy("learning_evidence", "schemaVersion", "Reject incompatible evidence.", "system", "Record lifetime."),
  policy("learning_evidence", "id", "Idempotently update one bounded projection.", "system", "30 days maximum."),
  policy("learning_evidence", "assignmentId", "Attach facts to the authorized assignment.", "system", "30 days maximum."),
  policy("learning_evidence", "learnerAliasId", "Isolate the pseudonymous owner.", "system", "30 days maximum."),
  policy("learning_evidence", "activityId", "Bind facts to Varignon runtime identity.", "system", "30 days maximum."),
  policy("learning_evidence", "contractHash", "Reject evidence from another contract.", "system", "30 days maximum."),
  policy("learning_evidence", "missionStates", "Report completed and verified missions separately.", "learner", "30 days maximum."),
  policy("learning_evidence", "missionStates[].missionId", "Identify the approved mission without learner prose.", "system", "30 days maximum."),
  policy("learning_evidence", "missionStates[].status", "Record pending, completed or deterministically verified state.", "system", "30 days maximum."),
  policy("learning_evidence", "missionStates[].updatedAt", "Order mission-state projections.", "system", "30 days maximum."),
  policy("learning_evidence", "facts", "Persist deterministic fact outcomes only.", "system", "30 days maximum."),
  policy("learning_evidence", "facts[].factId", "Identify one approved deterministic fact.", "system", "30 days maximum."),
  policy("learning_evidence", "facts[].pass", "Store only the boolean deterministic outcome.", "system", "30 days maximum."),
  policy("learning_evidence", "facts[].observedAt", "Timestamp the deterministic observation.", "system", "30 days maximum."),
  policy("learning_evidence", "capturedConfigurations", "Record bounded experimental cases.", "learner", "30 days maximum."),
  policy("learning_evidence", "assistance", "Report help actually delivered as counters.", "system", "30 days maximum."),
  policy("learning_evidence", "assistance.highestLevelUsed", "Report the highest bounded help level delivered.", "system", "30 days maximum."),
  policy("learning_evidence", "assistance.hintsDelivered", "Count delivered hints without storing their conversation.", "system", "30 days maximum."),
  policy("learning_evidence", "assistance.toolsActivated", "Count assistant tool activations.", "system", "30 days maximum."),
  policy("learning_evidence", "assistance.highlightsDelivered", "Count temporary highlights.", "system", "30 days maximum."),
  policy("learning_evidence", "assistance.variationsCreated", "Count consented variations.", "system", "30 days maximum."),
  policy("learning_evidence", "assistance.demonstrationsViewed", "Count consented demonstrations.", "system", "30 days maximum."),
  policy("learning_evidence", "conjectureCompleted", "Record completion without conjecture text.", "learner", "30 days maximum."),
  policy("learning_evidence", "completedJustificationStepIds", "Record completed proof steps without prose.", "learner", "30 days maximum."),
  policy("learning_evidence", "transferCompleted", "Record transfer completion without answer text.", "learner", "30 days maximum."),
  policy("learning_evidence", "exerciseXp", "Preserve the existing bounded progress ledger, never a grade.", "system", "30 days maximum."),
  policy("learning_evidence", "updatedAt", "Order idempotent projections and retention.", "system", "30 days maximum."),
  policy("learning_evidence", "expiresAt", "Drive evidence purge.", "system", "Until purge."),

  policy("session_checkpoint", "schemaVersion", "Reject incompatible checkpoints.", "system", "Record lifetime."),
  policy("session_checkpoint", "id", "Replace one short resumable state safely.", "system", "7 days maximum."),
  policy("session_checkpoint", "assignmentId", "Bind resume to the authorized assignment.", "system", "7 days maximum."),
  policy("session_checkpoint", "learnerAliasId", "Enforce checkpoint ownership.", "system", "7 days maximum."),
  policy("session_checkpoint", "activityId", "Bind resume to Varignon runtime identity.", "system", "7 days maximum."),
  policy("session_checkpoint", "contractHash", "Reject checkpoint/version mismatch.", "system", "7 days maximum."),
  policy("session_checkpoint", "worldSnapshotHash", "Verify reconstructed state without storing Base64.", "system", "7 days maximum."),
  policy("session_checkpoint", "safeState", "Reconstruct only bounded points, semantic objects and mission statuses.", "learner", "7 days maximum; no raw scene."),
  policy("session_checkpoint", "safeState.freePoints[].label", "Identify one of the four approved free points.", "learner", "7 days maximum."),
  policy("session_checkpoint", "safeState.freePoints[].x", "Restore one bounded horizontal coordinate.", "learner", "7 days maximum."),
  policy("session_checkpoint", "safeState.freePoints[].y", "Restore one bounded vertical coordinate.", "learner", "7 days maximum."),
  policy("session_checkpoint", "safeState.constructedMidpoints[]", "Restore only approved semantic midpoint labels.", "learner", "7 days maximum."),
  policy("session_checkpoint", "safeState.constructedSegments[]", "Restore only approved Varignon segment labels.", "learner", "7 days maximum."),
  policy("session_checkpoint", "safeState.activeMissionId", "Resume the approved active mission.", "learner", "7 days maximum."),
  policy("session_checkpoint", "safeState.missionStates[].missionId", "Identify one approved mission without learner prose.", "system", "7 days maximum."),
  policy("session_checkpoint", "safeState.missionStates[].status", "Restore only the bounded mission status.", "system", "7 days maximum."),
  policy("session_checkpoint", "safeState.missionStates[].updatedAt", "Order resumed mission states.", "system", "7 days maximum."),
  policy("session_checkpoint", "createdAt", "Order resume states.", "system", "7 days maximum."),
  policy("session_checkpoint", "expiresAt", "Drive checkpoint purge.", "system", "Until purge."),
] satisfies readonly PersistedFieldPolicyV1[]);

const FORBIDDEN_PERSISTENT_KEYS = new Set([
  "answer",
  "answertext",
  "audio",
  "base64",
  "birthdate",
  "dateofbirth",
  "email",
  "freetext",
  "ggbbase64",
  "grade",
  "image",
  "learnertext",
  "legalname",
  "mark",
  "media",
  "openaiapikey",
  "photo",
  "modelprompt",
  "promptoverride",
  "rawpayload",
  "responsetext",
  "score",
  "studentanswer",
  "studenttext",
  "systemprompt",
  "transcript",
  "conjecturetext",
  "justificationtext",
  "transfertext",
]);

export type ForbiddenPersistentDataIssueV1 = Readonly<{
  path: string;
  reason: "forbidden_key" | "forbidden_value";
}>;

export function scanForbiddenPersistentDataV1(
  input: unknown,
): readonly ForbiddenPersistentDataIssueV1[] {
  const issues: ForbiddenPersistentDataIssueV1[] = [];
  const visited = new Set<object>();

  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      const trimmed = value.trim().toLowerCase();
      if (
        trimmed.startsWith("data:") ||
        trimmed.includes("<geogebra") ||
        trimmed.includes("<?xml")
      ) {
        issues.push({ path, reason: "forbidden_value" });
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_PERSISTENT_KEYS.has(normalized)) {
        issues.push({ path: childPath, reason: "forbidden_key" });
        continue;
      }
      visit(child, childPath);
    }
  };

  visit(input, "");
  return Object.freeze(issues.map((issue) => Object.freeze(issue)));
}

export class ForbiddenPersistentDataError extends Error {
  readonly issues: readonly ForbiddenPersistentDataIssueV1[];

  constructor(issues: readonly ForbiddenPersistentDataIssueV1[]) {
    super("forbidden_persistent_data");
    this.name = "ForbiddenPersistentDataError";
    this.issues = issues;
  }
}

export function assertNoForbiddenPersistentDataV1(input: unknown): void {
  const issues = scanForbiddenPersistentDataV1(input);
  if (issues.length > 0) throw new ForbiddenPersistentDataError(issues);
}

import type {
  GeometryInvestigationV1,
  GeometryMissionV1,
} from "./contracts";
import type {
  GeometryActionArgumentsV1,
  GeometryActionArgumentsValueC04,
  GeometryActionArgumentsValueV1,
  GeometryInvestigationActionC04,
  GeometryInvestigationActionV1,
} from "./actions";

export const GEOMETRY_AUTHORITY_LEVELS = ["O0", "O1", "O2", "O3", "O4", "O5"] as const;
export type GeometryAuthorityLevel = (typeof GEOMETRY_AUTHORITY_LEVELS)[number];

export const GEOMETRY_ACTION_AUTHORITY_LEVEL = Object.freeze({
  inspect_geometry_workspace: "O0",
  activate_geometry_tool: "O2",
  highlight_geometry_objects: "O2",
  preview_geometry_variation: "O2",
  initialize_geometry_activity: "O3",
  create_geometry_variation: "O3",
  classify_geometry_configuration: "O0",
  check_geometry_relation: "O0",
  focus_geometry_view: "O2",
  capture_geometry_evidence: "O2",
  restore_geometry_checkpoint: "O4",
  demonstrate_geometry_step: "O5",
} satisfies Record<string, GeometryAuthorityLevel>);

export type GeometryActionAuthorityV1 = Readonly<{
  activityId: string;
  epoch: number;
  revision: number;
  phase: "confirmed" | "investigating" | "completed" | "fatal";
  actor: "system" | "learner" | "assistant";
  maxLevel: GeometryAuthorityLevel;
  missionId?: string;
  uiGuidanceAllowed: boolean;
  attemptedVariationTargets: readonly ("convex" | "concave" | "crossed")[];
  attemptedDemonstrationStepIds?: readonly string[];
  learnerActionCurrent?: boolean;
  isCurrent?: () => boolean;
}>;

export type GeometryAuthorityRejection = Readonly<{
  ok: false;
  code:
    | "invalid_authority"
    | "invalid_phase"
    | "rejected_stale"
    | "action_not_allowed"
    | "attempt_required";
  message: string;
}>;

export type GeometryAuthorityDecision =
  | Readonly<{ ok: true; level: GeometryAuthorityLevel; mission?: GeometryMissionV1 }>
  | GeometryAuthorityRejection;

export function authorizeGeometryActionC04(
  action: GeometryInvestigationActionC04,
  arguments_: GeometryActionArgumentsValueC04,
  activity: GeometryInvestigationV1,
  authority: GeometryActionAuthorityV1,
): GeometryAuthorityDecision {
  return authorizeGeometryActionV1(
    action,
    arguments_ as GeometryActionArgumentsValueV1,
    activity,
    authority,
  );
}

export function authorizeGeometryActionV1(
  action: GeometryInvestigationActionV1,
  arguments_: GeometryActionArgumentsValueV1,
  activity: GeometryInvestigationV1,
  authority: GeometryActionAuthorityV1,
): GeometryAuthorityDecision {
  const level = GEOMETRY_ACTION_AUTHORITY_LEVEL[action];
  if (
    authority.isCurrent?.() === false ||
    arguments_.activityId !== authority.activityId ||
    arguments_.activityId !== activity.id ||
    arguments_.epoch !== authority.epoch ||
    arguments_.revision !== authority.revision
  ) {
    return reject("rejected_stale", "Action authority is stale.");
  }
  if (authority.phase === "fatal") {
    return reject("invalid_phase", "Geometry mutations are frozen.");
  }

  if (action === "initialize_geometry_activity") {
    if (authority.actor !== "system") {
      return reject("invalid_authority", "Initialization is system-only.");
    }
    if (authority.phase !== "confirmed") {
      return reject("invalid_phase", "Initialization requires a confirmed activity.");
    }
    return { ok: true, level };
  }

  if (!levelAtLeast(authority.maxLevel, level)) {
    return reject("invalid_authority", `Action requires ${level} authority.`);
  }
  if (!['investigating', 'completed'].includes(authority.phase)) {
    return reject("invalid_phase", "The activity is not ready for this action.");
  }
  const mission = activity.missions.find(({ id }) => id === authority.missionId);

  if (
    action === "activate_geometry_tool" ||
    action === "highlight_geometry_objects" ||
    action === "preview_geometry_variation" ||
    action === "focus_geometry_view"
  ) {
    if (
      action === "activate_geometry_tool" &&
      !activity.assistancePolicy.allowToolActivation
    ) {
      return reject("action_not_allowed", "Tool activation is disabled by the activity.");
    }
    if (
      action === "highlight_geometry_objects" &&
      !activity.assistancePolicy.allowTemporaryHighlight
    ) {
      return reject("action_not_allowed", "Temporary highlights are disabled by the activity.");
    }
    return { ok: true, level, ...(mission ? { mission } : {}) };
  }

  if (!mission || !mission.allowedActions.includes(action)) {
    return reject("action_not_allowed", "The active mission does not allow this action.");
  }

  if (action === "create_geometry_variation") {
    if (!activity.assistancePolicy.allowAssistantVariationAfterConsent) {
      return reject("action_not_allowed", "Assistant variations are disabled.");
    }
  }

  if (action === "capture_geometry_evidence") {
    if (authority.actor !== "system" && !authority.learnerActionCurrent) {
      return reject(
        "invalid_authority",
        "Evidence capture requires a current learner action.",
      );
    }
  }

  if (action === "restore_geometry_checkpoint" && authority.actor !== "assistant") {
    return reject(
      "invalid_authority",
      "Checkpoint restore requires an explicit learner confirmation.",
    );
  }

  if (action === "demonstrate_geometry_step") {
    const demonstration =
      arguments_ as GeometryActionArgumentsV1["demonstrate_geometry_step"];
    if (
      authority.actor !== "assistant" ||
      !activity.assistancePolicy.allowDemonstrationAfterConsent
    ) {
      return reject("action_not_allowed", "Demonstration is disabled.");
    }
    if (
      !authority.attemptedDemonstrationStepIds?.includes(demonstration.stepId)
    ) {
      return reject(
        "attempt_required",
        "A learner attempt is required before this demonstration.",
      );
    }
  }

  return { ok: true, level, mission };
}

function levelAtLeast(
  actual: GeometryAuthorityLevel,
  required: GeometryAuthorityLevel,
): boolean {
  return GEOMETRY_AUTHORITY_LEVELS.indexOf(actual) >=
    GEOMETRY_AUTHORITY_LEVELS.indexOf(required);
}

function reject(
  code: GeometryAuthorityRejection["code"],
  message: string,
): GeometryAuthorityRejection {
  return { ok: false, code, message };
}

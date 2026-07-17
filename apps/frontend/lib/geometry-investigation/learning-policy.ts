import type { GeometryInvestigationV1 } from "./contracts";
import type {
  GeometryMissionAttemptV1,
  GeometrySessionStateV1,
} from "./session";

export type GeometryLearningTriggerV1 =
  | Readonly<{
      type: "attempt";
      missionId: string;
      actionId: string;
    }>
  | Readonly<{
      type: "explicit_help";
      missionId: string;
      requestId: string;
    }>;

export type GeometryLearningFloorV1 = Readonly<{
  learnerDragging: boolean;
  learnerSpeaking: boolean;
  tutorSpeaking: boolean;
  interventionPending: boolean;
}>;

export type GeometryHintDirectiveV1 = Readonly<{
  id: string;
  missionId: string;
  source: "proactive" | "explicit";
  sourceId: string;
  level: 1 | 2 | 3 | 4;
  prompt: string;
  hintId?: string;
  objectNames: readonly string[];
  action?:
    | "activate_geometry_tool"
    | "highlight_geometry_objects"
    | "demonstrate_geometry_step";
  requiresConsent: boolean;
  blockSignature?: string;
}>;

export type GeometryLearningDecisionV1 =
  | Readonly<{
      type: "SILENT";
      reason:
        | "first_block"
        | "already_helped"
        | "proactive_disabled"
        | "mission_complete"
        | "invalid_context";
    }>
  | Readonly<{
      type: "QUEUE";
      reason: "floor_busy";
      directive: GeometryHintDirectiveV1;
    }>
  | Readonly<{
      type: "SPEAK";
      reason: "repeated_block" | "explicit_help";
      directive: GeometryHintDirectiveV1;
    }>;

const AVAILABLE_LEVELS = [1, 2, 3, 4] as const;

export function decideGeometryLearningInterventionV1(
  activity: GeometryInvestigationV1,
  state: GeometrySessionStateV1,
  trigger: GeometryLearningTriggerV1,
  floor: GeometryLearningFloorV1 = {
    learnerDragging: false,
    learnerSpeaking: false,
    tutorSpeaking: false,
    interventionPending: false,
  },
): GeometryLearningDecisionV1 {
  if (
    state.activityId !== activity.id ||
    state.phase === "fatal" ||
    state.phase === "recovering" ||
    state.activeMissionId !== trigger.missionId
  ) {
    return { type: "SILENT", reason: "invalid_context" };
  }
  const mission = activity.missions.find(({ id }) => id === trigger.missionId);
  const progress = state.missions.find(
    ({ missionId }) => missionId === trigger.missionId,
  );
  const attempt = state.attempts[trigger.missionId];
  if (!mission || !progress || !attempt || progress.status !== "active") {
    return { type: "SILENT", reason: "mission_complete" };
  }

  let directive: GeometryHintDirectiveV1;
  let reason: "repeated_block" | "explicit_help";
  if (trigger.type === "attempt") {
    if (
      attempt.lastActionId !== trigger.actionId ||
      !attempt.processedActionIds.includes(trigger.actionId) ||
      attempt.lastMissingSignature.length === 0
    ) {
      return { type: "SILENT", reason: "invalid_context" };
    }
    if (attempt.repeatedBlockCount < 2) {
      return { type: "SILENT", reason: "first_block" };
    }
    if (attempt.proactiveSignatures.includes(attempt.lastMissingSignature)) {
      return { type: "SILENT", reason: "already_helped" };
    }
    if (activity.assistancePolicy.maxProactiveLevel < 1) {
      return { type: "SILENT", reason: "proactive_disabled" };
    }
    directive = createDirective(
      activity,
      mission.id,
      "proactive",
      trigger.actionId,
      1,
      attempt.lastMissingSignature,
    );
    reason = "repeated_block";
  } else {
    if (!attempt.processedHelpRequestIds.includes(trigger.requestId)) {
      return { type: "SILENT", reason: "invalid_context" };
    }
    const level = nextExplicitLevel(activity, mission.id, attempt);
    directive = createDirective(
      activity,
      mission.id,
      "explicit",
      trigger.requestId,
      level,
    );
    reason = "explicit_help";
  }

  if (
    floor.learnerDragging ||
    floor.learnerSpeaking ||
    floor.tutorSpeaking ||
    floor.interventionPending
  ) {
    return { type: "QUEUE", reason: "floor_busy", directive };
  }
  return { type: "SPEAK", reason, directive };
}

function nextExplicitLevel(
  activity: GeometryInvestigationV1,
  missionId: string,
  attempt: GeometryMissionAttemptV1,
): 1 | 2 | 3 | 4 {
  const delivered = Math.max(0, ...attempt.deliveredLevels);
  let desired = Math.min(4, delivered + 1) as 1 | 2 | 3 | 4;
  if (
    desired === 4 &&
    (!activity.assistancePolicy.allowDemonstrationAfterConsent ||
      !activity.demonstrationSteps.some((step) => step.missionId === missionId))
  ) {
    desired = 3;
  }
  return AVAILABLE_LEVELS.includes(desired) ? desired : 1;
}

function createDirective(
  activity: GeometryInvestigationV1,
  missionId: string,
  source: "proactive" | "explicit",
  sourceId: string,
  level: 1 | 2 | 3 | 4,
  blockSignature?: string,
): GeometryHintDirectiveV1 {
  const mission = activity.missions.find(({ id }) => id === missionId)!;
  const hint = activity.hintLadder.find(
    (candidate) => candidate.missionId === missionId && candidate.level === level,
  );
  const action = allowedHintAction(activity, hint?.action, level);
  return Object.freeze({
    id: `directive_${missionId}_${sourceId}_l${level}`.slice(0, 80),
    missionId,
    source,
    sourceId,
    level,
    prompt: hint?.prompt ?? fallbackPrompt(activity.locale, mission.title, level),
    ...(hint ? { hintId: hint.id } : {}),
    objectNames: Object.freeze([...(hint?.objectNames ?? [])]),
    ...(action ? { action } : {}),
    requiresConsent: level === 4,
    ...(blockSignature ? { blockSignature } : {}),
  });
}

function allowedHintAction(
  activity: GeometryInvestigationV1,
  action: "activate_tool" | "highlight_objects" | "demonstrate_step" | undefined,
  level: 1 | 2 | 3 | 4,
): GeometryHintDirectiveV1["action"] | undefined {
  if (level <= 2 || !action) return undefined;
  if (action === "activate_tool" && activity.assistancePolicy.allowToolActivation) {
    return "activate_geometry_tool";
  }
  if (
    action === "highlight_objects" &&
    activity.assistancePolicy.allowTemporaryHighlight
  ) {
    return "highlight_geometry_objects";
  }
  if (
    action === "demonstrate_step" &&
    activity.assistancePolicy.allowDemonstrationAfterConsent
  ) {
    return "demonstrate_geometry_step";
  }
  return undefined;
}

function fallbackPrompt(
  locale: "fr" | "en",
  missionTitle: string,
  level: 1 | 2 | 3 | 4,
): string {
  const fr = locale === "fr";
  if (level === 1) {
    return fr
      ? `Pour « ${missionTitle} », qu’as-tu essayé et qu’est-ce qui bloque exactement ?`
      : `For “${missionTitle}”, what did you try and where exactly are you stuck?`;
  }
  if (level === 2) {
    return fr
      ? `Repère les objets déjà construits qui sont utiles pour « ${missionTitle} ».`
      : `Identify the existing objects that are useful for “${missionTitle}”.`;
  }
  if (level === 3) {
    return fr
      ? "Compass peut mettre temporairement en évidence les objets utiles, sans modifier ta figure."
      : "Compass can temporarily highlight the useful objects without changing your figure.";
  }
  return fr
    ? "Après ta tentative, Compass peut montrer une étape analogue puis restaurer exactement ta figure."
    : "After your attempt, Compass can show one analogous step and then restore your exact figure.";
}

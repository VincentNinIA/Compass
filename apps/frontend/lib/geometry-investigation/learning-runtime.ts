import { z } from "zod";

import type {
  GeometryEvidenceCaptureV1,
  GeometryInvestigationV1,
  GeometryWorldV2,
} from "./contracts";
import {
  decideGeometryLearningInterventionV1,
  type GeometryHintDirectiveV1,
  type GeometryLearningDecisionV1,
  type GeometryLearningFloorV1,
} from "./learning-policy";
import {
  createGeometrySessionStateV1,
  reduceGeometrySessionV1,
  type GeometrySessionEventV1,
  type GeometrySessionStateV1,
} from "./session";

const Identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);

export const GeometryRealtimePedagogyContextV1 = z.strictObject({
  schemaVersion: z.literal("geometry_realtime_pedagogy_context.v1"),
  activityId: Identifier,
  epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  phase: z.enum([
    "loading",
    "ready",
    "constructing",
    "exploring",
    "conjecturing",
    "verifying",
    "justifying",
    "transferring",
    "completed",
    "recovering",
    "fatal",
  ]),
  activeMissionId: Identifier.optional(),
  attemptCount: z.number().int().nonnegative().max(1_000),
  explicitHelpRequestCount: z.number().int().nonnegative().max(1_000),
  missingEvidenceIds: z.array(Identifier).max(32),
  capturedConfigurations: z
    .array(z.enum(["convex", "concave", "crossed"]))
    .max(3),
  maxHelpLevel: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]),
});

export type GeometryRealtimePedagogyContextV1 = z.infer<
  typeof GeometryRealtimePedagogyContextV1
>;

const GeometryCoachMissionV1 = z.strictObject({
  id: Identifier,
  order: z.number().int().positive().max(100),
  title: z.string().trim().min(1).max(160),
  instruction: z.string().trim().min(1).max(360),
});

const GeometryCoachPreviousMissionV1 = z.strictObject({
  id: Identifier,
  order: z.number().int().positive().max(100),
  title: z.string().trim().min(1).max(160),
  outcome: z.enum(["verified", "completed"]),
});

const GeometryCoachHintV1 = z.strictObject({
  directiveId: Identifier,
  source: z.enum(["proactive", "explicit"]),
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  prompt: z.string().trim().min(1).max(360),
  objectNames: z.array(Identifier).max(16),
  action: z
    .enum([
      "activate_geometry_tool",
      "highlight_geometry_objects",
      "demonstrate_geometry_step",
    ])
    .optional(),
});

const GeometryCoachTurnAnchorV1 = {
  schemaVersion: z.literal("geometry_coach_turn.v1"),
  activityId: Identifier,
  epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
} as const;

export const GeometryCoachTurnV1 = z.discriminatedUnion("reason", [
  z.strictObject({
    ...GeometryCoachTurnAnchorV1,
    reason: z.literal("mission_orientation"),
    currentMission: GeometryCoachMissionV1,
  }),
  z.strictObject({
    ...GeometryCoachTurnAnchorV1,
    reason: z.literal("mission_advanced"),
    previousMission: GeometryCoachPreviousMissionV1,
    currentMission: GeometryCoachMissionV1.optional(),
  }),
  z.strictObject({
    ...GeometryCoachTurnAnchorV1,
    reason: z.literal("learning_hint"),
    currentMission: GeometryCoachMissionV1,
    hint: GeometryCoachHintV1,
  }),
]);

export type GeometryCoachTurnV1 = z.infer<typeof GeometryCoachTurnV1>;

export type GeometryLearningRuntimeCallbacksV1 = Readonly<{
  onState?: (state: GeometrySessionStateV1) => void;
  onDecision?: (decision: GeometryLearningDecisionV1) => void;
}>;

export class GeometryLearningRuntimeV1 {
  private stateValue: GeometrySessionStateV1;

  constructor(
    readonly activity: GeometryInvestigationV1,
    private readonly callbacks: GeometryLearningRuntimeCallbacksV1 = {},
  ) {
    this.stateValue = createGeometrySessionStateV1(activity);
    this.callbacks.onState?.(this.stateValue);
  }

  get state(): GeometrySessionStateV1 {
    return this.stateValue;
  }

  commitWorld(
    world: GeometryWorldV2,
    floor?: GeometryLearningFloorV1,
  ): GeometryLearningDecisionV1 | undefined {
    if (this.stateValue.phase === "loading") {
      this.dispatch({
        type: "activity_ready",
        activityId: world.activityId,
        epoch: world.epoch,
        revision: world.revision,
      });
    }
    const attemptedMissionId = this.stateValue.activeMissionId;
    this.dispatch({ type: "world_committed", world });
    if (
      world.change.actor !== "learner" ||
      world.change.kind === "initial" ||
      !attemptedMissionId
    ) {
      return undefined;
    }
    return this.recordAttempt(
      `action_${world.epoch}_${world.revision}_${world.change.kind}`,
      attemptedMissionId,
      floor,
    );
  }

  syncCaptures(captures: readonly GeometryEvidenceCaptureV1[]): void {
    this.dispatch({
      type: "captures_changed",
      ...this.anchor(),
      captures,
    });
  }

  completeReflection(
    kind: "conjecture" | "transfer",
    reflectionId: string,
    hasText: boolean,
  ): void {
    this.dispatch({
      type: "reflection_completed",
      ...this.anchor(),
      reflectionId,
      kind,
      hasText,
    });
  }

  completeJustificationStep(stepId: string, completionId: string): void {
    this.dispatch({
      type: "justification_step_completed",
      ...this.anchor(),
      completionId,
      stepId,
    });
  }

  recordAttempt(
    actionId: string,
    missionId = this.stateValue.activeMissionId,
    floor: GeometryLearningFloorV1 = freeFloor(),
  ): GeometryLearningDecisionV1 | undefined {
    if (!missionId) return undefined;
    const before = this.stateValue.rejectionCount;
    this.dispatch({
      type: "attempt_recorded",
      ...this.anchor(),
      missionId,
      actionId,
    });
    if (this.stateValue.rejectionCount !== before) return undefined;
    const decision = decideGeometryLearningInterventionV1(
      this.activity,
      this.stateValue,
      { type: "attempt", missionId, actionId },
      floor,
    );
    this.callbacks.onDecision?.(decision);
    return decision;
  }

  requestHelp(
    requestId: string,
    floor: GeometryLearningFloorV1 = freeFloor(),
  ): GeometryLearningDecisionV1 | undefined {
    const missionId = this.stateValue.activeMissionId;
    if (!missionId) return undefined;
    const before = this.stateValue.rejectionCount;
    this.dispatch({
      type: "explicit_help_requested",
      ...this.anchor(),
      missionId,
      requestId,
    });
    if (this.stateValue.rejectionCount !== before) return undefined;
    const decision = decideGeometryLearningInterventionV1(
      this.activity,
      this.stateValue,
      { type: "explicit_help", missionId, requestId },
      floor,
    );
    this.callbacks.onDecision?.(decision);
    return decision;
  }

  markAssistanceDelivered(directive: GeometryHintDirectiveV1): void {
    this.dispatch({
      type: "assistance_delivered",
      ...this.anchor(),
      missionId: directive.missionId,
      directiveId: directive.id,
      source: directive.source,
      level: directive.level,
      ...(directive.blockSignature
        ? { blockSignature: directive.blockSignature }
        : {}),
    });
  }

  markDemonstrationViewed(stepId: string): void {
    this.dispatch({
      type: "demonstration_viewed",
      ...this.anchor(),
      stepId,
    });
  }

  startRestore(): void {
    this.dispatch({ type: "restore_started", ...this.anchor() });
  }

  completeRestore(world: GeometryWorldV2): void {
    this.dispatch({ type: "restore_completed", world });
  }

  failFatal(reason: string): void {
    this.dispatch({ type: "fatal", activityId: this.activity.id, reason });
  }

  realtimeContext(): GeometryRealtimePedagogyContextV1 {
    const active = this.stateValue.missions.find(
      ({ missionId }) => missionId === this.stateValue.activeMissionId,
    );
    const attempt = this.stateValue.activeMissionId
      ? this.stateValue.attempts[this.stateValue.activeMissionId]
      : undefined;
    return GeometryRealtimePedagogyContextV1.parse({
      schemaVersion: "geometry_realtime_pedagogy_context.v1",
      activityId: this.stateValue.activityId,
      epoch: this.stateValue.epoch,
      revision: this.stateValue.revision,
      phase: this.stateValue.phase,
      ...(this.stateValue.activeMissionId
        ? { activeMissionId: this.stateValue.activeMissionId }
        : {}),
      attemptCount: attempt?.count ?? 0,
      explicitHelpRequestCount: attempt?.explicitHelpRequestCount ?? 0,
      missingEvidenceIds: (active?.missingEvidenceIds ?? []).slice(0, 32),
      capturedConfigurations: [
        ...new Set(
          this.stateValue.captures
            .filter(({ actor }) => actor === "learner")
            .map(({ configuration }) => configuration),
        ),
      ],
      maxHelpLevel: maxHelpLevel(this.activity, this.stateValue.activeMissionId),
    });
  }

  private dispatch(event: GeometrySessionEventV1): void {
    this.stateValue = reduceGeometrySessionV1(
      this.activity,
      this.stateValue,
      event,
    );
    this.callbacks.onState?.(this.stateValue);
  }

  private anchor() {
    return {
      activityId: this.stateValue.activityId,
      epoch: this.stateValue.epoch,
      revision: this.stateValue.revision,
    };
  }
}

function maxHelpLevel(
  activity: GeometryInvestigationV1,
  missionId: string | undefined,
): 0 | 1 | 2 | 3 | 4 {
  if (!missionId) return 0;
  const hasDemonstration = activity.demonstrationSteps.some(
    (step) => step.missionId === missionId,
  );
  return hasDemonstration && activity.assistancePolicy.allowDemonstrationAfterConsent
    ? 4
    : Math.min(3, activity.assistancePolicy.maxProactiveLevel + 1) as
        | 0
        | 1
        | 2
        | 3;
}

function freeFloor(): GeometryLearningFloorV1 {
  return {
    learnerDragging: false,
    learnerSpeaking: false,
    tutorSpeaking: false,
    interventionPending: false,
  };
}

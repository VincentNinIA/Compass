import { z } from "zod";

import { TOOL_NAMES, isToolName, type ToolName } from "@/lib/tools/contracts";
import type { DirectiveDraft } from "./policy";
import {
  getPedagogyInvariantViolations,
  selectIsFloorBusy,
  type PedagogyState,
  type PendingIntervention,
} from "./state";

export const INTERVENTION_DIRECTIVE_VERSION = "intervention_directive.v1";

export const directiveStatusSchema = z.enum([
  "draft",
  "queued",
  "dispatched",
  "invalidated",
  "completed",
]);

export const directiveInvalidationReasonSchema = z.enum([
  "stale_epoch",
  "exercise_changed",
  "step_changed",
  "revision_changed",
  "snapshot_changed",
  "evidence_changed",
  "source_changed",
  "floor_busy",
  "state_mismatch",
  "tool_not_allowed",
  "correlation_mismatch",
  "explicitly_cancelled",
]);

export const interventionDirectiveSchema = z
  .object({
    schemaVersion: z.literal(INTERVENTION_DIRECTIVE_VERSION),
    directiveId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    kind: z.enum(["explicit", "proactive", "completion"]),
    epoch: z.number().int().nonnegative(),
    exerciseId: z.string().min(1).max(128),
    stepId: z.string().min(1).max(128),
    baseRevision: z.number().int().nonnegative(),
    snapshotHash: z.string().min(1).max(256),
    sourceActionId: z.string().min(1).max(128).nullable(),
    sourceRequestId: z.string().min(1).max(128).nullable(),
    evidenceIds: z
      .array(z.string().min(1).max(128))
      .min(1)
      .refine(unique, "Evidence IDs must be unique."),
    missingRelationKeys: z
      .array(z.enum(["perpendicular", "passes_midpoint"]))
      .refine(unique, "Missing relation keys must be unique."),
    helpLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    goal: z.enum([
      "validate_and_elicit_explanation",
      "provide_lowest_useful_help",
      "ask_reflective_question",
    ]),
    allowedTools: z
      .array(z.enum(TOOL_NAMES))
      .refine(unique, "Allowed tools must be unique."),
    status: directiveStatusSchema,
    invalidationReason: directiveInvalidationReasonSchema.nullable(),
  })
  .strict()
  .superRefine((directive, context) => {
    if (
      (directive.sourceActionId === null) ===
      (directive.sourceRequestId === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Exactly one directive source is required.",
      });
    }
    if (
      directive.kind === "proactive" &&
      directive.sourceActionId === null
    ) {
      context.addIssue({
        code: "custom",
        message: "A proactive directive requires an action source.",
      });
    }
    if (
      directive.kind === "explicit" &&
      directive.sourceRequestId === null
    ) {
      context.addIssue({
        code: "custom",
        message: "An explicit directive requires a request source.",
      });
    }
    if (
      directive.status === "invalidated" &&
      directive.invalidationReason === null
    ) {
      context.addIssue({
        code: "custom",
        message: "An invalidated directive requires a reason.",
      });
    }
    if (
      directive.status !== "invalidated" &&
      directive.invalidationReason !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Only invalidated directives carry a reason.",
      });
    }
  });

export type DirectiveStatus = z.infer<typeof directiveStatusSchema>;
export type DirectiveInvalidationReason = z.infer<
  typeof directiveInvalidationReasonSchema
>;
type ParsedInterventionDirective = z.infer<typeof interventionDirectiveSchema>;
export type InterventionDirective = Omit<
  ParsedInterventionDirective,
  "evidenceIds" | "missingRelationKeys" | "allowedTools"
> & {
  readonly evidenceIds: readonly string[];
  readonly missingRelationKeys: readonly (
    | "perpendicular"
    | "passes_midpoint"
  )[];
  readonly allowedTools: readonly ToolName[];
};

export type DirectiveGate = "before_item" | "before_response" | "before_tool";

export type DirectiveGuardResult =
  | { ok: true }
  | { ok: false; reason: DirectiveInvalidationReason };

export type DirectiveTransitionResult =
  | { ok: true; directive: InterventionDirective }
  | { ok: false; reason: "invalid_transition" | "invalid_directive" };

export function materializeDirective(
  state: PedagogyState,
  draft: DirectiveDraft,
  createId: () => string,
): InterventionDirective | null {
  if (
    getPedagogyInvariantViolations(state).length > 0 ||
    !sourceIsCurrent(state, draft.sourceActionId, draft.sourceRequestId) ||
    draft.allowedTools.some((tool) => !isToolName(tool))
  ) {
    return null;
  }
  const evidenceIds = state.verifiedFacts.map((fact) => fact.evidenceId).sort();
  if (evidenceIds.length === 0) return null;
  let directiveId: string;
  try {
    directiveId = createId();
  } catch {
    return null;
  }
  const directive = {
    schemaVersion: INTERVENTION_DIRECTIVE_VERSION,
    directiveId,
    kind: draft.kind,
    epoch: state.epoch,
    exerciseId: state.exerciseId,
    stepId: state.stepId,
    baseRevision: state.revision,
    snapshotHash: state.studentSnapshotHash,
    sourceActionId: draft.sourceRequestId === null ? draft.sourceActionId : null,
    sourceRequestId: draft.sourceRequestId,
    evidenceIds,
    missingRelationKeys: state.verifiedFacts
      .filter((fact) => fact.status !== "verified")
      .map((fact) => fact.relationKey)
      .sort(),
    helpLevel: draft.helpLevel,
    goal: draft.goal,
    allowedTools: [...draft.allowedTools] as ToolName[],
    status: "draft" as const,
    invalidationReason: null,
  };
  const parsed = interventionDirectiveSchema.safeParse(directive);
  return parsed.success ? freezeDirective(parsed.data) : null;
}

export function queueDirective(
  directive: InterventionDirective,
): DirectiveTransitionResult {
  return transitionStatus(directive, "draft", "queued");
}

export function dispatchDirective(
  directive: InterventionDirective,
): DirectiveTransitionResult {
  return transitionStatus(directive, "queued", "dispatched");
}

export function completeDirective(
  directive: InterventionDirective,
): DirectiveTransitionResult {
  return transitionStatus(directive, "dispatched", "completed");
}

export function invalidateDirective(
  directive: InterventionDirective,
  reason: DirectiveInvalidationReason,
): DirectiveTransitionResult {
  if (
    !interventionDirectiveSchema.safeParse(directive).success ||
    directive.status === "invalidated" ||
    directive.status === "completed"
  ) {
    return { ok: false, reason: "invalid_transition" };
  }
  return parsedTransition({
    ...directive,
    status: "invalidated",
    invalidationReason: reason,
  });
}

export function toPendingIntervention(
  directive: InterventionDirective,
): Omit<PendingIntervention, "status"> {
  return {
    directiveId: directive.directiveId,
    sourceActionId: directive.sourceActionId,
    baseRevision: directive.baseRevision,
    snapshotHash: directive.snapshotHash,
  };
}

export function guardDirective(
  state: PedagogyState,
  directive: InterventionDirective,
  gate: DirectiveGate,
  options: {
    toolName?: string;
    callId?: string;
    correlation?: DirectiveCorrelationLedger;
  } = {},
): DirectiveGuardResult {
  if (!interventionDirectiveSchema.safeParse(directive).success) {
    return rejected("state_mismatch");
  }
  if (directive.status === "invalidated" || directive.status === "completed") {
    return rejected("state_mismatch");
  }
  if (directive.epoch !== state.epoch) return rejected("stale_epoch");
  if (directive.exerciseId !== state.exerciseId) {
    return rejected("exercise_changed");
  }
  if (directive.stepId !== state.stepId) return rejected("step_changed");
  if (directive.baseRevision !== state.revision) {
    return rejected("revision_changed");
  }
  if (directive.snapshotHash !== state.studentSnapshotHash) {
    return rejected("snapshot_changed");
  }
  if (!sourceIsCurrent(state, directive.sourceActionId, directive.sourceRequestId)) {
    return rejected("source_changed");
  }
  const currentEvidenceIds = new Set(
    Object.values(state.evidenceById)
      .filter(
        (evidence) =>
          evidence.revision === state.revision &&
          evidence.snapshotHash === state.studentSnapshotHash,
      )
      .map((evidence) => evidence.id),
  );
  if (
    directive.evidenceIds.length !== currentEvidenceIds.size ||
    directive.evidenceIds.some((id) => !currentEvidenceIds.has(id))
  ) {
    return rejected("evidence_changed");
  }
  const currentMissingRelationKeys = state.verifiedFacts
    .filter((fact) => fact.status !== "verified")
    .map((fact) => fact.relationKey)
    .sort();
  if (
    currentMissingRelationKeys.join("|") !==
      [...directive.missingRelationKeys].sort().join("|") ||
    state.verifiedFacts.some((fact) => {
      const evidence = state.evidenceById[fact.evidenceId];
      return fact.status !== (evidence?.pass ? "verified" : "missing");
    })
  ) {
    return rejected("evidence_changed");
  }
  if (getPedagogyInvariantViolations(state).length > 0) {
    return rejected("state_mismatch");
  }

  if (gate === "before_item") {
    if (
      directive.status !== "queued" ||
      state.pendingIntervention?.directiveId !== directive.directiveId ||
      state.pendingIntervention.status !== "queued"
    ) {
      return rejected("state_mismatch");
    }
    if (selectIsFloorBusy(state)) return rejected("floor_busy");
    return { ok: true };
  }

  if (gate === "before_response") {
    if (
      directive.status !== "dispatched" ||
      state.pendingIntervention?.directiveId !== directive.directiveId ||
      state.pendingIntervention.status !== "dispatched"
    ) {
      return rejected("state_mismatch");
    }
    if (selectIsFloorBusy(state)) return rejected("floor_busy");
    return { ok: true };
  }

  if (
    directive.status !== "dispatched" ||
    state.activeResponse?.directiveId !== directive.directiveId
  ) {
    return rejected("state_mismatch");
  }
  if (state.interaction.studentIsDragging || state.interaction.studentIsSpeaking) {
    return rejected("floor_busy");
  }
  if (
    !options.toolName ||
    !isToolName(options.toolName) ||
    !directive.allowedTools.includes(options.toolName)
  ) {
    return rejected("tool_not_allowed");
  }
  if (
    !options.callId ||
    !options.correlation?.hasCall(
      directive.directiveId,
      state.activeResponse.responseId,
      options.callId,
    )
  ) {
    return rejected("correlation_mismatch");
  }
  return { ok: true };
}

export type DirectiveCorrelation = {
  directiveId: string;
  itemEventId: string | null;
  itemId: string | null;
  responseEventId: string | null;
  responseId: string | null;
  callIds: readonly string[];
};

export class DirectiveCorrelationLedger {
  private readonly records = new Map<string, DirectiveCorrelation>();

  create(directiveId: string): boolean {
    if (!validCorrelationId(directiveId) || this.records.has(directiveId)) {
      return false;
    }
    this.records.set(directiveId, {
      directiveId,
      itemEventId: null,
      itemId: null,
      responseEventId: null,
      responseId: null,
      callIds: [],
    });
    return true;
  }

  bindItem(directiveId: string, eventId: string, itemId: string): boolean {
    return this.updateOnce(directiveId, [eventId, itemId], (record) => ({
      ...record,
      itemEventId: eventId,
      itemId,
    }), (record) => record.itemEventId === null && record.itemId === null);
  }

  bindResponse(
    directiveId: string,
    eventId: string,
    responseId: string,
  ): boolean {
    return (
      this.bindResponseRequest(directiveId, eventId) &&
      this.bindResponseCreated(directiveId, eventId, responseId)
    );
  }

  bindResponseRequest(directiveId: string, eventId: string): boolean {
    return this.updateOnce(directiveId, [eventId], (record) => ({
      ...record,
      responseEventId: eventId,
    }), (record) =>
      record.itemEventId !== null &&
      record.responseEventId === null &&
      record.responseId === null,
    );
  }

  bindResponseCreated(
    directiveId: string,
    eventId: string,
    responseId: string,
  ): boolean {
    return this.updateOnce(directiveId, [eventId, responseId], (record) => ({
      ...record,
      responseId,
    }), (record) =>
      record.responseEventId === eventId &&
      record.responseId === null,
    );
  }

  bindCall(directiveId: string, responseId: string, callId: string): boolean {
    const record = this.records.get(directiveId);
    if (
      !record ||
      record.responseId !== responseId ||
      !validCorrelationId(callId) ||
      record.callIds.includes(callId)
    ) {
      return false;
    }
    this.records.set(directiveId, {
      ...record,
      callIds: [...record.callIds, callId],
    });
    return true;
  }

  hasCall(directiveId: string, responseId: string, callId: string): boolean {
    const record = this.records.get(directiveId);
    return (
      record?.responseId === responseId && record.callIds.includes(callId)
    );
  }

  get(directiveId: string): DirectiveCorrelation | undefined {
    const record = this.records.get(directiveId);
    return record ? { ...record, callIds: [...record.callIds] } : undefined;
  }

  private updateOnce(
    directiveId: string,
    ids: readonly string[],
    update: (record: DirectiveCorrelation) => DirectiveCorrelation,
    allowed: (record: DirectiveCorrelation) => boolean,
  ): boolean {
    const record = this.records.get(directiveId);
    if (!record || !ids.every(validCorrelationId) || !allowed(record)) {
      return false;
    }
    this.records.set(directiveId, update(record));
    return true;
  }
}

export function createDirectiveToolAuthorization(
  getState: () => PedagogyState,
  directive: InterventionDirective,
  correlation: DirectiveCorrelationLedger,
): {
  directiveId: string;
  sourceActionId: string | null;
  evidenceIds: readonly string[];
  authorize(call: {
    callId: string;
    name: ToolName;
    revision: number;
  }): boolean;
} {
  return {
    directiveId: directive.directiveId,
    sourceActionId: directive.sourceActionId,
    evidenceIds: [...directive.evidenceIds],
    authorize(call) {
      return (
        call.revision === directive.baseRevision &&
        guardDirective(getState(), directive, "before_tool", {
          toolName: call.name,
          callId: call.callId,
          correlation,
        }).ok
      );
    },
  };
}

function sourceIsCurrent(
  state: PedagogyState,
  sourceActionId: string | null,
  sourceRequestId: string | null,
): boolean {
  if ((sourceActionId === null) === (sourceRequestId === null)) return false;
  return sourceActionId !== null
    ? state.attemptState.lastActionId === sourceActionId &&
        state.attemptState.processedActionIds.includes(sourceActionId)
    : state.attemptState.lastHelpRequestId === sourceRequestId &&
        state.attemptState.helpRequestIds.includes(sourceRequestId!);
}

function transitionStatus(
  directive: InterventionDirective,
  current: DirectiveStatus,
  next: DirectiveStatus,
): DirectiveTransitionResult {
  if (
    !interventionDirectiveSchema.safeParse(directive).success ||
    directive.status !== current
  ) {
    return { ok: false, reason: "invalid_transition" };
  }
  return parsedTransition({ ...directive, status: next });
}

function parsedTransition(value: unknown): DirectiveTransitionResult {
  const parsed = interventionDirectiveSchema.safeParse(value);
  return parsed.success
    ? { ok: true, directive: freezeDirective(parsed.data) }
    : { ok: false, reason: "invalid_directive" };
}

function rejected(reason: DirectiveInvalidationReason): DirectiveGuardResult {
  return { ok: false, reason };
}

function validCorrelationId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

function freezeDirective(
  directive: ParsedInterventionDirective,
): InterventionDirective {
  return Object.freeze({
    ...directive,
    evidenceIds: Object.freeze([...directive.evidenceIds]),
    missingRelationKeys: Object.freeze([...directive.missingRelationKeys]),
    allowedTools: Object.freeze([...directive.allowedTools]),
  });
}

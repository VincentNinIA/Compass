import { z } from "zod";

import {
  decideInvarianceGeneralization,
} from "@/lib/pedagogy/policy";
import {
  selectIsFloorBusy,
  type PedagogyState,
} from "@/lib/pedagogy/state";
import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_POSITION_VERSION,
  INVARIANCE_SAMPLE_PARAMETERS,
  type InvarianceRunCompleted,
  type InvarianceRunResult,
} from "./contracts";

export const INVARIANCE_GENERALIZATION_DIRECTIVE_VERSION =
  "invariance_generalization_directive.v1" as const;
export const INVARIANCE_GENERALIZATION_GOAL =
  "generalize_invariance" as const;

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const SAFE_DIRECTIVE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const invarianceGeneralizationDirectiveSchema = z
  .object({
    schemaVersion: z.literal(INVARIANCE_GENERALIZATION_DIRECTIVE_VERSION),
    directiveId: z.string().regex(SAFE_DIRECTIVE_ID),
    kind: z.literal("completion"),
    epoch: z.number().int().nonnegative(),
    exerciseId: z.string().min(1).max(128),
    stepId: z.string().min(1).max(128),
    baseRevision: z.number().int().nonnegative(),
    snapshotHash: z.string().min(1).max(256),
    sourceActionId: z.string().min(1).max(128),
    sourceRunId: z.string().regex(SAFE_DIRECTIVE_ID),
    inputEvidenceIds: z
      .array(z.string().regex(SAFE_ID))
      .length(2)
      .refine(unique, "Input evidence IDs must be unique."),
    evidenceIds: z
      .array(z.string().regex(SAFE_ID))
      .length(5)
      .refine(unique, "Sample evidence IDs must be unique."),
    helpLevel: z.literal(1),
    goal: z.literal(INVARIANCE_GENERALIZATION_GOAL),
    allowedTools: z.array(z.never()).length(0),
    status: z.literal("draft"),
  })
  .strict();

type ParsedInvarianceGeneralizationDirective = z.infer<
  typeof invarianceGeneralizationDirectiveSchema
>;

export type InvarianceGeneralizationDirective = Omit<
  ParsedInvarianceGeneralizationDirective,
  "inputEvidenceIds" | "evidenceIds" | "allowedTools"
> &
  Readonly<{
    inputEvidenceIds: readonly [string, string];
    evidenceIds: readonly [string, string, string, string, string];
    allowedTools: readonly [];
  }>;

export type InvarianceVerbalizationContext = Readonly<{
  state: PedagogyState;
  currentRunId: string | null;
  currentRevision: number;
  inputEvidenceIds: readonly string[];
  evidenceIds: readonly string[];
}>;

export type InvarianceMeasurementRow = Readonly<{
  index: number;
  parameter: number;
  pa: number;
  pb: number;
  delta: number;
  pass: boolean;
  evidenceId: string;
}>;

export type InvarianceMeasurementsView = Readonly<{
  runId: string;
  revision: number;
  status:
    | "completed"
    | "not_passed"
    | "failed"
    | "cancelled"
    | "stale"
    | "invalid";
  passCount: number;
  expectedCount: 5;
  measurements: readonly InvarianceMeasurementRow[];
}>;

export type InvarianceVerbalizationTraceMarker =
  | "measurements_rendered"
  | "policy_evaluated"
  | "directive_ready";

export type InvarianceVerbalizationTrace = Readonly<{
  marker: InvarianceVerbalizationTraceMarker;
  sequence: number;
}>;

export type InvarianceVerbalizationResult = Readonly<{
  status: "ready" | "queued" | "silent" | "render_failed";
  reason:
    | "invariance_completed"
    | "floor_busy"
    | "higher_priority_intervention"
    | "invalid_or_duplicate_context"
    | "not_5_of_5"
    | "failed"
    | "cancelled"
    | "stale_authority"
    | "render_failed"
    | "directive_creation_failed"
    | "directive_callback_failed";
  directive: InvarianceGeneralizationDirective | null;
  view: InvarianceMeasurementsView;
  trace: readonly InvarianceVerbalizationTrace[];
}>;

export type InvarianceDirectiveGuardResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid_directive"
        | "stale_authority"
        | "floor_busy"
        | "higher_priority_intervention";
    };

export class InvarianceVerbalizationCoordinator {
  private readonly emittedRunIds = new Set<string>();
  private readonly emittedEvidenceSignatures = new Set<string>();
  private readonly inFlightRunIds = new Set<string>();
  private readonly inFlightEvidenceSignatures = new Set<string>();

  constructor(
    private readonly dependencies: Readonly<{
      getCurrentContext(): InvarianceVerbalizationContext;
      renderMeasurements(
        view: InvarianceMeasurementsView,
      ): void | Promise<void>;
      onDirectiveReady(
        directive: InvarianceGeneralizationDirective,
      ): void | Promise<void>;
      createDirectiveId(): string;
      decide?: typeof decideInvarianceGeneralization;
    }>,
  ) {}

  async receive(
    result: InvarianceRunResult,
  ): Promise<InvarianceVerbalizationResult> {
    const trace: InvarianceVerbalizationTrace[] = [];
    const evidenceSignature = resultEvidenceSignature(result);
    const duplicate =
      this.emittedRunIds.has(result.runId) ||
      this.emittedEvidenceSignatures.has(evidenceSignature) ||
      this.inFlightRunIds.has(result.runId) ||
      this.inFlightEvidenceSignatures.has(evidenceSignature);
    const initialContext = this.dependencies.getCurrentContext();
    const initialAssessment = assessResult(result, initialContext, duplicate);
    const initialView = createMeasurementsView(result, initialAssessment.reason);

    if (duplicate) {
      return silentResult(
        initialView,
        "invalid_or_duplicate_context",
        trace,
      );
    }

    this.inFlightRunIds.add(result.runId);
    this.inFlightEvidenceSignatures.add(evidenceSignature);
    try {
      try {
        await this.dependencies.renderMeasurements(initialView);
        mark(trace, "measurements_rendered");
      } catch {
        return Object.freeze({
          status: "render_failed",
          reason: "render_failed",
          directive: null,
          view: initialView,
          trace: Object.freeze([...trace]),
        });
      }

      if (!initialAssessment.eligible) {
        return silentResult(initialView, initialAssessment.reason, trace);
      }

      const currentContext = this.dependencies.getCurrentContext();
      const currentAssessment = assessResult(result, currentContext, false);
      if (!currentAssessment.eligible) {
        const staleView = createMeasurementsView(result, currentAssessment.reason);
        if (staleView.status === "stale") {
          try {
            await this.dependencies.renderMeasurements(staleView);
            mark(trace, "measurements_rendered");
          } catch {
            // The acknowledged first render remains available; stale authority
            // still prevents directive creation.
          }
        }
        return silentResult(staleView, currentAssessment.reason, trace);
      }

      const decide = this.dependencies.decide ?? decideInvarianceGeneralization;
      const policy = decide(currentContext.state, {
        runId: result.runId,
        revision: result.revision,
        inputEvidenceIds: result.inputEvidenceIds,
        evidenceIds: result.evidenceIds,
        duplicate: false,
      });
      mark(trace, "policy_evaluated");
      if (policy.type === "queue") {
        return Object.freeze({
          status: "queued",
          reason: policy.reason,
          directive: null,
          view: initialView,
          trace: Object.freeze([...trace]),
        });
      }
      if (policy.type === "silent") {
        return silentResult(initialView, policy.reason, trace);
      }

      const directive = materializeInvarianceGeneralizationDirective(
        currentContext,
        result as InvarianceRunCompleted,
        this.dependencies.createDirectiveId,
      );
      if (!directive) {
        return silentResult(initialView, "directive_creation_failed", trace);
      }
      const guard = guardInvarianceGeneralizationDirective(
        this.dependencies.getCurrentContext(),
        directive,
      );
      if (!guard.ok) {
        return silentResult(
          createMeasurementsView(result, "stale_authority"),
          guard.reason === "floor_busy" ||
            guard.reason === "higher_priority_intervention"
            ? guard.reason
            : "stale_authority",
          trace,
        );
      }

      this.emittedRunIds.add(result.runId);
      this.emittedEvidenceSignatures.add(evidenceSignature);
      mark(trace, "directive_ready");
      try {
        await this.dependencies.onDirectiveReady(directive);
      } catch {
        return Object.freeze({
          status: "silent",
          reason: "directive_callback_failed",
          directive,
          view: initialView,
          trace: Object.freeze([...trace]),
        });
      }
      return Object.freeze({
        status: "ready",
        reason: policy.reason,
        directive,
        view: initialView,
        trace: Object.freeze([...trace]),
      });
    } finally {
      this.inFlightRunIds.delete(result.runId);
      this.inFlightEvidenceSignatures.delete(evidenceSignature);
    }
  }
}

export function guardInvarianceGeneralizationDirective(
  context: InvarianceVerbalizationContext,
  directive: InvarianceGeneralizationDirective,
): InvarianceDirectiveGuardResult {
  if (!invarianceGeneralizationDirectiveSchema.safeParse(directive).success) {
    return { ok: false, reason: "invalid_directive" };
  }
  if (
    directive.epoch !== context.state.epoch ||
    directive.exerciseId !== context.state.exerciseId ||
    directive.stepId !== context.state.stepId ||
    directive.baseRevision !== context.state.revision ||
    directive.snapshotHash !== context.state.studentSnapshotHash ||
    directive.sourceActionId !== context.state.attemptState.lastActionId ||
    directive.sourceRunId !== context.currentRunId ||
    directive.baseRevision !== context.currentRevision ||
    !sameIds(directive.inputEvidenceIds, context.inputEvidenceIds) ||
    !sameIds(directive.evidenceIds, context.evidenceIds)
  ) {
    return { ok: false, reason: "stale_authority" };
  }
  if (context.state.activeResponse !== null) {
    return { ok: false, reason: "higher_priority_intervention" };
  }
  if (
    context.state.pendingIntervention !== null &&
    context.state.pendingIntervention.directiveId !== directive.directiveId
  ) {
    return { ok: false, reason: "higher_priority_intervention" };
  }
  if (selectIsFloorBusy(context.state)) {
    return { ok: false, reason: "floor_busy" };
  }
  const stateWithoutSelfPending =
    context.state.pendingIntervention?.directiveId === directive.directiveId
      ? { ...context.state, pendingIntervention: null }
      : context.state;
  const policy = decideInvarianceGeneralization(stateWithoutSelfPending, {
    runId: directive.sourceRunId,
    revision: directive.baseRevision,
    inputEvidenceIds: directive.inputEvidenceIds,
    evidenceIds: directive.evidenceIds,
    duplicate: false,
  });
  if (policy.type !== "speak") {
    return {
      ok: false,
      reason:
        policy.reason === "floor_busy"
          ? "floor_busy"
          : policy.reason === "higher_priority_intervention"
            ? "higher_priority_intervention"
            : "stale_authority",
    };
  }
  return { ok: true };
}

function materializeInvarianceGeneralizationDirective(
  context: InvarianceVerbalizationContext,
  result: InvarianceRunCompleted,
  createId: () => string,
): InvarianceGeneralizationDirective | null {
  const sourceActionId = context.state.attemptState.lastActionId;
  if (!sourceActionId) return null;
  let directiveId: string;
  try {
    directiveId = createId();
  } catch {
    return null;
  }
  const parsed = invarianceGeneralizationDirectiveSchema.safeParse({
    schemaVersion: INVARIANCE_GENERALIZATION_DIRECTIVE_VERSION,
    directiveId,
    kind: "completion",
    epoch: context.state.epoch,
    exerciseId: context.state.exerciseId,
    stepId: context.state.stepId,
    baseRevision: result.revision,
    snapshotHash: context.state.studentSnapshotHash,
    sourceActionId,
    sourceRunId: result.runId,
    inputEvidenceIds: [...result.inputEvidenceIds],
    evidenceIds: [...result.evidenceIds],
    helpLevel: 1,
    goal: INVARIANCE_GENERALIZATION_GOAL,
    allowedTools: [],
    status: "draft",
  });
  return parsed.success ? freezeDirective(parsed.data) : null;
}

type AssessmentReason =
  | "invariance_completed"
  | "invalid_or_duplicate_context"
  | "not_5_of_5"
  | "failed"
  | "cancelled"
  | "stale_authority";

type Assessment = Readonly<{
  eligible: boolean;
  reason: AssessmentReason;
}>;

function assessResult(
  result: InvarianceRunResult,
  context: InvarianceVerbalizationContext,
  duplicate: boolean,
): Assessment {
  if (duplicate) {
    return { eligible: false, reason: "invalid_or_duplicate_context" };
  }
  if (result.status === "failed") {
    return { eligible: false, reason: "failed" };
  }
  if (result.status === "cancelled") {
    return { eligible: false, reason: "cancelled" };
  }
  if (!validCompletedResult(result)) {
    return { eligible: false, reason: "invalid_or_duplicate_context" };
  }
  if (!result.pass || result.samples.some(({ pass }) => !pass)) {
    return { eligible: false, reason: "not_5_of_5" };
  }
  if (!contextMatchesResult(context, result)) {
    return { eligible: false, reason: "stale_authority" };
  }
  return { eligible: true, reason: "invariance_completed" };
}

function validCompletedResult(result: InvarianceRunCompleted): boolean {
  return (
    SAFE_DIRECTIVE_ID.test(result.runId) &&
    Number.isSafeInteger(result.revision) &&
    result.revision >= 0 &&
    result.inputEvidenceIds.length === 2 &&
    unique(result.inputEvidenceIds) &&
    result.inputEvidenceIds.every((id) => SAFE_ID.test(id)) &&
    result.samples.length === 5 &&
    result.evidenceIds.length === 5 &&
    unique(result.evidenceIds) &&
    result.evidenceIds.every((id) => SAFE_ID.test(id)) &&
    result.samples.every((sample, index) => {
      const expectedParameter = INVARIANCE_SAMPLE_PARAMETERS[index];
      return (
        sample.id === result.evidenceIds[index] &&
        sample.index === index &&
        Object.is(sample.parameter, expectedParameter) &&
        sample.revision === result.revision &&
        sample.coords.length === 2 &&
        sample.coords.every(Number.isFinite) &&
        Number.isFinite(sample.pa) &&
        sample.pa >= 0 &&
        Number.isFinite(sample.pb) &&
        sample.pb >= 0 &&
        Number.isFinite(sample.delta) &&
        sample.delta >= 0 &&
        Object.is(sample.delta, Math.abs(sample.pa - sample.pb)) &&
        Object.is(sample.tolerance, INVARIANCE_DISTANCE_TOLERANCE) &&
        sample.toleranceVersion === INVARIANCE_DISTANCE_TOLERANCE_VERSION &&
        sample.positionVersion === INVARIANCE_POSITION_VERSION &&
        sample.pass === sample.delta <= sample.tolerance
      );
    }) &&
    result.pass === result.samples.every(({ pass }) => pass)
  );
}

function contextMatchesResult(
  context: InvarianceVerbalizationContext,
  result: InvarianceRunCompleted,
): boolean {
  return (
    context.currentRunId === result.runId &&
    context.currentRevision === result.revision &&
    context.state.revision === result.revision &&
    sameIds(context.inputEvidenceIds, result.inputEvidenceIds) &&
    sameIds(context.evidenceIds, result.evidenceIds) &&
    unique(context.inputEvidenceIds) &&
    unique(context.evidenceIds)
  );
}

function createMeasurementsView(
  result: InvarianceRunResult,
  reason: InvarianceVerbalizationResult["reason"],
): InvarianceMeasurementsView {
  const measurements =
    result.status === "completed" && Array.isArray(result.samples)
      ? result.samples.map((sample) =>
          Object.freeze({
            index: sample.index,
            parameter: sample.parameter,
            pa: sample.pa,
            pb: sample.pb,
            delta: sample.delta,
            pass: sample.pass,
            evidenceId: sample.id,
          }),
        )
      : [];
  const passCount = measurements.filter(({ pass }) => pass).length;
  let status: InvarianceMeasurementsView["status"];
  if (reason === "failed") status = "failed";
  else if (reason === "cancelled") status = "cancelled";
  else if (reason === "stale_authority") status = "stale";
  else if (reason === "not_5_of_5") status = "not_passed";
  else if (reason === "invariance_completed" || reason === "floor_busy") {
    status = "completed";
  } else status = "invalid";
  return Object.freeze({
    runId: result.runId,
    revision: result.revision,
    status,
    passCount,
    expectedCount: 5,
    measurements: Object.freeze(measurements),
  });
}

function silentResult(
  view: InvarianceMeasurementsView,
  reason: Exclude<InvarianceVerbalizationResult["reason"], "render_failed">,
  trace: readonly InvarianceVerbalizationTrace[],
): InvarianceVerbalizationResult {
  return Object.freeze({
    status: "silent",
    reason,
    directive: null,
    view,
    trace: Object.freeze([...trace]),
  });
}

function resultEvidenceSignature(result: InvarianceRunResult): string {
  return result.status === "completed"
    ? [...result.evidenceIds].sort().join("|")
    : `status:${result.status}:${result.runId}`;
}

function freezeDirective(
  directive: ParsedInvarianceGeneralizationDirective,
): InvarianceGeneralizationDirective {
  return Object.freeze({
    ...directive,
    inputEvidenceIds: Object.freeze([...directive.inputEvidenceIds]) as readonly [
      string,
      string,
    ],
    evidenceIds: Object.freeze([...directive.evidenceIds]) as readonly [
      string,
      string,
      string,
      string,
      string,
    ],
    allowedTools: Object.freeze([]) as readonly [],
  });
}

function mark(
  trace: InvarianceVerbalizationTrace[],
  marker: InvarianceVerbalizationTraceMarker,
): void {
  trace.push(Object.freeze({ marker, sequence: trace.length + 1 }));
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  );
}

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

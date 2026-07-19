import type { SceneRegistry } from "@/lib/geogebra/scene";
import { stableHash } from "@/lib/geogebra/snapshot";
import type {
  GatewayCall,
  GatewayContext,
  GatewayEnvelope,
  GatewayErrorCode,
  ToolGatewayExecutor,
} from "@/lib/tools/gateway";
import type { GeoGebraApi, SceneObject } from "@/types/geogebra";

import {
  isGeometryInvestigationActionV1,
  parseGeometryActionArgumentsV1,
  type GeometryActionArgumentsV1,
  type GeometryActionArgumentsValueV1,
  type GeometryInvestigationActionV1,
} from "./actions";
import { GeometryActionError } from "./action-error";
import {
  authorizeGeometryActionV1,
  type GeometryActionAuthorityV1,
} from "./authority";
import { classifyOrderedQuadrilateralV1 } from "./classifier";
import type {
  GeometryInvestigationV1,
  GeometryWorldObjectV2,
  GeometryWorldV2,
} from "./contracts";
import { GeometryEvidenceCaptureV1 } from "./contracts";
import type { GeometryCheckpointControllerV1 } from "./checkpoint-v2";
import type { GeometryEvidenceStoreV1 } from "./evidence-store";
import type { GeometryPrivilegedConsentStoreV1 } from "./privileged-consent";
import type { GeometryReplayControllerV1 } from "./replay";
import { evaluateGeometryRelationV1 } from "./engine";
import type { GeometryPointV1 } from "./numeric";
import {
  GeometryUiEffectsV1,
  type GeometryLogicalBoxV1,
} from "./ui-effects";

export const GEOMETRY_ACTION_BUDGETS_V1 = Object.freeze({
  readsPerTurn: 4,
  reversibleUiPerTurn: 2,
  mutationsPerTurn: 1,
});

type Usage = { reads: number; ui: number; mutations: number };
type ActionCategory = keyof Usage;

type ActionResult = Readonly<{
  data: unknown;
  evidenceIds?: readonly string[];
  revision?: number;
}>;

export type GeometryActionGatewayDependenciesV1 = Readonly<{
  api: GeoGebraApi;
  activity: GeometryInvestigationV1;
  registry: SceneRegistry;
  getAuthority(): GeometryActionAuthorityV1;
  getWorld(): GeometryWorldV2;
  uiEffects?: GeometryUiEffectsV1;
  getInteractionGeneration?: () => number;
  freezeMutations?: (reason: string) => void;
  onAssistantMutation?: (detail: Readonly<{
    action: "create_geometry_variation";
    point: "A" | "B" | "C" | "D";
    target: "convex" | "concave" | "crossed";
    from: GeometryPointV1;
    to: GeometryPointV1;
  }>) => void;
  evidenceStore?: GeometryEvidenceStoreV1;
  checkpoints?: GeometryCheckpointControllerV1;
  privilegedTokens?: GeometryPrivilegedConsentStoreV1;
  replay?: GeometryReplayControllerV1;
  getEvidenceActor?: () => "learner" | "assistant_demo";
  createThumbnail?: () => Promise<string | undefined>;
  nextRestoreAuthority?: () => Readonly<{
    activityId: string;
    epoch: number;
    revision: number;
  }>;
  onRestoredWorld?: (world: GeometryWorldV2) => void;
  now?: () => number;
}>;

const ACTION_CATEGORY = Object.freeze({
  inspect_geometry_workspace: "reads",
  activate_geometry_tool: "ui",
  highlight_geometry_objects: "ui",
  preview_geometry_variation: "ui",
  initialize_geometry_activity: "mutations",
  create_geometry_variation: "mutations",
  classify_geometry_configuration: "reads",
  check_geometry_relation: "reads",
  focus_geometry_view: "ui",
  capture_geometry_evidence: "reads",
  restore_geometry_checkpoint: "mutations",
  demonstrate_geometry_step: "mutations",
} satisfies Record<GeometryInvestigationActionV1, ActionCategory>);

export class GeometryActionGatewayV1 implements ToolGatewayExecutor {
  private readonly results = new Map<string, Promise<GatewayEnvelope>>();
  private readonly usage = new Map<string, Usage>();
  private readonly uiEffects: GeometryUiEffectsV1;
  private mutationsFrozen = false;

  constructor(private readonly dependencies: GeometryActionGatewayDependenciesV1) {
    this.uiEffects =
      dependencies.uiEffects ??
      new GeometryUiEffectsV1(dependencies.api, {
        locale: dependencies.activity.locale,
        freezeMutations: (reason) => this.freeze(reason),
      });
  }

  execute(call: GatewayCall, context: GatewayContext): Promise<GatewayEnvelope> {
    const cached = this.results.get(call.callId);
    if (cached) return cached;
    const pending = this.executeOnce(call, context);
    this.results.set(call.callId, pending);
    return pending;
  }

  cleanupUi(): { ok: boolean; restored: string[] } {
    return this.uiEffects.cleanup();
  }

  cancelEffects(
    reason:
      | "student_action"
      | "student_speech"
      | "timeout"
      | "session_stop" = "timeout",
  ): void {
    this.dependencies.replay?.stop({
      preserveLearnerWorld:
        reason === "student_action" || reason === "student_speech",
    });
    this.cleanupUi();
  }

  isMutationFrozen(): boolean {
    return this.mutationsFrozen;
  }

  private async executeOnce(
    call: GatewayCall,
    context: GatewayContext,
  ): Promise<GatewayEnvelope> {
    if (!validCallId(call.callId) || !isGeometryInvestigationActionV1(call.name)) {
      return failure(call.callId, context.revision, "unknown_tool", "Action is not allowed.");
    }
    const action = call.name;
    const parsed = parseGeometryActionArgumentsV1(action, call.arguments);
    if (!parsed.ok) {
      return failure(call.callId, context.revision, "invalid_arguments", parsed.message);
    }
    const arguments_ = parsed.value as GeometryActionArgumentsValueV1;
    const authoritySource = this.dependencies.getAuthority();
    const beforeAuthority = {
      ...authoritySource,
      attemptedVariationTargets: [
        ...authoritySource.attemptedVariationTargets,
      ],
      attemptedDemonstrationStepIds: [
        ...(authoritySource.attemptedDemonstrationStepIds ?? []),
      ],
    };
    const correlation = validateGatewayCorrelation(arguments_, context);
    if (!correlation.ok) {
      return failure(call.callId, context.revision, correlation.code, correlation.message);
    }
    const authority = authorizeGeometryActionV1(
      action,
      arguments_,
      this.dependencies.activity,
      beforeAuthority,
    );
    if (!authority.ok) {
      return failure(call.callId, context.revision, authority.code, authority.message);
    }
    if (context.signal?.aborted || !(context.isAuthorityCurrent?.() ?? true)) {
      return failure(call.callId, context.revision, "cancelled", "Action was cancelled.");
    }
    if (
      this.mutationsFrozen &&
      ACTION_CATEGORY[action] === "mutations"
    ) {
      return failure(
        call.callId,
        context.revision,
        "mutation_frozen",
        "Geometry mutations are frozen after an unverifiable rollback.",
      );
    }

    const consent = this.validateConsentBeforeApi(action, arguments_);
    if (!consent.ok) {
      return failure(call.callId, context.revision, consent.code, consent.message);
    }
    if (!this.consumeBudget(action, context.turnId)) {
      return failure(
        call.callId,
        context.revision,
        "budget_exceeded",
        "The per-turn action budget is exhausted.",
      );
    }

    const interactionGeneration = this.dependencies.getInteractionGeneration?.();
    try {
      const result = await this.run(action, parsed.value, context);
      if (
        action === "restore_geometry_checkpoint" ||
        action === "demonstrate_geometry_step"
      ) {
        if (
          context.signal?.aborted ||
          interactionGeneration !== this.dependencies.getInteractionGeneration?.()
        ) {
          throw new GeometryActionError(
            "rejected_stale",
            "Privileged action was superseded by a learner interaction.",
          );
        }
      } else {
        this.assertStillCurrent(context, beforeAuthority, interactionGeneration);
      }
      return {
        ok: true,
        callId: call.callId,
        revision: result.revision ?? context.revision,
        data: result.data,
        evidenceIds: [...(result.evidenceIds ?? [])],
      };
    } catch (error) {
      if (
        ACTION_CATEGORY[action] === "ui" &&
        (context.signal?.aborted ||
          isAbortError(error) ||
          (error instanceof GeometryActionError &&
            ["cancelled", "rejected_stale", "stale_revision"].includes(error.code)))
      ) {
        this.cleanupUi();
      }
      if (context.signal?.aborted || isAbortError(error)) {
        return failure(call.callId, context.revision, "cancelled", "Action was cancelled.");
      }
      if (error instanceof GeometryActionError) {
        return failure(call.callId, context.revision, error.code, error.message);
      }
      return failure(
        call.callId,
        context.revision,
        "execution_failed",
        "Geometry action failed safely.",
      );
    }
  }

  private run<Name extends GeometryInvestigationActionV1>(
    action: Name,
    arguments_: GeometryActionArgumentsV1[Name],
    context: GatewayContext,
  ): Promise<ActionResult> | ActionResult {
    switch (action) {
      case "inspect_geometry_workspace":
        return this.inspect(
          arguments_ as GeometryActionArgumentsV1["inspect_geometry_workspace"],
        );
      case "activate_geometry_tool":
        return {
          data: this.uiEffects.activateTool(
            (arguments_ as GeometryActionArgumentsV1["activate_geometry_tool"]).tool,
          ),
        };
      case "highlight_geometry_objects": {
        const value =
          arguments_ as GeometryActionArgumentsV1["highlight_geometry_objects"];
        return {
          data: this.uiEffects.highlight(value.names, value.style, value.durationMs),
        };
      }
      case "preview_geometry_variation":
        return this.previewVariation(
          arguments_ as GeometryActionArgumentsV1["preview_geometry_variation"],
        );
      case "initialize_geometry_activity":
        return this.initialize(
          arguments_ as GeometryActionArgumentsV1["initialize_geometry_activity"],
          context,
        );
      case "create_geometry_variation":
        return this.createVariation(
          arguments_ as GeometryActionArgumentsV1["create_geometry_variation"],
          context,
        );
      case "classify_geometry_configuration":
        return this.classify(
          arguments_ as GeometryActionArgumentsV1["classify_geometry_configuration"],
        );
      case "check_geometry_relation":
        return this.checkRelation(
          arguments_ as GeometryActionArgumentsV1["check_geometry_relation"],
        );
      case "focus_geometry_view":
        return this.focus(
          arguments_ as GeometryActionArgumentsV1["focus_geometry_view"],
        );
      case "capture_geometry_evidence":
        return this.captureEvidence(
          arguments_ as GeometryActionArgumentsV1["capture_geometry_evidence"],
          context,
        );
      case "restore_geometry_checkpoint":
        return this.restoreCheckpoint(
          arguments_ as GeometryActionArgumentsV1["restore_geometry_checkpoint"],
          context,
        );
      case "demonstrate_geometry_step":
        return this.demonstrate(
          arguments_ as GeometryActionArgumentsV1["demonstrate_geometry_step"],
          context,
        );
    }
  }

  private inspect(
    arguments_: GeometryActionArgumentsV1["inspect_geometry_workspace"],
  ): ActionResult {
    const world = this.currentWorld(arguments_);
    const mission = this.dependencies.activity.missions.find(
      ({ id }) => id === this.dependencies.getAuthority().missionId,
    );
    const requestedNames =
      arguments_.scope === "all"
        ? world.objects.map(({ name }) => name)
        : arguments_.scope === "mission"
          ? missionObjectNames(this.dependencies.activity, mission?.requiredEvidence ?? [])
          : arguments_.names;
    const names = [...new Set([...requestedNames, ...arguments_.names])].slice(0, 40);
    const byName = new Map(world.objects.map((object) => [object.name, object]));
    const missing = arguments_.names.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      throw new GeometryActionError(
        "object_missing",
        `Requested objects are missing: ${missing.join(", ")}.`,
      );
    }
    const selected = names.flatMap((name) => {
      const object = byName.get(name);
      return object ? [object] : [];
    });
    const selectedSet = new Set(selected.map(({ name }) => name));
    const facts = world.facts
      .filter(({ objects }) => objects.every((name) => selectedSet.has(name)))
      .slice(0, 32);
    return {
      data: {
        schemaVersion: world.schemaVersion,
        activityId: world.activityId,
        epoch: world.epoch,
        revision: world.revision,
        snapshotHash: world.snapshotHash,
        scope: arguments_.scope,
        objects: selected,
        facts,
        selection: arguments_.scope === "selection" ? [...arguments_.names] : [],
        objectCount: world.objectCount,
        truncated: world.truncated || selected.length < names.length,
      },
    };
  }

  private classify(
    arguments_: GeometryActionArgumentsV1["classify_geometry_configuration"],
  ): ActionResult {
    const world = this.currentWorld(arguments_);
    const points = orderedPoints(world, arguments_.labels);
    const classification = classifyOrderedQuadrilateralV1(points);
    if (classification.type === "degenerate") {
      throw new GeometryActionError(
        "indeterminate",
        "The ordered polygon is degenerate at the current tolerance.",
      );
    }
    const definition = this.dependencies.activity.relationDefinitions.find(
      (candidate) =>
        candidate.relation === "configuration_type" &&
        candidate.expected === classification.type &&
        sameNames(candidate.objects, arguments_.labels),
    );
    if (!definition) {
      throw new GeometryActionError(
        "invalid_polygon",
        "This ordered polygon is not declared by the activity.",
      );
    }
    const evaluation = evaluateGeometryRelationV1(world, definition);
    if (!evaluation.fact || !evaluation.configuration) {
      throw new GeometryActionError(
        "indeterminate",
        "The configuration could not be evidenced deterministically.",
      );
    }
    return {
      data: {
        labels: [...arguments_.labels],
        ...evaluation.configuration,
        tolerance: classification.tolerance,
        evidenceId: evaluation.fact.id,
      },
      evidenceIds: [evaluation.fact.id],
    };
  }

  private checkRelation(
    arguments_: GeometryActionArgumentsV1["check_geometry_relation"],
  ): ActionResult {
    const world = this.currentWorld(arguments_);
    const definition = this.dependencies.activity.relationDefinitions.find(
      ({ id }) => id === arguments_.relationId,
    );
    if (!definition) {
      throw new GeometryActionError(
        "action_not_allowed",
        "The relation is not declared by this activity.",
      );
    }
    const evaluation = evaluateGeometryRelationV1(world, definition);
    if (evaluation.status === "unknown" || !evaluation.fact) {
      return {
        data: {
          relationId: definition.id,
          relation: definition.relation,
          status: "unknown",
          reason: evaluation.reason ?? "indeterminate",
          objects: [...definition.objects],
          revision: world.revision,
          snapshotHash: world.snapshotHash,
        },
      };
    }
    return {
      data: {
        relationId: definition.id,
        relation: definition.relation,
        status: evaluation.status,
        pass: evaluation.fact.pass,
        observed: [...evaluation.fact.observed],
        tolerance: evaluation.fact.tolerance,
        toleranceVersion: evaluation.fact.toleranceVersion,
        objects: [...definition.objects],
        revision: world.revision,
        snapshotHash: world.snapshotHash,
        evidenceId: evaluation.fact.id,
        componentFactIds: [...(evaluation.componentFactIds ?? [])],
      },
      evidenceIds: [evaluation.fact.id, ...(evaluation.componentFactIds ?? [])],
    };
  }

  private focus(
    arguments_: GeometryActionArgumentsV1["focus_geometry_view"],
  ): ActionResult {
    const world = this.currentWorld(arguments_);
    const box =
      arguments_.target.kind === "box"
        ? arguments_.target
        : boxForWorldObjects(world, arguments_.target.names);
    return { data: this.uiEffects.focus(box, arguments_.margin) };
  }

  private initialize(
    arguments_: GeometryActionArgumentsV1["initialize_geometry_activity"],
    context: GatewayContext,
  ): ActionResult {
    const api = this.dependencies.api;
    if (!api.deleteObject) {
      throw new GeometryActionError(
        "workspace_unavailable",
        "GeoGebra rollback support is unavailable.",
      );
    }
    const existing = api.getAllObjectNames?.() ?? [];
    if (existing.length > 0) {
      throw new GeometryActionError(
        "invalid_phase",
        "The initialization canvas is not empty.",
      );
    }
    const scaffoldCommands = [
      ...this.dependencies.activity.scaffold.freePoints.map(({ label, x, y }) => ({
        name: label,
        kind: "point" as const,
        command: `${label}=(${finiteCommandNumber(x)},${finiteCommandNumber(y)})`,
      })),
      ...this.dependencies.activity.scaffold.edges.map(({ from, to }) => ({
        name: `${from}${to}`,
        kind: "segment" as const,
        command: `${from}${to}=Segment(${from},${to})`,
      })),
    ];
    const created: string[] = [];
    try {
      for (const object of scaffoldCommands) {
        this.assertContextAuthority(context);
        if (api.exists(object.name) || !api.evalCommand(object.command)) {
          throw new GeometryActionError(
            "execution_failed",
            `GeoGebra rejected scaffold object ${object.name}.`,
          );
        }
        created.push(object.name);
      }
      const invalid = created.filter(
        (name) => !api.exists(name) || !api.isDefined(name),
      );
      if (invalid.length > 0) {
        throw new GeometryActionError(
          "execution_failed",
          `Scaffold verification failed for ${invalid.join(", ")}.`,
        );
      }
      for (const object of scaffoldCommands) {
        api.setFixed?.(
          object.name,
          object.kind === "segment",
          object.kind === "point",
        );
        api.setLabelVisible(object.name, true);
      }
      this.assertContextAuthority(context);
    } catch (error) {
      if (!rollbackCreated(api, created)) {
        this.freeze("Scaffold initialization rollback could not be verified.");
        throw new GeometryActionError(
          "rollback_failed",
          "Scaffold initialization rollback could not be verified.",
        );
      }
      throw error;
    }
    const registry = scaffoldCommands.map(
      ({ name, kind }) =>
        ({ name, owner: "scaffold", kind }) satisfies SceneObject,
    );
    this.dependencies.registry.replace(registry);
    const hash = stableHash(
      JSON.stringify({
        version: arguments_.scaffoldVersion,
        commands: scaffoldCommands,
      }),
    );
    return {
      data: {
        status: "initialized",
        scaffoldVersion: arguments_.scaffoldVersion,
        baseline: {
          hash,
          inventory: created,
          registry,
        },
        checkpoint: {
          version: "geometry-scaffold-checkpoint.v1",
          hash,
          commands: scaffoldCommands.map(({ name, command }) => ({ name, command })),
        },
        evidence: {
          kind: "activity_initialized",
          activityId: arguments_.activityId,
          epoch: arguments_.epoch,
          revision: arguments_.revision,
          snapshotHash: hash,
        },
      },
    };
  }

  private createVariation(
    arguments_: GeometryActionArgumentsV1["create_geometry_variation"],
    context: GatewayContext,
  ): ActionResult {
    const api = this.dependencies.api;
    const world = this.currentWorld(arguments_);
    const points = pointMap(world, ["A", "B", "C", "D"]);
    if (
      !api.setCoords ||
      !api.getXcoord ||
      !api.getYcoord ||
      api.isIndependent?.(arguments_.movingPoint) !== true ||
      api.isMoveable?.(arguments_.movingPoint) !== true
    ) {
      throw new GeometryActionError(
        "invalid_authority",
        "The requested scaffold point is not independently moveable.",
      );
    }
    const from = points[arguments_.movingPoint];
    const to = deterministicVariationPoint(
      points,
      arguments_.movingPoint,
      arguments_.target,
    );
    if (!to) {
      throw new GeometryActionError(
        "indeterminate",
        "No deterministic safe coordinate reaches the requested configuration.",
      );
    }
    const generation = this.dependencies.getInteractionGeneration?.();
    try {
      this.assertContextAuthority(context);
      api.setCoords(arguments_.movingPoint, to.x, to.y);
      const actual = readPoint(api, arguments_.movingPoint);
      if (!actual || !samePoint(actual, to)) {
        throw new GeometryActionError(
          "execution_failed",
          "GeoGebra did not apply the deterministic variation.",
        );
      }
      const afterPoints = {
        ...points,
        [arguments_.movingPoint]: actual,
      };
      const classification = classifyOrderedQuadrilateralV1([
        afterPoints.A,
        afterPoints.B,
        afterPoints.C,
        afterPoints.D,
      ]);
      if (classification.type !== arguments_.target) {
        throw new GeometryActionError(
          "indeterminate",
          "The requested target configuration was not reached.",
        );
      }
      if (
        generation !== this.dependencies.getInteractionGeneration?.() ||
        context.signal?.aborted ||
        !(context.isAuthorityCurrent?.() ?? true) ||
        this.dependencies.getAuthority().activityId !== arguments_.activityId ||
        this.dependencies.getAuthority().epoch !== arguments_.epoch
      ) {
        throw new GeometryActionError(
          "rejected_stale",
          "A learner interaction superseded the assistant variation.",
        );
      }
      this.dependencies.onAssistantMutation?.({
        action: "create_geometry_variation",
        point: arguments_.movingPoint,
        target: arguments_.target,
        from,
        to,
      });
      this.uiEffects.showVariationMovement(
        arguments_.movingPoint,
        arguments_.target,
        from,
        to,
        true,
      );
      const currentAuthority = this.dependencies.getAuthority();
      return {
        revision: Math.max(arguments_.revision + 1, currentAuthority.revision),
        data: {
          status: "applied",
          target: arguments_.target,
          configuration: classification.type,
          orientation: classification.orientation,
          intersections: [...classification.intersections],
          toleranceVersion: classification.toleranceVersion,
          movingPoint: arguments_.movingPoint,
          coordinateStrategy: "deterministic-grid-v1",
          actor: "assistant",
          revision: Math.max(arguments_.revision + 1, currentAuthority.revision),
          evidenceCreated: false,
        },
      };
    } catch (error) {
      if (!rollbackPoint(api, arguments_.movingPoint, from)) {
        this.freeze("Variation rollback could not be verified.");
        throw new GeometryActionError(
          "rollback_failed",
          "Variation rollback could not be verified.",
        );
      }
      throw error;
    }
  }

  private previewVariation(
    arguments_: GeometryActionArgumentsV1["preview_geometry_variation"],
  ): ActionResult {
    const api = this.dependencies.api;
    const world = this.currentWorld(arguments_);
    const points = pointMap(world, ["A", "B", "C", "D"]);
    if (
      api.isIndependent?.(arguments_.movingPoint) !== true ||
      api.isMoveable?.(arguments_.movingPoint) !== true
    ) {
      throw new GeometryActionError(
        "invalid_authority",
        "The requested scaffold point is not independently moveable.",
      );
    }
    const from = points[arguments_.movingPoint];
    const to = deterministicVariationPoint(
      points,
      arguments_.movingPoint,
      arguments_.target,
    );
    if (!to) {
      throw new GeometryActionError(
        "indeterminate",
        "No deterministic safe coordinate reaches the requested configuration.",
      );
    }
    return {
      data: this.uiEffects.showVariationMovement(
        arguments_.movingPoint,
        arguments_.target,
        from,
        to,
        false,
      ),
    };
  }

  private async captureEvidence(
    arguments_: GeometryActionArgumentsV1["capture_geometry_evidence"],
    context: GatewayContext,
  ): Promise<ActionResult> {
    const store = this.dependencies.evidenceStore;
    const checkpoints = this.dependencies.checkpoints;
    const actor = this.dependencies.getEvidenceActor?.();
    if (!store || !checkpoints || !actor) {
      throw new GeometryActionError(
        "action_not_allowed",
        "Evidence capture is not configured for this runtime.",
      );
    }
    const world = this.currentWorld(arguments_);
    const mission = this.dependencies.activity.missions.find(
      ({ id }) => id === arguments_.missionId,
    );
    if (
      !mission ||
      mission.id !== this.dependencies.getAuthority().missionId ||
      !sameSet(arguments_.requiredFactIds, mission.requiredEvidence) ||
      world.configuration?.type !== arguments_.configuration
    ) {
      throw new GeometryActionError(
        "invalid_arguments",
        "Capture mission, configuration or required facts do not match the activity.",
      );
    }
    const facts = arguments_.requiredFactIds.map((id) =>
      world.facts.find((fact) => fact.id === id),
    );
    if (
      facts.some(
        (fact) =>
          !fact ||
          !fact.pass ||
          fact.epoch !== world.epoch ||
          fact.revision !== world.revision ||
          fact.snapshotHash !== world.snapshotHash,
      )
    ) {
      throw new GeometryActionError(
        "snapshot_unstable",
        "Required evidence is missing, failing or stale.",
      );
    }
    const suffix = captureSuffix(world.snapshotHash);
    const captureId = `capture_${mission.id}_${arguments_.configuration}_e${world.epoch}_r${world.revision}_${suffix}`.slice(
      0,
      80,
    );
    const existing = store.getCapture(captureId);
    if (existing) {
      return {
        data: {
          status: "existing",
          capture: existing,
          thumbnailStored: false,
          quota: store.report(world.activityId),
        },
        evidenceIds: [existing.id, ...existing.factIds],
      };
    }
    this.assertContextAuthority(context);
    const createdAt = this.dependencies.now?.() ?? Date.now();
    const checkpointId = `checkpoint_${mission.id}_${arguments_.configuration}_e${world.epoch}_r${world.revision}_${suffix}`.slice(
      0,
      80,
    );
    const captured = await checkpoints.capture({
      id: checkpointId,
      createdAt,
      signal: context.signal,
    });
    if (!captured.ok) {
      throw new GeometryActionError(
        captured.code === "snapshot_unstable"
          ? "snapshot_unstable"
          : captured.code === "cancelled"
            ? "cancelled"
            : "checkpoint_unavailable",
        captured.message,
      );
    }
    if (!sameWorldEvidenceAnchor(world, captured.world)) {
      throw new GeometryActionError(
        "snapshot_unstable",
        "Evidence changed during checkpoint capture.",
      );
    }
    let thumbnailDataUrl: string | undefined;
    try {
      thumbnailDataUrl = await this.dependencies.createThumbnail?.();
    } catch {
      thumbnailDataUrl = undefined;
    }
    this.assertContextAuthority(context);
    const capture = GeometryEvidenceCaptureV1.parse({
      schemaVersion: "geometry_evidence_capture.v1",
      id: captureId,
      activityId: world.activityId,
      missionId: mission.id,
      configuration: arguments_.configuration,
      epoch: world.epoch,
      revision: world.revision,
      snapshotHash: world.snapshotHash,
      checkpointId,
      objectNames: [...captured.checkpoint.inventory],
      factIds: world.facts
        .filter(
          (fact) =>
            fact.pass &&
            fact.epoch === world.epoch &&
            fact.revision === world.revision &&
            fact.snapshotHash === world.snapshotHash,
        )
        .map(({ id }) => id)
        .sort(),
      createdAt,
      actor,
    });
    const stored = store.add({
      capture,
      checkpoint: captured.checkpoint,
      ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}),
    });
    if (!stored.ok) {
      throw new GeometryActionError(stored.code, stored.message);
    }
    return {
      data: {
        status: stored.status,
        capture: stored.entry.capture,
        thumbnailStored: Boolean(stored.entry.thumbnailDataUrl),
        quota: store.report(world.activityId),
      },
      evidenceIds: [capture.id, ...capture.factIds],
    };
  }

  private async restoreCheckpoint(
    arguments_: GeometryActionArgumentsV1["restore_geometry_checkpoint"],
    context: GatewayContext,
  ): Promise<ActionResult> {
    const store = this.dependencies.evidenceStore;
    const checkpoints = this.dependencies.checkpoints;
    const tokens = this.dependencies.privilegedTokens;
    const nextAuthority = this.dependencies.nextRestoreAuthority;
    if (!store || !checkpoints || !tokens || !nextAuthority) {
      throw new GeometryActionError(
        "action_not_allowed",
        "Checkpoint restoration is not configured.",
      );
    }
    const checkpoint = store.getCheckpoint(arguments_.checkpointId);
    if (!checkpoint || checkpoint.activityId !== arguments_.activityId) {
      throw new GeometryActionError(
        "checkpoint_unavailable",
        "The requested checkpoint is unavailable for this activity.",
      );
    }
    const binding = {
      activityId: arguments_.activityId,
      epoch: arguments_.epoch,
      revision: arguments_.revision,
      action: "restore_geometry_checkpoint" as const,
      checkpointId: arguments_.checkpointId,
    };
    const consumed = tokens.consume(arguments_.confirmationId, binding);
    if (!consumed.ok) {
      throw new GeometryActionError(
        "consent_invalid",
        "Restore confirmation is no longer current.",
      );
    }
    this.dependencies.replay?.stop();
    this.cleanupUi();
    const targetAuthority = nextAuthority();
    const restored = await checkpoints.restore(checkpoint, {
      ...targetAuthority,
      signal: context.signal,
    });
    if (restored.ok) {
      this.dependencies.onRestoredWorld?.(restored.world);
      return {
        revision: targetAuthority.revision,
        data: {
          status: "restored",
          checkpointId: checkpoint.id,
          recovery: "exact",
          epoch: targetAuthority.epoch,
          revision: targetAuthority.revision,
          snapshotHash: restored.world.snapshotHash,
          inventory: [...checkpoint.inventory],
          listenerCount: restored.listenerCountAfter,
          evidence: {
            kind: "checkpoint_restored",
            checkpointId: checkpoint.id,
          },
        },
      };
    }
    const baseline = store.getBaseline(arguments_.activityId);
    if (baseline && baseline.id !== checkpoint.id) {
      const baselineAuthority = nextAuthority();
      const recovered = await checkpoints.restore(baseline, {
        ...baselineAuthority,
        signal: context.signal,
      });
      if (recovered.ok) {
        this.dependencies.onRestoredWorld?.(recovered.world);
        return {
          revision: baselineAuthority.revision,
          data: {
            status: "restored",
            checkpointId: baseline.id,
            requestedCheckpointId: checkpoint.id,
            recovery: "baseline",
            epoch: baselineAuthority.epoch,
            revision: baselineAuthority.revision,
            snapshotHash: recovered.world.snapshotHash,
            inventory: [...baseline.inventory],
            listenerCount: recovered.listenerCountAfter,
            evidence: {
              kind: "checkpoint_restore_recovered",
              checkpointId: baseline.id,
            },
          },
        };
      }
    }
    this.freeze("Checkpoint and activity baseline restoration both failed.");
    throw new GeometryActionError(
      "restore_failed",
      "Checkpoint restore and baseline recovery failed; mutations are frozen.",
    );
  }

  private async demonstrate(
    arguments_: GeometryActionArgumentsV1["demonstrate_geometry_step"],
    context: GatewayContext,
  ): Promise<ActionResult> {
    const replay = this.dependencies.replay;
    const tokens = this.dependencies.privilegedTokens;
    if (!replay || !tokens) {
      throw new GeometryActionError(
        "action_not_allowed",
        "Geometry demonstration is not configured.",
      );
    }
    const binding = {
      activityId: arguments_.activityId,
      epoch: arguments_.epoch,
      revision: arguments_.revision,
      action: "demonstrate_geometry_step" as const,
      stepId: arguments_.stepId,
      speed: arguments_.speed,
    };
    const consumed = tokens.consume(arguments_.consentToken, binding);
    if (!consumed.ok) {
      throw new GeometryActionError(
        "consent_invalid",
        "Demonstration consent is no longer current.",
      );
    }
    const result = await replay.run({
      stepId: arguments_.stepId,
      speed: arguments_.speed,
      signal: context.signal,
    });
    return {
      revision: Math.max(
        arguments_.revision + 1,
        this.dependencies.getAuthority().revision,
      ),
      data: result,
      evidenceIds: result.status === "completed" ? [arguments_.stepId] : [],
    };
  }

  private currentWorld(arguments_: GeometryActionArgumentsValueV1): GeometryWorldV2 {
    const world = this.dependencies.getWorld();
    if (
      world.activityId !== arguments_.activityId ||
      world.epoch !== arguments_.epoch ||
      world.revision !== arguments_.revision
    ) {
      throw new GeometryActionError(
        "stale_revision",
        "The geometry world changed before the action could run.",
      );
    }
    return world;
  }

  private validateConsentBeforeApi(
    action: GeometryInvestigationActionV1,
    arguments_: GeometryActionArgumentsValueV1,
  ):
    | { ok: true }
    | { ok: false; code: GatewayErrorCode; message: string } {
    if (action === "restore_geometry_checkpoint") {
      const restore =
        arguments_ as GeometryActionArgumentsV1["restore_geometry_checkpoint"];
      const validation = this.dependencies.privilegedTokens?.validate(
        restore.confirmationId,
        {
          activityId: restore.activityId,
          epoch: restore.epoch,
          revision: restore.revision,
          action: "restore_geometry_checkpoint",
          checkpointId: restore.checkpointId,
        },
      );
      return validation?.ok
        ? validation
        : {
            ok: false,
            code: validation?.reason === "missing" ? "consent_required" : "consent_invalid",
            message: "A current visible restore confirmation is required.",
          };
    }
    if (action === "demonstrate_geometry_step") {
      const demo =
        arguments_ as GeometryActionArgumentsV1["demonstrate_geometry_step"];
      const validation = this.dependencies.privilegedTokens?.validate(
        demo.consentToken,
        {
          activityId: demo.activityId,
          epoch: demo.epoch,
          revision: demo.revision,
          action: "demonstrate_geometry_step",
          stepId: demo.stepId,
          speed: demo.speed,
        },
      );
      return validation?.ok
        ? validation
        : {
            ok: false,
            code: validation?.reason === "missing" ? "consent_required" : "consent_invalid",
            message: "A current demonstration consent token is required.",
          };
    }
    return { ok: true };
  }

  private consumeBudget(
    action: GeometryInvestigationActionV1,
    turnId: string,
  ): boolean {
    const current = this.usage.get(turnId) ?? { reads: 0, ui: 0, mutations: 0 };
    const category = ACTION_CATEGORY[action];
    const next = { ...current, [category]: current[category] + 1 };
    if (
      next.reads > GEOMETRY_ACTION_BUDGETS_V1.readsPerTurn ||
      next.ui > GEOMETRY_ACTION_BUDGETS_V1.reversibleUiPerTurn ||
      next.mutations > GEOMETRY_ACTION_BUDGETS_V1.mutationsPerTurn
    ) {
      return false;
    }
    this.usage.set(turnId, next);
    return true;
  }

  private assertStillCurrent(
    context: GatewayContext,
    before: GeometryActionAuthorityV1,
    interactionGeneration: number | undefined,
  ): void {
    this.assertContextAuthority(context);
    const current = this.dependencies.getAuthority();
    if (
      current.activityId !== before.activityId ||
      current.epoch !== before.epoch ||
      interactionGeneration !== this.dependencies.getInteractionGeneration?.()
    ) {
      throw new GeometryActionError(
        "rejected_stale",
        "Action result was quarantined because authority changed.",
      );
    }
  }

  private assertContextAuthority(context: GatewayContext): void {
    if (context.signal?.aborted || !(context.isAuthorityCurrent?.() ?? true)) {
      throw new DOMException("Action authority expired.", "AbortError");
    }
  }

  private freeze(reason: string): void {
    this.mutationsFrozen = true;
    this.dependencies.freezeMutations?.(reason);
  }
}

function validateGatewayCorrelation(
  arguments_: GeometryActionArgumentsValueV1,
  context: GatewayContext,
):
  | { ok: true }
  | { ok: false; code: GatewayErrorCode; message: string } {
  if (arguments_.revision !== context.revision) {
    return {
      ok: false,
      code: "stale_revision",
      message: "Construction revision is stale.",
    };
  }
  if (context.epoch !== undefined && arguments_.epoch !== context.epoch) {
    return { ok: false, code: "rejected_stale", message: "Applet epoch is stale." };
  }
  return { ok: true };
}

function missionObjectNames(
  activity: GeometryInvestigationV1,
  relationIds: readonly string[],
): string[] {
  const selected = new Set(relationIds);
  return activity.relationDefinitions.flatMap((definition) =>
    selected.has(definition.id) ? [...definition.objects] : [],
  );
}

function orderedPoints(
  world: GeometryWorldV2,
  names: readonly string[],
): GeometryPointV1[] {
  const points = pointMap(world, names);
  return names.map((name) => points[name]);
}

function pointMap(
  world: GeometryWorldV2,
  names: readonly string[],
): Record<string, GeometryPointV1> {
  const byName = new Map(world.objects.map((object) => [object.name, object]));
  const result: Record<string, GeometryPointV1> = {};
  for (const name of names) {
    const object = byName.get(name);
    if (!object) {
      throw new GeometryActionError("object_missing", `Object ${name} is missing.`);
    }
    if (
      object.type.toLowerCase() !== "point" ||
      !Number.isFinite(object.x) ||
      !Number.isFinite(object.y)
    ) {
      throw new GeometryActionError(
        "invalid_polygon",
        `Object ${name} is not a finite point.`,
      );
    }
    result[name] = { x: object.x as number, y: object.y as number };
  }
  return result;
}

function boxForWorldObjects(
  world: GeometryWorldV2,
  names: readonly string[],
): GeometryLogicalBoxV1 {
  const byName = new Map(world.objects.map((object) => [object.name, object]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new GeometryActionError(
      "object_missing",
      `Focus objects are missing: ${missing.join(", ")}.`,
    );
  }
  const coordinateObjects = new Map<string, GeometryWorldObjectV2>();
  for (const name of names) {
    const object = byName.get(name)!;
    if (finitePointObject(object)) coordinateObjects.set(object.name, object);
    for (const parent of object.parents) {
      const parentObject = byName.get(parent);
      if (parentObject && finitePointObject(parentObject)) {
        coordinateObjects.set(parentObject.name, parentObject);
      }
    }
  }
  const points = [...coordinateObjects.values()];
  if (points.length === 0) {
    throw new GeometryActionError(
      "invalid_arguments",
      "Focus objects expose no finite point coordinates.",
    );
  }
  const xs = points.map(({ x }) => x as number);
  const ys = points.map(({ y }) => y as number);
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (xMin === xMax) {
    xMin -= 0.5;
    xMax += 0.5;
  }
  if (yMin === yMax) {
    yMin -= 0.5;
    yMax += 0.5;
  }
  return { xMin, xMax, yMin, yMax };
}

function finitePointObject(object: GeometryWorldObjectV2): boolean {
  return Number.isFinite(object.x) && Number.isFinite(object.y);
}

function deterministicVariationPoint(
  points: Record<string, GeometryPointV1>,
  movingPoint: "A" | "B" | "C" | "D",
  target: "convex" | "concave" | "crossed",
): GeometryPointV1 | undefined {
  const labels = ["A", "B", "C", "D"] as const;
  const fixed = labels.filter((label) => label !== movingPoint).map((label) => points[label]);
  const xMin = Math.min(...fixed.map(({ x }) => x));
  const xMax = Math.max(...fixed.map(({ x }) => x));
  const yMin = Math.min(...fixed.map(({ y }) => y));
  const yMax = Math.max(...fixed.map(({ y }) => y));
  const center = { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 };
  const scale = Math.max(1, xMax - xMin, yMax - yMin);
  const offsets = [-3, -2, -1.5, -1, -0.5, -0.25, 0, 0.25, 0.5, 1, 1.5, 2, 3];
  const candidates = [
    center,
    ...fixed.map((point) => ({
      x: (point.x + center.x) / 2,
      y: (point.y + center.y) / 2,
    })),
    ...offsets.flatMap((x) =>
      offsets.map((y) => ({
        x: center.x + x * scale,
        y: center.y + y * scale,
      })),
    ),
  ];
  for (const candidate of candidates) {
    const trial = { ...points, [movingPoint]: candidate };
    const classification = classifyOrderedQuadrilateralV1([
      trial.A,
      trial.B,
      trial.C,
      trial.D,
    ]);
    if (classification.type === target) return candidate;
  }
  return undefined;
}

function rollbackPoint(
  api: GeoGebraApi,
  name: string,
  point: GeometryPointV1,
): boolean {
  try {
    api.setCoords?.(name, point.x, point.y);
    const restored = readPoint(api, name);
    return Boolean(restored && samePoint(restored, point));
  } catch {
    return false;
  }
}

function readPoint(api: GeoGebraApi, name: string): GeometryPointV1 | undefined {
  const x = api.getXcoord?.(name);
  const y = api.getYcoord?.(name);
  return Number.isFinite(x) && Number.isFinite(y)
    ? { x: x as number, y: y as number }
    : undefined;
}

function samePoint(left: GeometryPointV1, right: GeometryPointV1): boolean {
  const scale = Math.max(1, Math.abs(right.x), Math.abs(right.y));
  return Math.hypot(left.x - right.x, left.y - right.y) <= 1e-9 * scale;
}

function rollbackCreated(api: GeoGebraApi, created: readonly string[]): boolean {
  try {
    for (const name of created.toReversed()) api.deleteObject?.(name);
    return created.every((name) => !api.exists(name));
  } catch {
    return false;
  }
}

function finiteCommandNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new GeometryActionError("invalid_arguments", "Scaffold coordinate is invalid.");
  }
  return String(Math.abs(value) < 1e-12 ? 0 : value);
}

function validCallId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((name, index) => name === right[index])
  );
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function captureSuffix(snapshotHash: string): string {
  const suffix = snapshotHash.replace(/[^A-Za-z0-9_-]/g, "_").slice(-16);
  return suffix.length > 0 ? suffix : "snapshot";
}

function sameWorldEvidenceAnchor(
  left: GeometryWorldV2,
  right: GeometryWorldV2,
): boolean {
  return (
    left.activityId === right.activityId &&
    left.epoch === right.epoch &&
    left.revision === right.revision &&
    left.snapshotHash === right.snapshotHash &&
    JSON.stringify(left.facts) === JSON.stringify(right.facts) &&
    JSON.stringify(left.configuration) === JSON.stringify(right.configuration)
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function failure(
  callId: string,
  revision: number,
  code: GatewayErrorCode,
  message: string,
): GatewayEnvelope {
  return { ok: false, callId, revision, error: { code, message }, evidenceIds: [] };
}

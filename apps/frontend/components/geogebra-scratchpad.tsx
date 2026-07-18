"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { GeoGebraAccessibilityGuard } from "@/lib/geogebra/accessibility";
import { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import { GeoGebraAssistRuntime } from "@/lib/geogebra/assist-runtime";
import { SceneRegistry } from "@/lib/geogebra/scene";
import { evaluateGeometryWorldV2 } from "@/lib/geometry-investigation/engine";
import { GeometryActionRuntimeV1 } from "@/lib/geometry-investigation/action-runtime";
import type { GeometryActionAuthorityV1 } from "@/lib/geometry-investigation/authority";
import { GeometryCheckpointControllerV1 } from "@/lib/geometry-investigation/checkpoint-v2";
import type {
  GeometryEvidenceCaptureV1,
  GeometryInvestigationV1,
  GeometryLearningSessionReportV1,
  GeometryWorldV2,
} from "@/lib/geometry-investigation/contracts";
import { GeometryReplayControllerV1, type GeometryReplayStatusV1 } from "@/lib/geometry-investigation/replay";
import {
  GeometryLearningRuntimeV1,
  type GeometryRealtimePedagogyContextV1,
} from "@/lib/geometry-investigation/learning-runtime";
import type { GeometryHintDirectiveV1 } from "@/lib/geometry-investigation/learning-policy";
import { createGeometryLearningSessionReportV1 } from "@/lib/geometry-investigation/report";
import type { GeometrySessionStateV1 } from "@/lib/geometry-investigation/session";
import { GeometryWorldObserverV2 } from "@/lib/geometry-investigation/stabilizer";
import type { GeometryWorldCommitV2 } from "@/lib/geometry-investigation/stabilizer";
import { createGeometryWorldDeltaV2 } from "@/lib/geometry-investigation/world";
import { GeometryUiEffectsV1 } from "@/lib/geometry-investigation/ui-effects";
import {
  findGeoGebraMoreButtonV1,
  findGeoGebraToolButtonV1,
  parseGeometryViewPropertiesV1,
} from "@/lib/geometry-investigation/visual-guidance";
import { VARIGNON_ACTIVITY_FR_V1 } from "@/lib/geometry-investigation/varignon";
import type { GeneralExerciseReadyV1 } from "@/lib/exercise/general-exercise-contracts";
import type { GeoGebraWorldStateV1 } from "@/lib/geogebra/mission-progress";
import type { ToolRuntime } from "@/lib/tools/runtime";
import { useLanguage } from "./language-provider";
import { useMascotController } from "./compass-mascot";
import { GeometryEvidenceGallery } from "./geometry-evidence-gallery";
import {
  GeometryGuidanceOverlay,
  type GeometryGuidancePresentationV1,
} from "./geometry-guidance-overlay";
import { GeometryInvestigationPanel } from "./geometry-investigation-panel";

type ScratchpadState =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "unavailable"; message: string };

export type GeometryLearnerInteractionRuntime = Readonly<{
  cancel(reason: "student_action" | "student_speech"): void;
}>;

export type GeometryScratchpadReadinessV1 = Readonly<{
  schemaVersion: "geometry_scratchpad_readiness.v1";
  activityId: string;
  status: "loading" | "ready" | "fatal";
  scaffoldVerified: boolean;
  epoch?: number;
  revision?: number;
  snapshotHash?: string;
}>;

type LearningDirectiveActionRuntime = Readonly<{
  deliver(
    directive: GeometryHintDirectiveV1,
    confirmed: boolean,
  ): Promise<boolean>;
}>;

export function GeoGebraScratchpad({
  onToolRuntime,
  exercise,
  onWorldState,
  investigation,
  onGeometryLearningReport,
  onGeometryWorldCommit,
  onGeometryLearningState,
  onGeometryLearningDirective,
  onLearnerInteractionRuntime,
  onReadiness,
  canvasOverlay,
}: {
  onToolRuntime?(runtime?: ToolRuntime): void;
  exercise?: GeneralExerciseReadyV1;
  onWorldState?(state?: GeoGebraWorldStateV1): void;
  investigation?: GeometryInvestigationV1;
  onGeometryLearningReport?(report: GeometryLearningSessionReportV1): void;
  onGeometryWorldCommit?(
    commit?: GeometryWorldCommitV2,
    pedagogy?: GeometryRealtimePedagogyContextV1,
  ): void;
  onGeometryLearningState?(state?: GeometrySessionStateV1): void;
  onGeometryLearningDirective?(directive?: GeometryHintDirectiveV1): void;
  onLearnerInteractionRuntime?(runtime?: GeometryLearnerInteractionRuntime): void;
  onReadiness?(readiness: GeometryScratchpadReadinessV1): void;
  canvasOverlay?: ReactNode;
}) {
  const { text } = useLanguage();
  const { start: startMascot, stop: stopMascot, pulse: pulseMascot } =
    useMascotController();
  const containerRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ScratchpadState>({ phase: "loading" });
  const [evidenceHarnessEnabled, setEvidenceHarnessEnabled] = useState(false);
  const [evidenceCaptures, setEvidenceCaptures] = useState<
    readonly GeometryEvidenceCaptureV1[]
  >([]);
  const [replayStatus, setReplayStatus] =
    useState<GeometryReplayStatusV1>("idle");
  const [checkpointRestoring, setCheckpointRestoring] = useState(false);
  const [learningHarnessEnabled, setLearningHarnessEnabled] = useState(false);
  const [learningSession, setLearningSession] =
    useState<GeometrySessionStateV1>();
  const [learningDirective, setLearningDirective] =
    useState<GeometryHintDirectiveV1>();
  const [guidancePresentation, setGuidancePresentation] =
    useState<GeometryGuidancePresentationV1>();
  const evidenceHarnessRef = useRef<EvidenceHarnessControls | undefined>(
    undefined,
  );
  const learningDirectiveActionRef = useRef<
    LearningDirectiveActionRuntime | undefined
  >(undefined);
  const activity = investigation ?? VARIGNON_ACTIVITY_FR_V1;
  const dismissGuidance = useCallback((cueId: number) => {
    setGuidancePresentation((current) =>
      current?.cue.id === cueId ? undefined : current,
    );
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const adapter = new GeoGebraAdapter();
    let assistRuntime: GeoGebraAssistRuntime | undefined;
    let investigationRuntime: GeometryActionRuntimeV1 | undefined;
    let learningRuntime: GeometryLearningRuntimeV1 | undefined;
    let worldObserverV2: GeometryWorldObserverV2 | undefined;
    let currentWorldV2: GeometryWorldV2 | undefined;
    let learnerInteractionGeneration = 0;
    let internalGeometryActionDepth = 0;
    let baselineCaptureStarted = false;
    let activityInitializationStarted = false;
    let learningReportPublished = false;
    let helpRequestSequence = 0;
    let deliverLearningDirectiveAction:
      | ((directive: GeometryHintDirectiveV1, confirmed: boolean) => Promise<boolean>)
      | undefined;
    const investigationRegistry = new SceneRegistry();
    const investigationAuthority: MutableInvestigationAuthority = {
      activityId: activity.id,
      epoch: 0,
      revision: 0,
      phase: "confirmed",
      actor: "system",
      maxLevel: "O5",
      uiGuidanceAllowed: true,
      attemptedVariationTargets: [],
      attemptedDemonstrationStepIds: [],
      learnerActionCurrent: false,
    };
    const cancelForLearnerInteraction = (
      reason: "student_action" | "student_speech",
    ) => {
      if (internalGeometryActionDepth > 0) return;
      const requiredScaffoldObjects =
        activity.scaffold.freePoints.length + activity.scaffold.edges.length;
      if (
        reason === "student_action" &&
        (!currentWorldV2 || currentWorldV2.objects.length < requiredScaffoldObjects)
      ) {
        return;
      }
      learnerInteractionGeneration += 1;
      investigationRuntime?.cancel(reason);
      setLearningDirective(undefined);
    };
    const guard = new GeoGebraAccessibilityGuard(container);
    const bounds = container.getBoundingClientRect();
    const width = Math.max(
      280,
      Math.min(1600, Math.floor(bounds.width || window.innerWidth - 32)),
    );
    const height =
      window.innerWidth < 640
        ? 520
        : Math.max(650, Math.min(800, window.innerHeight - 200));

    container.replaceChildren();
    setState({ phase: "loading" });
    onReadiness?.({
      schemaVersion: "geometry_scratchpad_readiness.v1",
      activityId: activity.id,
      status: "loading",
      scaffoldVerified: false,
    });
    startMascot("general-geogebra-load", "modifying");
    guard.start();

    void adapter
      .load(container, {
        id: "compass-general-geogebra",
        width,
        height,
      })
      .then((result) => {
        if (disposed) return;
        stopMascot("general-geogebra-load");
        if (!result.ok) {
          setState({ phase: "unavailable", message: result.error.message });
          onReadiness?.({
            schemaVersion: "geometry_scratchpad_readiness.v1",
            activityId: activity.id,
            status: "fatal",
            scaffoldVerified: false,
          });
          pulseMascot("general-geogebra-error", "error", 2_400);
          return;
        }
        assistRuntime = new GeoGebraAssistRuntime(adapter, {
          exercise,
          onWorldState: (worldState) => onWorldState?.(worldState),
        });
        const qualification = new URLSearchParams(window.location.search);
        const worldV2Enabled =
          qualification.get("t22WorldV2") === "1" || Boolean(investigation);
        const engineEnabled =
          qualification.get("t22Engine") === "1" || Boolean(investigation);
        const learningEnabled =
          qualification.get("t22Learning") === "1" || Boolean(investigation);
        const evidenceEnabled =
          qualification.get("t22Evidence") === "1" || learningEnabled;
        const actionsEnabled =
          qualification.get("t22Actions") === "1" || evidenceEnabled;
        setEvidenceHarnessEnabled(evidenceEnabled);
        setLearningHarnessEnabled(learningEnabled);
        const handleLearningDecision = (
          decision: ReturnType<GeometryLearningRuntimeV1["requestHelp"]>,
        ) => {
          stopMascot("geometry-help-request");
          if (decision?.type !== "SPEAK") return;
          setLearningDirective(decision.directive);
          onGeometryLearningDirective?.(decision.directive);
          pulseMascot(
            `geometry-hint:${decision.directive.id}`,
            "hinting",
            decision.directive.action ? 3_600 : 2_800,
          );
          if (decision.directive.level <= 3 && !decision.directive.action) {
            learningRuntime?.markAssistanceDelivered(decision.directive);
            return;
          }
          if (decision.directive.level <= 3) {
            void deliverLearningDirectiveAction?.(
              decision.directive,
              false,
            );
          }
        };
        if (learningEnabled) {
          learningRuntime = new GeometryLearningRuntimeV1(
            activity,
            {
              onState: (next) => {
                setLearningSession(next);
                onGeometryLearningState?.(next);
                // A restore is authorized by the mission that opened the
                // visible confirmation. The reducer has no active mission
                // while recovering, so keep that authority until the restored
                // world is committed and mission progress is derived again.
                if (next.phase !== "recovering") {
                  investigationAuthority.missionId = next.activeMissionId;
                }
                investigationAuthority.phase =
                  next.phase === "fatal"
                    ? "fatal"
                    : ["loading", "ready"].includes(next.phase)
                      ? "confirmed"
                      : next.phase === "completed"
                        ? "completed"
                        : "investigating";
                investigationAuthority.attemptedDemonstrationStepIds =
                  (next.attempts.V8?.count ?? 0) > 0 ||
                  next.reflections.completedJustificationStepIds.length > 0
                    ? ["demo_v8_7"]
                    : [];
                if (
                  next.phase === "completed" &&
                  !learningReportPublished &&
                  onGeometryLearningReport
                ) {
                  learningReportPublished = true;
                  onGeometryLearningReport(
                    createGeometryLearningSessionReportV1(activity, next),
                  );
                }
                if (next.phase === "fatal") {
                  onReadiness?.({
                    schemaVersion: "geometry_scratchpad_readiness.v1",
                    activityId: activity.id,
                    status: "fatal",
                    scaffoldVerified: false,
                    epoch: next.epoch,
                    revision: next.revision,
                  });
                }
              },
            },
          );
        }
        if (worldV2Enabled || engineEnabled || actionsEnabled) {
          window.__GEOTUTOR_WORLD_V2_HISTORY__ = [];
          worldObserverV2 = new GeometryWorldObserverV2(
            adapter,
            investigationRegistry,
            activity.id,
            (commit) => {
              const qualifiedCommit = engineEnabled || actionsEnabled
                ? {
                    ...commit,
                    world: evaluateGeometryWorldV2(
                      activity,
                      commit.world,
                    ).world,
                  }
                : commit;
              currentWorldV2 = qualifiedCommit.world;
              investigationAuthority.activityId = qualifiedCommit.world.activityId;
              investigationAuthority.epoch = qualifiedCommit.world.epoch;
              investigationAuthority.revision = qualifiedCommit.world.revision;
              window.__GEOTUTOR_WORLD_V2__ = qualifiedCommit;
              window.__GEOTUTOR_WORLD_V2_HISTORY__?.push(qualifiedCommit);
              const scaffoldVerified = isInvestigationScaffoldReady(
                activity,
                qualifiedCommit.world,
              );
              if (investigation && scaffoldVerified) {
                onReadiness?.({
                  schemaVersion: "geometry_scratchpad_readiness.v1",
                  activityId: activity.id,
                  status: "ready",
                  scaffoldVerified: true,
                  epoch: qualifiedCommit.world.epoch,
                  revision: qualifiedCommit.world.revision,
                  snapshotHash: qualifiedCommit.world.snapshotHash,
                });
              }
              if (learningRuntime) {
                if (qualifiedCommit.world.change.actor === "learner") {
                  setLearningDirective(undefined);
                }
                investigationAuthority.learnerActionCurrent =
                  qualifiedCommit.world.change.actor === "learner";
                handleLearningDecision(
                  learningRuntime.commitWorld(qualifiedCommit.world),
                );
              }
              onGeometryWorldCommit?.(
                qualifiedCommit,
                learningRuntime?.realtimeContext(),
              );
              if (
                investigation &&
                investigationRuntime &&
                !activityInitializationStarted &&
                qualifiedCommit.world.objects.length === 0
              ) {
                activityInitializationStarted = true;
                Object.assign(investigationAuthority, {
                  phase: "confirmed",
                  actor: "system",
                  maxLevel: "O3",
                  missionId: undefined,
                  learnerActionCurrent: false,
                });
                const context = investigationRuntime.toolRuntime.getContext(
                  `initialize-${qualifiedCommit.world.epoch}`,
                );
                if (!context) {
                  learningRuntime?.failFatal("Activity initialization is unavailable.");
                } else {
                  void investigationRuntime.gateway
                    .execute(
                      {
                        callId: `initialize-${qualifiedCommit.world.epoch}-${qualifiedCommit.world.revision}`,
                        name: "initialize_geometry_activity",
                        arguments: JSON.stringify({
                          activityId: activity.id,
                          epoch: qualifiedCommit.world.epoch,
                          revision: qualifiedCommit.world.revision,
                          scaffoldVersion: activity.scaffold.version,
                        }),
                      },
                      context,
                    )
                    .then((initialization) => {
                      if (!initialization.ok) {
                        onReadiness?.({
                          schemaVersion: "geometry_scratchpad_readiness.v1",
                          activityId: activity.id,
                          status: "fatal",
                          scaffoldVerified: false,
                          epoch: qualifiedCommit.world.epoch,
                          revision: qualifiedCommit.world.revision,
                        });
                        learningRuntime?.failFatal(
                          "Activity scaffold initialization failed.",
                        );
                        return;
                      }
                      worldObserverV2?.observe(
                        {
                          type: "update",
                          argument: [
                            ...activity.scaffold.freePoints.map(({ label }) => label),
                            ...activity.scaffold.edges.map(
                              ({ from, to }) => `${from}${to}`,
                            ),
                          ],
                        },
                        "system",
                      );
                    });
                }
              }
              if (
                evidenceEnabled &&
                investigationRuntime &&
                !baselineCaptureStarted &&
                (!investigation ||
                  qualifiedCommit.world.objects.length >=
                    activity.scaffold.freePoints.length +
                      activity.scaffold.edges.length)
              ) {
                baselineCaptureStarted = true;
                void investigationRuntime.captureBaseline().then((captured) => {
                  if (!captured) baselineCaptureStarted = false;
                });
              }
            },
            {
              onLearnerInteraction: () =>
                cancelForLearnerInteraction("student_action"),
            },
          );
          worldObserverV2.start();
          window.__GEOTUTOR_WORLD_V2_EVENT__ = (event) =>
            worldObserverV2?.observe(event);
          if (actionsEnabled) {
            const apiResult = adapter.withApi((api) => api);
            if (apiResult.ok) {
              const api = apiResult.value;
              const checkpoints = evidenceEnabled
                ? new GeometryCheckpointControllerV1({
                    api,
                    registry: investigationRegistry,
                    getWorld: () => {
                      if (!currentWorldV2) {
                        throw new Error("Geometry world v2 is not ready.");
                      }
                      return currentWorldV2;
                    },
                    getListenerCount: () => adapter.listenerCount,
                    suspendListeners: () => {
                      const suspended = adapter.suspendListeners();
                      if (!suspended.ok) {
                        return {
                          listenerCountBefore: adapter.listenerCount,
                          resume: () => adapter.listenerCount,
                        };
                      }
                      return suspended.value;
                    },
                    reconcileListeners: () => true,
                    onRestoreStatus: (restoring) => {
                      if (!disposed) setCheckpointRestoring(restoring);
                    },
                    waitForRestoreBarrier: () =>
                      new Promise<void>((resolve) => {
                        window.requestAnimationFrame(() => resolve());
                      }),
                  })
                : undefined;
              const publishRestoredWorld = (world: GeometryWorldV2) => {
                const previousWorld = currentWorldV2;
                const evaluated = evaluateGeometryWorldV2(
                  activity,
                  world,
                ).world;
                currentWorldV2 = evaluated;
                investigationAuthority.activityId = evaluated.activityId;
                investigationAuthority.epoch = evaluated.epoch;
                investigationAuthority.revision = evaluated.revision;
                worldObserverV2?.synchronize(evaluated);
                window.__GEOTUTOR_WORLD_V2__ = { world: evaluated };
                window.__GEOTUTOR_WORLD_V2_HISTORY__?.push({ world: evaluated });
                if (learningRuntime?.state.phase === "recovering") {
                  learningRuntime.completeRestore(evaluated);
                } else {
                  learningRuntime?.commitWorld(evaluated);
                }
                onGeometryWorldCommit?.(
                  {
                    world: evaluated,
                    delta: createGeometryWorldDeltaV2(previousWorld, evaluated),
                  },
                  learningRuntime?.realtimeContext(),
                );
              };
              const nextRestoreAuthority = () => {
                const epoch = adapter.advanceEpoch();
                const revision = investigationAuthority.revision + 1;
                investigationAuthority.epoch = epoch;
                investigationAuthority.revision = revision;
                return {
                  activityId: investigationAuthority.activityId,
                  epoch,
                  revision,
                };
              };
              const uiEffects = new GeometryUiEffectsV1(api, {
                locale: activity.locale,
                freezeMutations: () => {
                  investigationAuthority.phase = "fatal";
                },
                onGuidanceCue: (cue) => {
                  if (disposed) return;
                  const view = api.getViewProperties
                    ? parseGeometryViewPropertiesV1(api.getViewProperties(1))
                    : undefined;
                  setGuidancePresentation(
                    cue
                      ? {
                          cue,
                          ...(currentWorldV2 ? { world: currentWorldV2 } : {}),
                          ...(view ? { view } : {}),
                        }
                      : undefined,
                  );
                },
                prepareToolTarget: (mode) => {
                  const root = containerRef.current;
                  if (!root || findGeoGebraToolButtonV1(root, mode)) return;
                  findGeoGebraMoreButtonV1(root)?.click();
                },
              });
              const replay = checkpoints
                ? new GeometryReplayControllerV1({
                    activity,
                    uiEffects,
                    checkpoints,
                    getAuthority: () => investigationAuthority,
                    nextRestoreAuthority,
                    onRestoredWorld: publishRestoredWorld,
                    onStatus: (status) => setReplayStatus(status),
                    freezeMutations: () => {
                      investigationAuthority.phase = "fatal";
                    },
                  })
                : undefined;
              investigationRuntime = new GeometryActionRuntimeV1({
                api,
                activity,
                registry: investigationRegistry,
                getAuthority: () => investigationAuthority,
                getWorld: () => {
                  if (!currentWorldV2) {
                    throw new Error("Geometry world v2 is not ready.");
                  }
                  return currentWorldV2;
                },
                uiEffects,
                getInteractionGeneration: () => learnerInteractionGeneration,
                freezeMutations: () => {
                  investigationAuthority.phase = "fatal";
                },
                onAssistantMutation: ({ point }) => {
                  worldObserverV2?.observe(
                    { type: "update", argument: point },
                    "assistant",
                  );
                },
                ...(checkpoints
                  ? {
                      checkpoints,
                      replay,
                      getEvidenceActor: () => "learner" as const,
                      createThumbnail: async () => {
                        const png = api.getPNGBase64?.(0.35, false, 72, false);
                        return png ? `data:image/png;base64,${png}` : undefined;
                      },
                      nextRestoreAuthority,
                      onRestoredWorld: publishRestoredWorld,
                    }
                  : {}),
              });
              const executeInvestigation = async (
                callId: string,
                name: string,
                arguments_: Record<string, unknown>,
                turnId = "t22-actions-turn",
              ) => {
                const context = investigationRuntime?.toolRuntime.getContext(turnId);
                if (!context || !investigationRuntime) {
                  throw new Error("Geometry action runtime is not ready.");
                }
                if (
                  name === "restore_geometry_checkpoint" &&
                  learningRuntime?.state.phase !== "recovering"
                ) {
                  learningRuntime?.startRestore();
                }
                const suppressLearnerInteractions =
                  name !== "demonstrate_geometry_step";
                if (suppressLearnerInteractions) {
                  internalGeometryActionDepth += 1;
                }
                let result: Awaited<
                  ReturnType<typeof investigationRuntime.gateway.execute>
                >;
                try {
                  result = await investigationRuntime.gateway.execute(
                    { callId, name, arguments: JSON.stringify(arguments_) },
                    context,
                  );
                } finally {
                  if (suppressLearnerInteractions) {
                    internalGeometryActionDepth -= 1;
                  }
                }
                if (evidenceEnabled) {
                  const captures = investigationRuntime.evidenceStore.list(
                    investigationAuthority.activityId,
                  );
                  setEvidenceCaptures(captures);
                  learningRuntime?.syncCaptures(captures);
                }
                if (
                  result.ok &&
                  name === "demonstrate_geometry_step" &&
                  (result.data as {
                    status?: string;
                    evidence?: {
                      kind?: string;
                      stepId?: string;
                      actor?: string;
                    };
                  }).status === "completed" &&
                  (result.data as {
                    evidence?: { kind?: string; actor?: string };
                  }).evidence?.kind === "demonstration_viewed" &&
                  (result.data as { evidence?: { actor?: string } }).evidence
                    ?.actor === "assistant_demo"
                ) {
                  const stepId = (
                    result.data as { evidence: { stepId?: string } }
                  ).evidence.stepId;
                  if (stepId) learningRuntime?.markDemonstrationViewed(stepId);
                }
                if (
                  !result.ok &&
                  name === "restore_geometry_checkpoint" &&
                  investigationRuntime.gateway.isMutationFrozen()
                ) {
                  learningRuntime?.failFatal("Checkpoint and baseline diverged.");
                }
                return result;
              };
              deliverLearningDirectiveAction = async (directive, confirmed) => {
                if (!investigationRuntime || !currentWorldV2 || !learningRuntime) {
                  return false;
                }
                if (
                  learningRuntime.state.assistance.deliveredDirectiveIds.includes(
                    directive.id,
                  )
                ) {
                  return true;
                }
                if (!directive.action) {
                  learningRuntime.markAssistanceDelivered(directive);
                  return true;
                }

                const previousAuthority = {
                  actor: investigationAuthority.actor,
                  maxLevel: investigationAuthority.maxLevel,
                  missionId: investigationAuthority.missionId,
                  uiGuidanceAllowed: investigationAuthority.uiGuidanceAllowed,
                };
                Object.assign(investigationAuthority, {
                  phase: "investigating",
                  actor: "assistant",
                  maxLevel:
                    directive.action === "demonstrate_geometry_step"
                      ? "O5"
                      : "O2",
                  missionId: directive.missionId,
                  uiGuidanceAllowed: true,
                });
                const mascotSource = `geometry-hint-action:${directive.id}`;
                startMascot(
                  mascotSource,
                  directive.action === "demonstrate_geometry_step"
                    ? "modifying"
                    : "hinting",
                );
                try {
                  const world = currentWorldV2;
                  const common = {
                    activityId: world.activityId,
                    epoch: world.epoch,
                    revision: world.revision,
                  };
                  let arguments_: Record<string, unknown>;
                  if (directive.action === "highlight_geometry_objects") {
                    if (directive.objectNames.length === 0) return false;
                    arguments_ = {
                      ...common,
                      names: [...directive.objectNames],
                      style: "hint",
                      durationMs: 4_000,
                    };
                  } else if (directive.action === "activate_geometry_tool") {
                    arguments_ = {
                      ...common,
                      tool: directive.missionId === "V1" ? "midpoint" : "move",
                    };
                  } else {
                    if (!confirmed) return false;
                    const step = activity.demonstrationSteps
                      .filter(({ missionId }) => missionId === directive.missionId)
                      .at(-1);
                    const hasLearnerAttempt =
                      (learningRuntime.state.attempts[directive.missionId]?.count ??
                        0) > 0 ||
                      learningRuntime.state.reflections
                        .completedJustificationStepIds.length > 0;
                    if (!step || !hasLearnerAttempt) return false;
                    investigationAuthority.attemptedDemonstrationStepIds = [
                      ...new Set([
                        ...investigationAuthority.attemptedDemonstrationStepIds,
                        step.id,
                      ]),
                    ];
                    const speed = window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "reduced"
                      : "normal";
                    const consentToken =
                      investigationRuntime.issueDemonstrationConsent({
                        stepId: step.id,
                        speed,
                        confirmed: true,
                      });
                    if (!consentToken) return false;
                    arguments_ = {
                      ...common,
                      stepId: step.id,
                      consentToken,
                      speed,
                    };
                  }
                  const result = await executeInvestigation(
                    `hint-${directive.id}-${directive.action}`.slice(0, 80),
                    directive.action,
                    arguments_,
                    `hint-turn-${directive.id}`.slice(0, 80),
                  );
                  if (!result.ok) return false;
                  if (
                    directive.action === "demonstrate_geometry_step" &&
                    ((result.data as { status?: string }).status !== "completed" ||
                      (result.data as { evidence?: { actor?: string } }).evidence
                        ?.actor !== "assistant_demo")
                  ) {
                    return false;
                  }
                  learningRuntime.markAssistanceDelivered(directive);
                  return true;
                } finally {
                  stopMascot(mascotSource);
                  Object.assign(investigationAuthority, previousAuthority);
                }
              };
              learningDirectiveActionRef.current = {
                deliver: (directive, confirmed) =>
                  deliverLearningDirectiveAction?.(directive, confirmed) ??
                  Promise.resolve(false),
              };
              window.__GEOTUTOR_ACTIONS_V1__ = {
                execute: executeInvestigation,
                setAuthority: (
                  next: Partial<MutableInvestigationAuthority>,
                ) => Object.assign(investigationAuthority, next),
                issueVariationConsent: (
                  target: "convex" | "concave" | "crossed",
                  movingPoint: "A" | "B" | "C" | "D",
                ) =>
                  investigationRuntime?.issueVariationConsent({
                    target,
                    movingPoint,
                    confirmed: true,
                  }),
                issueRestoreConfirmation: (checkpointId: string) =>
                  investigationRuntime?.issueRestoreConfirmation({
                    checkpointId,
                    confirmed: true,
                  }),
                issueDemonstrationConsent: (
                  stepId: string,
                  speed: "reduced" | "normal",
                ) =>
                  investigationRuntime?.issueDemonstrationConsent({
                    stepId,
                    speed,
                    confirmed: true,
                  }),
                listEvidence: () =>
                  investigationRuntime?.evidenceStore.list(
                    investigationAuthority.activityId,
                  ) ?? [],
                evidenceReport: () =>
                  investigationRuntime?.evidenceStore.report(
                    investigationAuthority.activityId,
                  ),
                captureBaseline: () => investigationRuntime?.captureBaseline(),
                pauseDemonstration: () =>
                  investigationRuntime?.pauseDemonstration() ?? false,
                resumeDemonstration: () =>
                  investigationRuntime?.resumeDemonstration() ?? false,
                stopDemonstration: () =>
                  investigationRuntime?.stopDemonstration() ?? false,
                listenerCount: () => adapter.listenerCount,
                register: (
                  name: string,
                  owner: "scaffold" | "student",
                  kind: "point" | "segment" = "point",
                ) => investigationRegistry.register(name, owner, kind),
                cleanup: () => investigationRuntime?.gateway.cleanupUi(),
                learnerInteraction: () => {
                  cancelForLearnerInteraction("student_action");
                },
              };
              if (learningRuntime) {
                window.__GEOTUTOR_LEARNING_V1__ = {
                  getState: () => learningRuntime?.state,
                  recordAttempt: (actionId: string) => {
                    const decision = learningRuntime?.recordAttempt(actionId);
                    handleLearningDecision(decision);
                    return decision;
                  },
                  requestHelp: () => {
                    const requestId = `help_${++helpRequestSequence}_${investigationAuthority.epoch}_${investigationAuthority.revision}`;
                    const decision = learningRuntime?.requestHelp(requestId);
                    handleLearningDecision(decision);
                    return decision;
                  },
                  completeReflection: (
                    kind: "conjecture" | "transfer",
                    completionId: string,
                  ) => learningRuntime?.completeReflection(kind, completionId, true),
                  completeJustificationStep: (
                    stepId: string,
                    completionId: string,
                  ) =>
                    learningRuntime?.completeJustificationStep(
                      stepId,
                      completionId,
                    ),
                  realtimeContext: (): GeometryRealtimePedagogyContextV1 | undefined =>
                    learningRuntime?.realtimeContext(),
                  report: () =>
                    learningRuntime
                      ? createGeometryLearningSessionReportV1(
                          activity,
                          learningRuntime.state,
                        )
                      : undefined,
                };
              }
              if (evidenceEnabled) {
                evidenceHarnessRef.current = {
                  capture: async (missionId, configuration) => {
                    if (!investigationRuntime || !currentWorldV2) {
                      throw new Error("Evidence runtime is not ready.");
                    }
                    if (currentWorldV2.configuration?.type !== configuration) {
                      throw new Error("The current configuration does not match.");
                    }
                    Object.assign(investigationAuthority, {
                      phase: "investigating",
                      actor: "learner",
                      maxLevel: "O2",
                      missionId,
                      learnerActionCurrent: true,
                    });
                    const world = currentWorldV2;
                    const result = await executeInvestigation(
                      `capture-${configuration}-${world.epoch}-${world.revision}`,
                      "capture_geometry_evidence",
                      {
                        activityId: world.activityId,
                        epoch: world.epoch,
                        revision: world.revision,
                        missionId,
                        configuration,
                        requiredFactIds: [`rel_configuration_${configuration}`],
                      },
                      `capture-turn-${configuration}-${world.epoch}-${world.revision}`,
                    );
                    if (!result.ok) throw new Error(result.error.message);
                  },
                  restore: async (checkpointId) => {
                    if (!investigationRuntime || !currentWorldV2) {
                      throw new Error("Evidence runtime is not ready.");
                    }
                    Object.assign(investigationAuthority, {
                      phase: "investigating",
                      actor: "assistant",
                      maxLevel: "O4",
                      missionId: "V7",
                    });
                    const confirmationId =
                      investigationRuntime.issueRestoreConfirmation({
                        checkpointId,
                        confirmed: true,
                      });
                    if (!confirmationId) {
                      throw new Error("Restore confirmation was not issued.");
                    }
                    const world = currentWorldV2;
                    const result = await executeInvestigation(
                      `gallery-restore-${world.epoch}-${world.revision}`,
                      "restore_geometry_checkpoint",
                      {
                        activityId: world.activityId,
                        epoch: world.epoch,
                        revision: world.revision,
                        checkpointId,
                        confirmationId,
                      },
                      `gallery-restore-turn-${world.epoch}-${world.revision}`,
                    );
                    if (!result.ok) throw new Error(result.error.message);
                  },
                  demonstrate: async () => {
                    if (!investigationRuntime || !currentWorldV2) {
                      throw new Error("Evidence runtime is not ready.");
                    }
                    Object.assign(investigationAuthority, {
                      phase: "investigating",
                      actor: "assistant",
                      maxLevel: "O5",
                      missionId: "V8",
                    });
                    const speed = window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "reduced"
                      : "normal";
                    const consentToken =
                      investigationRuntime.issueDemonstrationConsent({
                        stepId: "demo_v8_7",
                        speed,
                        confirmed: true,
                      });
                    if (!consentToken) {
                      throw new Error("A learner attempt is required first.");
                    }
                    const world = currentWorldV2;
                    const result = await executeInvestigation(
                      `gallery-demo-${world.epoch}-${world.revision}`,
                      "demonstrate_geometry_step",
                      {
                        activityId: world.activityId,
                        epoch: world.epoch,
                        revision: world.revision,
                        stepId: "demo_v8_7",
                        consentToken,
                        speed,
                      },
                      `gallery-demo-turn-${world.epoch}-${world.revision}`,
                    );
                    if (!result.ok) throw new Error(result.error.message);
                  },
                  pause: () => investigationRuntime?.pauseDemonstration(),
                  resume: () => investigationRuntime?.resumeDemonstration(),
                  stop: () => investigationRuntime?.stopDemonstration(),
                };
              }
            }
          }
        }
        onToolRuntime?.(
          investigationRuntime?.toolRuntime ?? assistRuntime.toolRuntime,
        );
        onLearnerInteractionRuntime?.(
          investigationRuntime
            ? { cancel: (reason) => cancelForLearnerInteraction(reason) }
            : undefined,
        );
        setState({ phase: "ready" });
      });

    return () => {
      disposed = true;
      setGuidancePresentation(undefined);
      stopMascot("general-geogebra-load");
      onToolRuntime?.(undefined);
      onWorldState?.(undefined);
      onGeometryWorldCommit?.(undefined);
      onGeometryLearningState?.(undefined);
      onGeometryLearningDirective?.(undefined);
      onLearnerInteractionRuntime?.(undefined);
      assistRuntime?.dispose();
      worldObserverV2?.stop();
      investigationRuntime?.cancel("session_stop");
      evidenceHarnessRef.current = undefined;
      learningDirectiveActionRef.current = undefined;
      setEvidenceCaptures([]);
      setReplayStatus("idle");
      setLearningSession(undefined);
      setLearningDirective(undefined);
      delete window.__GEOTUTOR_WORLD_V2__;
      delete window.__GEOTUTOR_WORLD_V2_HISTORY__;
      delete window.__GEOTUTOR_WORLD_V2_EVENT__;
      delete window.__GEOTUTOR_ACTIONS_V1__;
      delete window.__GEOTUTOR_LEARNING_V1__;
      guard.stop();
      adapter.dispose();
      container.replaceChildren();
    };
  }, [
    activity,
    attempt,
    exercise,
    investigation,
    onGeometryLearningReport,
    onGeometryLearningDirective,
    onGeometryLearningState,
    onGeometryWorldCommit,
    onLearnerInteractionRuntime,
    onReadiness,
    onToolRuntime,
    onWorldState,
    pulseMascot,
    startMascot,
    stopMascot,
  ]);

  return (
    <section
      className="geogebra-scratchpad workspace-card"
      aria-labelledby="geogebra-scratchpad-title"
      data-state={state.phase}
    >
      <div className="scratchpad-heading">
        <div>
          <p className="section-index">
            {text("Your maths board", "Ton tableau de maths")}
          </p>
          <h2 id="geogebra-scratchpad-title">
            {text("Draw, test, adjust.", "Trace, essaie, ajuste.")}
          </h2>
        </div>
        <p>
          {text(
            "Compass follows the objects on this board. Ask for the click sequence or explicitly ask it to create, rename, move or style an object. Verified geometric missions earn exploration XP.",
            "Compass suit les objets de ce tableau. Demande l'ordre des clics ou demande-lui clairement de créer, renommer, déplacer ou styliser un objet. Les missions géométriques vérifiées rapportent des XP d'exploration.",
          )}
        </p>
      </div>

      <ol className="geogebra-quick-guide" aria-label={text("GeoGebra quick guide", "Repère rapide GeoGebra")}>
        <li>
          <span>1</span>
          {text("Choose the tool in GeoGebra", "Choisis l'outil dans GeoGebra")}
        </li>
        <li>
          <span>2</span>
          {text("Click the named points in order", "Clique les points dans l'ordre")}
        </li>
        <li>
          <span>3</span>
          {text("Ask Compass if you get stuck", "Demande à Compass si tu bloques")}
        </li>
      </ol>

      <div className="geogebra-scratchpad-shell">
        {state.phase === "loading" ? (
          <div className="scratchpad-loading" role="status">
            <span aria-hidden="true" />
            <strong>{text("Opening GeoGebra…", "Ouverture de GeoGebra…")}</strong>
          </div>
        ) : null}
        {state.phase === "unavailable" ? (
          <div className="scratchpad-unavailable" role="alert">
            <strong>
              {text(
                "GeoGebra is unavailable right now.",
                "GeoGebra est indisponible pour le moment.",
              )}
            </strong>
            <p className="visually-hidden">{state.message}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {text("Try opening it again", "Réessayer l'ouverture")}
            </button>
          </div>
        ) : null}
        <div
          ref={containerRef}
          className="geogebra-scratchpad-canvas"
          aria-label={text("GeoGebra drawing board", "Tableau de dessin GeoGebra")}
          aria-busy={checkpointRestoring}
          data-checkpoint-restoring={checkpointRestoring}
          inert={checkpointRestoring}
        />
        {canvasOverlay}
        <GeometryGuidanceOverlay
          presentation={guidancePresentation}
          appletRootRef={containerRef}
          locale={activity.locale}
          onDismiss={dismissGuidance}
        />
        {checkpointRestoring ? (
          <div className="geogebra-checkpoint-barrier" role="status">
            {text(
              "Restoring the verified figure…",
              "Restauration de la figure vérifiée…",
            )}
          </div>
        ) : null}
      </div>
      {evidenceHarnessEnabled ? (
        <GeometryEvidenceGallery
          captures={evidenceCaptures}
          locale={activity.locale}
          replayStatus={replayStatus}
          onRestore={(checkpointId) =>
            evidenceHarnessRef.current?.restore(checkpointId) ??
            Promise.reject(new Error("Evidence runtime is not ready."))
          }
          onDemonstrate={() =>
            evidenceHarnessRef.current?.demonstrate() ??
            Promise.reject(new Error("Evidence runtime is not ready."))
          }
          onPause={() => evidenceHarnessRef.current?.pause()}
          onResume={() => evidenceHarnessRef.current?.resume()}
          onStop={() => evidenceHarnessRef.current?.stop()}
        />
      ) : null}
      {learningHarnessEnabled && learningSession ? (
        <GeometryInvestigationPanel
          activity={activity}
          state={learningSession}
          directive={learningDirective}
          onCapture={(missionId, configuration) =>
            evidenceHarnessRef.current?.capture(missionId, configuration) ??
            Promise.reject(new Error("Evidence runtime is not ready."))
          }
          onRequestHelp={() => {
            if (!learningRuntimeRef(window)) return;
            pulseMascot("geometry-help-request", "thinking", 1_200);
            const runtime = window.__GEOTUTOR_LEARNING_V1__ as {
              requestHelp(): unknown;
            };
            runtime.requestHelp();
          }}
          onConfirmDirective={(directive) =>
            learningDirectiveActionRef.current?.deliver(directive, true) ??
            Promise.resolve(false)
          }
          onCompleteReflection={(kind, hasText) => {
            if (!hasText || !window.__GEOTUTOR_LEARNING_V1__) return;
            const runtime = window.__GEOTUTOR_LEARNING_V1__ as {
              completeReflection(
                kind: "conjecture" | "transfer",
                completionId: string,
              ): void;
            };
            runtime.completeReflection(
              kind,
              `${kind}_${learningSession.epoch}_${learningSession.revision}`,
            );
          }}
          onCompleteJustificationStep={(stepId) => {
            if (!window.__GEOTUTOR_LEARNING_V1__) return;
            const runtime = window.__GEOTUTOR_LEARNING_V1__ as {
              completeJustificationStep(
                stepId: string,
                completionId: string,
              ): void;
            };
            runtime.completeJustificationStep(
              stepId,
              `learner_${stepId}_${learningSession.epoch}`,
            );
          }}
        />
      ) : null}
    </section>
  );
}

type MutableInvestigationAuthority = Omit<
  GeometryActionAuthorityV1,
  "activityId" | "epoch" | "revision" | "phase" | "actor" | "maxLevel" | "missionId" | "attemptedVariationTargets" | "attemptedDemonstrationStepIds" | "learnerActionCurrent"
> & {
  activityId: string;
  epoch: number;
  revision: number;
  phase: GeometryActionAuthorityV1["phase"];
  actor: GeometryActionAuthorityV1["actor"];
  maxLevel: GeometryActionAuthorityV1["maxLevel"];
  missionId?: string;
  attemptedVariationTargets: ("convex" | "concave" | "crossed")[];
  attemptedDemonstrationStepIds: string[];
  learnerActionCurrent: boolean;
};

type EvidenceHarnessControls = {
  capture(
    missionId: string,
    configuration: "convex" | "concave" | "crossed",
  ): Promise<void>;
  restore(checkpointId: string): Promise<void>;
  demonstrate(): Promise<void>;
  pause(): boolean | undefined;
  resume(): boolean | undefined;
  stop(): boolean | undefined;
};

function learningRuntimeRef(target: Window): boolean {
  return Boolean(target.__GEOTUTOR_LEARNING_V1__);
}

function isInvestigationScaffoldReady(
  activity: GeometryInvestigationV1,
  world: GeometryWorldV2,
): boolean {
  const byName = new Map(world.objects.map((object) => [object.name, object]));
  if (
    !activity.scaffold.freePoints.every(
      ({ label }) => byName.get(label)?.owner === "scaffold",
    )
  ) {
    return false;
  }
  return activity.scaffold.edges.every(({ from, to }) =>
    world.objects.some(
      (object) =>
        object.owner === "scaffold" &&
        object.parents.length === 2 &&
        object.parents.includes(from) &&
        object.parents.includes(to),
    ),
  );
}

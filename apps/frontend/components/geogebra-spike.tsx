"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { collectGeoGebraEvidence } from "@/lib/geogebra";
import { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import { GeoGebraAccessibilityGuard } from "@/lib/geogebra/accessibility";
import { CompletedActionBridge } from "@/lib/geogebra/action-bridge";
import { initializeMinimalScene, SceneRegistry } from "@/lib/geogebra/scene";
import { SnapshotService } from "@/lib/geogebra/snapshot";
import { PerpendicularBisectorValidator } from "@/lib/geogebra/validator";
import { CheckpointService } from "@/lib/geogebra/checkpoint";
import type {
  ResetReason,
  ResetResult,
} from "@/lib/geogebra/checkpoint";
import {
  HintOrchestrator,
  type HintDeliveryResult,
} from "@/lib/geogebra/hint-orchestrator";
import {
  applyValidationResult,
  initialProgress,
} from "@/lib/geogebra/progress";
import type {
  BisectorValidation,
  CompletedConstructionAction,
  ConstructionSnapshot,
  GeoGebraEvidence,
} from "@/types/geogebra";
import { ToolGateway } from "@/lib/tools/gateway";
import { createCoreToolHandlers } from "@/lib/tools/handlers";
import { HighlightManager } from "@/lib/tools/highlight";
import type { ToolRuntime, ToolWorkflowAuthority } from "@/lib/tools/runtime";
import {
  ExerciseInitializationService,
  type ExerciseInitializationRuntime,
} from "@/lib/geogebra/exercise-initialization";
import type { ExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import { ProgressFeedback } from "./progress-feedback";
import {
  initialProgressViewModel,
  selectProgressViewModel,
} from "@/lib/pedagogy/progress-view-model";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvent,
  type PedagogyState,
  type VerifiedFact,
} from "@/lib/pedagogy/state";
import {
  createFactSignature,
  deriveMeaningfulDelta,
} from "@/lib/pedagogy/meaningful-delta";
import { runLocalFirstAction, type LocalFirstTrace } from "@/lib/pedagogy/action-pipeline";
import {
  materializeDirective,
  queueDirective,
  toPendingIntervention,
  type InterventionDirective,
} from "@/lib/pedagogy/directive";
import {
  createHintAuthorization,
  HintConfirmationLedger,
  type HintAuthorization,
} from "@/lib/pedagogy/hint-assistance";
import {
  decideIntervention,
  type PolicyDecision,
} from "@/lib/pedagogy/policy";
import type {
  RealtimeInvarianceRequestRuntime,
  RealtimeInvarianceSummaryRuntime,
  RealtimePedagogyRuntime,
  RealtimeProactiveRuntime,
} from "@/lib/realtime/webrtc-session";
import { shouldInvalidateQueuedDirective } from "@/lib/realtime/proactive-turn";
import type {
  CancellationReason,
  EvidenceLog,
} from "@/lib/pedagogy/evidence-log";
import {
  InvarianceSceneService,
  type InvarianceSceneReport,
} from "@/lib/invariance/invariance-scene";
import { GeoGebraInvarianceSampler } from "@/lib/invariance/geogebra-sampler";
import { RunInvarianceTestOperation } from "@/lib/invariance/run-invariance-test";
import type {
  InvarianceRunCompleted,
  InvarianceRunHandle,
  InvarianceInputEvidenceIds,
  InvarianceRunResult,
} from "@/lib/invariance/contracts";
import {
  InvarianceVerbalizationCoordinator,
  type InvarianceMeasurementsView,
  type InvarianceVerbalizationContext,
  type InvarianceVerbalizationResult,
} from "@/lib/invariance/verbalization";
import type { InvarianceSummaryRender } from "@/lib/realtime/invariance-summary";
import type {
  OperationArbiter,
  OperationLease,
} from "@/lib/operations/arbiter";
import {
  InvarianceExperiment,
  type InvarianceExperimentRuntime,
} from "./invariance-experiment";
import type { LatencyBudgetMonitor } from "@/lib/reliability/latency-budget";
import { useLanguage } from "@/components/language-provider";
import { useMascotController } from "@/components/compass-mascot";

type SpikeState =
  | { phase: "loading" }
  | { phase: "ready"; evidence: GeoGebraEvidence }
  | { phase: "unavailable"; message: string };

const LOAD_TIMEOUT_MS = 30_000;

type PendingGuidedHint = {
  authorization: HintAuthorization;
  directive: InterventionDirective;
  decision: Extract<PolicyDecision, { type: "speak" }>;
  confirmationToken: string;
};

export function GeoGebraSpike({
  onToolRuntime,
  onExerciseInitializationRuntime,
  onConstructionReset,
  toolWorkflowAuthority,
  onPedagogyRuntime,
  requestProactive,
  requestInvarianceSummary,
  onInvarianceSummaryRuntime,
  cancelRealtime,
  evidenceLog,
  operationArbiter,
  latencyMonitor,
}: {
  onToolRuntime?(runtime?: ToolRuntime): void;
  onExerciseInitializationRuntime?(runtime?: ExerciseInitializationRuntime): void;
  onConstructionReset?(): void;
  toolWorkflowAuthority?: ToolWorkflowAuthority;
  onPedagogyRuntime?(runtime?: RealtimePedagogyRuntime): void;
  requestProactive?: RealtimeProactiveRuntime["requestProactive"];
  requestInvarianceSummary?: RealtimeInvarianceRequestRuntime["requestInvarianceSummary"];
  onInvarianceSummaryRuntime?(runtime?: RealtimeInvarianceSummaryRuntime): void;
  cancelRealtime?(reason: CancellationReason): boolean;
  evidenceLog?: EvidenceLog;
  operationArbiter?: OperationArbiter;
  latencyMonitor?: LatencyBudgetMonitor;
}) {
  const { text } = useLanguage();
  const {
    start: startMascot,
    stop: stopMascot,
    pulse: pulseMascot,
    reset: resetMascot,
  } = useMascotController();
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SpikeState>({ phase: "loading" });
  const [progress, setProgress] = useState(initialProgress());
  const [progressView, setProgressView] = useState(initialProgressViewModel());
  const progressViewRef = useRef(progressView);
  const progressRenderAckRef = useRef<(() => void) | null>(null);
  const pedagogyStateRef = useRef<PedagogyState | null>(null);
  const previousSnapshotRef = useRef<ConstructionSnapshot | null>(null);
  const pedagogyEpochRef = useRef(0);
  const activePlanRef = useRef<ExercisePlanV1 | null>(null);
  const resetPedagogyRef = useRef<() => void>(() => undefined);
  const pedagogyPipelineRef = useRef<Promise<void>>(Promise.resolve());
  const directiveSequenceRef = useRef(0);
  const helpRequestSequenceRef = useRef(0);
  const hintOrchestratorRef = useRef<HintOrchestrator | undefined>(undefined);
  const hintConfirmationsRef = useRef<HintConfirmationLedger | undefined>(undefined);
  const pendingGuidedHintRef = useRef<PendingGuidedHint | undefined>(undefined);
  const [hintStatus, setHintStatus] = useState<
    "idle" | "delivering" | "confirmation_required" | "delivered" | "failed"
  >("idle");
  const [resetStatus, setResetStatus] = useState<
    "idle" | "resetting" | "recovered" | "failed" | "fatal"
  >("idle");
  const resetInFlightRef = useRef(false);
  const globalResetRef = useRef<
    | ((
        reason: ResetReason,
        recoveryPlan?: ExercisePlanV1,
      ) => Promise<ResetResult>)
    | undefined
  >(undefined);
  const exerciseInitializationRef = useRef<
    ExerciseInitializationService | undefined
  >(undefined);
  const currentValidationRef = useRef<BisectorValidation | null>(null);
  const invarianceRuntimeRef = useRef<
    InvarianceExperimentRuntime | undefined
  >(undefined);
  const [invarianceRuntime, setInvarianceRuntime] = useState<
    InvarianceExperimentRuntime | undefined
  >(undefined);
  const [invarianceSummary, setInvarianceSummary] = useState<
    InvarianceSummaryRender | null
  >(null);
  const currentInvarianceResultRef = useRef<InvarianceRunResult | null>(null);
  const renderedInvarianceRunIdsRef = useRef(new Set<string>());
  const pendingInvarianceRenderAcksRef = useRef(
    new Map<
      string,
      Readonly<{
        resolve(): void;
        reject(reason?: unknown): void;
        timeoutId: number;
      }>
    >(),
  );
  const requestInvarianceSummaryRef = useRef(requestInvarianceSummary);
  const invarianceDirectiveSequenceRef = useRef(0);
  const invarianceVerbalizationRef = useRef<
    InvarianceVerbalizationCoordinator | undefined
  >(undefined);
  const activeHintDeliveryRef = useRef<Promise<HintDeliveryResult> | undefined>(
    undefined,
  );

  useLayoutEffect(() => {
    requestInvarianceSummaryRef.current = requestInvarianceSummary;
  }, [requestInvarianceSummary]);

  const rejectPendingInvarianceRenderAcks = useCallback(() => {
    for (const pending of pendingInvarianceRenderAcksRef.current.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error("Invariance render authority was invalidated."));
    }
    pendingInvarianceRenderAcksRef.current.clear();
  }, []);

  const invalidateInvariancePipeline = useCallback(() => {
    currentInvarianceResultRef.current = null;
    renderedInvarianceRunIdsRef.current.clear();
    rejectPendingInvarianceRenderAcks();
    setInvarianceSummary(null);
    const debugWindow = window as Window & {
      __GEOTUTOR_INVARIANCE_VERBALIZATION__?: InvarianceVerbalizationResult;
      __GEOTUTOR_INVARIANCE_SUMMARY__?: InvarianceSummaryRender;
    };
    delete debugWindow.__GEOTUTOR_INVARIANCE_VERBALIZATION__;
    delete debugWindow.__GEOTUTOR_INVARIANCE_SUMMARY__;
  }, [rejectPendingInvarianceRenderAcks]);

  const getCurrentInvarianceContext = useCallback(
    (): InvarianceVerbalizationContext => {
      const state = pedagogyStateRef.current;
      const result = currentInvarianceResultRef.current;
      if (!state || !result) {
        throw new Error("Current invariance authority is unavailable.");
      }
      return Object.freeze({
        state,
        currentRunId: result.runId,
        currentRevision: result.revision,
        inputEvidenceIds: Object.freeze([...result.inputEvidenceIds]),
        evidenceIds: Object.freeze([...result.evidenceIds]),
      });
    },
    [],
  );

  const waitForInvarianceRender = useCallback(
    (view: InvarianceMeasurementsView): Promise<void> | void => {
      if (renderedInvarianceRunIdsRef.current.has(view.runId)) return;
      const existing = pendingInvarianceRenderAcksRef.current.get(view.runId);
      if (existing) return;
      return new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          pendingInvarianceRenderAcksRef.current.delete(view.runId);
          reject(new Error("Invariance result render was not acknowledged."));
        }, 2_000);
        pendingInvarianceRenderAcksRef.current.set(
          view.runId,
          Object.freeze({ resolve, reject, timeoutId }),
        );
      });
    },
    [],
  );

  const acknowledgeInvarianceRender = useCallback((runId: string) => {
    renderedInvarianceRunIdsRef.current.add(runId);
    const pending = pendingInvarianceRenderAcksRef.current.get(runId);
    if (!pending) return;
    pendingInvarianceRenderAcksRef.current.delete(runId);
    window.clearTimeout(pending.timeoutId);
    pending.resolve();
  }, []);

  const renderInvarianceSummary = useCallback(
    (summary: InvarianceSummaryRender) => {
      const context = getCurrentInvarianceContext();
      if (
        context.currentRunId !== summary.runId ||
        context.currentRevision !== summary.revision ||
        context.state.revision !== summary.revision
      ) {
        throw new Error("Stale invariance summary rejected.");
      }
      setInvarianceSummary(Object.freeze(summary));
      const debugWindow = window as Window & {
        __GEOTUTOR_INVARIANCE_SUMMARY__?: InvarianceSummaryRender;
      };
      debugWindow.__GEOTUTOR_INVARIANCE_SUMMARY__ = summary;
    },
    [getCurrentInvarianceContext],
  );

  useEffect(() => {
    invarianceVerbalizationRef.current = new InvarianceVerbalizationCoordinator({
      getCurrentContext: getCurrentInvarianceContext,
      renderMeasurements: waitForInvarianceRender,
      createDirectiveId: () =>
        `invariance-directive-${++invarianceDirectiveSequenceRef.current}`,
      onDirectiveReady: async (directive) => {
        const result = currentInvarianceResultRef.current;
        const request = requestInvarianceSummaryRef.current;
        if (
          !result ||
          result.status !== "completed" ||
          !result.pass ||
          !request
        ) {
          throw new Error("Invariance summary request is unavailable.");
        }
        const outcome = await request(result as InvarianceRunCompleted, directive);
        if (outcome.status === "ignored") {
          throw new Error(`Invariance summary ignored: ${outcome.reason}`);
        }
      },
    });
    return () => {
      invarianceVerbalizationRef.current = undefined;
    };
  }, [getCurrentInvarianceContext, waitForInvarianceRender]);

  const handleInvarianceResult = useCallback(async (result: InvarianceRunResult) => {
    currentInvarianceResultRef.current = result;
    const outcome = await invarianceVerbalizationRef.current?.receive(result);
    if (!outcome) return;
    const debugWindow = window as Window & {
      __GEOTUTOR_INVARIANCE_VERBALIZATION__?: InvarianceVerbalizationResult;
    };
    debugWindow.__GEOTUTOR_INVARIANCE_VERBALIZATION__ = outcome;
  }, []);

  useLayoutEffect(() => {
    progressViewRef.current = progressView;
    progressRenderAckRef.current?.();
    progressRenderAckRef.current = null;
  }, [progressView]);

  const cancelLocalEffects = useCallback((reason: CancellationReason) => {
    const hintCancelled = hintOrchestratorRef.current?.cancelActive(
      reason === "student_drag" || reason === "stale_revision"
        ? "new_action"
        : "cancelled",
    ) ?? false;
    let current = pedagogyStateRef.current;
    const pendingId = current?.pendingIntervention?.directiveId;
    if (current && pendingId) {
      current = pedagogyReducer(current, {
        type: "directive_invalidated",
        directiveId: pendingId,
        ...pedagogyAnchor(current),
      });
      pedagogyStateRef.current = current;
      hintConfirmationsRef.current?.invalidate(pendingId);
    }
    pendingGuidedHintRef.current = undefined;
    if (hintCancelled || pendingId) {
      stopMascot("guided-hint");
      setHintStatus("idle");
    }
    return hintCancelled || Boolean(pendingId);
  }, [stopMascot]);

  const resetConstruction = async () => {
    const reset = globalResetRef.current;
    if (!reset || resetInFlightRef.current) return;
    resetInFlightRef.current = true;
    setResetStatus("resetting");
    startMascot("workspace-reset", "modifying");
    try {
      const result = await reset("user_request", activePlanRef.current ?? undefined);
      if (!result.ok) {
        setResetStatus(result.error.state === "fatal" ? "fatal" : "failed");
        pulseMascot("workspace-reset-error", "error", 2_400);
        return;
      }
      delete window.__GEOTUTOR_INITIALIZATION__;
      onConstructionReset?.();
      const evidence = window.__GEOTUTOR_GGB_EVIDENCE__;
      if (evidence) setState({ phase: "ready", evidence });
      delete window.__GEOTUTOR_LAST_ACTION__;
      delete window.__GEOTUTOR_VALIDATION__;
      setResetStatus(result.value.recovered ? "recovered" : "idle");
      resetMascot();
    } catch {
      setResetStatus("failed");
      pulseMascot("workspace-reset-error", "error", 2_400);
    } finally {
      stopMascot("workspace-reset");
      resetInFlightRef.current = false;
    }
  };

  const invalidateGuidedHint = () => {
    const pending = pendingGuidedHintRef.current;
    const current = pedagogyStateRef.current;
    if (pending && current?.pendingIntervention?.directiveId === pending.directive.directiveId) {
      pedagogyStateRef.current = pedagogyReducer(current, {
        type: "directive_invalidated",
        directiveId: pending.directive.directiveId,
        ...pedagogyAnchor(current),
      });
      hintConfirmationsRef.current?.invalidate(pending.directive.directiveId);
    }
    pendingGuidedHintRef.current = undefined;
    stopMascot("guided-hint");
    setHintStatus("idle");
  };

  const deliverAuthorizedHint = async (
    authorization: HintAuthorization,
    directive: InterventionDirective,
    decision: Extract<PolicyDecision, { type: "speak" }>,
    confirmationToken?: string,
  ) => {
    const orchestrator = hintOrchestratorRef.current;
    const current = pedagogyStateRef.current;
    if (!orchestrator || !current) {
      setHintStatus("failed");
      pulseMascot("guided-hint-error", "error", 2_400);
      return;
    }
    startMascot("guided-hint", "hinting");
    setHintStatus("delivering");
    const requestStatus = requestProactive?.(decision, directive) ?? "unavailable";
    if (requestStatus !== "item_sent") {
      if (current.pendingIntervention?.directiveId === directive.directiveId) {
        pedagogyStateRef.current = pedagogyReducer(current, {
          type: "directive_invalidated",
          directiveId: directive.directiveId,
          ...pedagogyAnchor(current),
        });
      }
      setHintStatus("failed");
      stopMascot("guided-hint");
      pulseMascot("guided-hint-error", "error", 2_400);
      return;
    }
    const deliveryPromise = orchestrator.deliver(
      authorization,
      {
        revision: directive.baseRevision,
        confirmationToken,
      },
    );
    activeHintDeliveryRef.current = deliveryPromise;
    let delivery: HintDeliveryResult;
    try {
      delivery = await deliveryPromise;
    } catch {
      setHintStatus("failed");
      pulseMascot("guided-hint-error", "error", 2_400);
      return;
    } finally {
      if (activeHintDeliveryRef.current === deliveryPromise) {
        activeHintDeliveryRef.current = undefined;
      }
      stopMascot("guided-hint");
    }
    const live = pedagogyStateRef.current;
    if (delivery.status === "delivered" && live) {
      pedagogyStateRef.current = pedagogyReducer(live, {
        type: "assistance_delivered",
        directiveId: directive.directiveId,
        level: authorization.level,
        source: authorization.source,
        ...pedagogyAnchor(live),
      });
      setHintStatus("delivered");
      return;
    }
    setHintStatus("failed");
    pulseMascot("guided-hint-error", "error", 2_400);
  };

  const requestExplicitHint = async () => {
    const current = pedagogyStateRef.current;
    if (
      !current ||
      current.verifiedFacts.length === 0 ||
      current.pendingIntervention ||
      current.activeResponse ||
      pendingGuidedHintRef.current
    ) {
      setHintStatus("failed");
      return;
    }
    const requestId = `help-${current.epoch}-${++helpRequestSequenceRef.current}`;
    const requested = pedagogyReducer(current, {
      type: "explicit_help_requested",
      requestId,
      ...pedagogyAnchor(current),
    });
    const decision = decideIntervention(requested, {
      type: "explicit_help",
      requestId,
    });
    if (decision.type !== "speak") {
      pedagogyStateRef.current = requested;
      setHintStatus("failed");
      return;
    }
    const materialized = materializeDirective(
      requested,
      decision.directiveDraft,
      () => `directive-${requested.epoch}-${++directiveSequenceRef.current}`,
    );
    const queued = materialized ? queueDirective(materialized) : null;
    if (!queued?.ok) {
      pedagogyStateRef.current = requested;
      setHintStatus("failed");
      return;
    }
    const authorization = createHintAuthorization(requested, queued.directive);
    if (!authorization) {
      pedagogyStateRef.current = requested;
      setHintStatus("failed");
      return;
    }
    let next = pedagogyReducer(requested, {
      type: "policy_evaluated",
      decision: "SPEAK",
      sourceActionId: null,
      sourceRequestId: requestId,
      ...pedagogyAnchor(requested),
    });
    next = pedagogyReducer(next, {
      type: "directive_queued",
      intervention: toPendingIntervention(queued.directive),
      ...pedagogyAnchor(next),
    });
    pedagogyStateRef.current = next;
    evidenceLog?.append({
      revision: queued.directive.baseRevision,
      kind: "directive",
      correlationIds: {
        directiveId: queued.directive.directiveId,
        evidenceIds: queued.directive.evidenceIds,
      },
      status: "queued",
    });

    if (authorization.level === 4) {
      const challenge = hintConfirmationsRef.current?.issue(
        authorization,
        queued.directive.baseRevision,
      );
      if (!challenge) {
        pedagogyStateRef.current = pedagogyReducer(next, {
          type: "directive_invalidated",
          directiveId: queued.directive.directiveId,
          ...pedagogyAnchor(next),
        });
        setHintStatus("failed");
        return;
      }
      pendingGuidedHintRef.current = {
        authorization,
        directive: queued.directive,
        decision,
        confirmationToken: challenge.token,
      };
      setHintStatus("confirmation_required");
      return;
    }
    await deliverAuthorizedHint(authorization, queued.directive, decision);
  };

  const confirmGuidedHint = async () => {
    const pending = pendingGuidedHintRef.current;
    if (!pending) return;
    pendingGuidedHintRef.current = undefined;
    await deliverAuthorizedHint(
      pending.authorization,
      pending.directive,
      pending.decision,
      pending.confirmationToken,
    );
  };

  useEffect(() => {
    const container = containerRef.current;
    const renderedInvarianceRunIds = renderedInvarianceRunIdsRef.current;
    let disposed = false;
    const adapter = new GeoGebraAdapter();
    const registry = new SceneRegistry();
    let bridge: CompletedActionBridge | undefined;
    let highlights: HighlightManager | undefined;
    let hintOrchestrator: HintOrchestrator | undefined;
    let dragOperation: OperationLease | undefined;
    let globalResetPromise: Promise<ResetResult> | undefined;

    if (!container) {
      return;
    }
    const accessibilityGuard = new GeoGebraAccessibilityGuard(container);
    accessibilityGuard.start();

    const timeout = window.setTimeout(() => {
      if (!disposed) {
        setState({
          phase: "unavailable",
          message: "GeoGebra did not become ready within 30 seconds.",
        });
        pulseMascot("geogebra-error", "error", 2_400);
      }
    }, LOAD_TIMEOUT_MS);

    const start = async () => {
      try {
        const loadResult = await adapter.load(container, {
          id: "geotutor-ggb-spike",
          width: 860,
          height: 520,
        });
        if (disposed) {
          return;
        }
        if (!loadResult.ok) {
          throw new Error(loadResult.error.message);
        }
        const sceneResult = initializeMinimalScene(adapter, registry);
        if (!sceneResult.ok) {
          throw new Error(sceneResult.error.message);
        }
        const evidenceResult = adapter.withApi(collectGeoGebraEvidence);
        if (!evidenceResult.ok) {
          throw new Error(evidenceResult.error.message);
        }
        const snapshots = new SnapshotService(adapter, registry);
        const initialSnapshot = snapshots.capture();
        if (!initialSnapshot.ok) {
          throw new Error(initialSnapshot.error.message);
        }
        const startingProgress = initialProgress(initialSnapshot.value.revision);
        setProgress(startingProgress);
        window.__GEOTUTOR_PROGRESS__ = startingProgress;
        const activatePedagogy = (
          plan: ExercisePlanV1,
          snapshot: ConstructionSnapshot,
        ) => {
          pedagogyEpochRef.current += 1;
          activePlanRef.current = plan;
          previousSnapshotRef.current = snapshot;
          const nextState = createInitialPedagogyState(plan, {
            epoch: pedagogyEpochRef.current,
            revision: snapshot.revision,
            snapshotHash: snapshot.hash,
          });
          pedagogyStateRef.current = nextState;
          onPedagogyRuntime?.({
            getState() {
              const live = pedagogyStateRef.current;
              if (!live) throw new Error("Pedagogy state is unavailable.");
              return live;
            },
            dispatch(event) {
              const live = pedagogyStateRef.current;
              if (!live) throw new Error("Pedagogy state is unavailable.");
              const updated = pedagogyReducer(live, event);
              pedagogyStateRef.current = updated;
              return updated;
            },
            cancelLocalEffects,
          });
          const nextView = selectProgressViewModel(
            nextState,
            progressViewRef.current,
          );
          progressViewRef.current = nextView;
          setProgressView(nextView);
        };
        resetPedagogyRef.current = () => {
          invarianceRuntimeRef.current?.cancelActive?.("reset");
          invalidateInvariancePipeline();
          currentValidationRef.current = null;
          setInvarianceRuntime(undefined);
          const plan = activePlanRef.current;
          const snapshot = snapshots.capture();
          if (!plan || !snapshot.ok) {
            pedagogyStateRef.current = null;
            previousSnapshotRef.current = snapshot.value;
            const nextView = initialProgressViewModel();
            progressViewRef.current = nextView;
            setProgressView(nextView);
            return;
          }
          previousSnapshotRef.current = snapshot.value;
          const nextState = createInitialPedagogyState(plan, {
            epoch: pedagogyEpochRef.current,
            revision: snapshot.value.revision,
            snapshotHash: snapshot.value.hash,
          });
          pedagogyStateRef.current = nextState;
          const nextView = selectProgressViewModel(
            nextState,
            progressViewRef.current,
          );
          progressViewRef.current = nextView;
          setProgressView(nextView);
        };
        const validator = new PerpendicularBisectorValidator(adapter, registry);
        bridge = new CompletedActionBridge(adapter, registry, snapshots, (action) => {
          window.__GEOTUTOR_LAST_ACTION__ = action;
          if (action.studentAffectedNames.length > 0) {
            const actionEpoch = pedagogyStateRef.current?.epoch ?? 0;
            const actionOperation = operationArbiter?.begin({
              kind: "student_action",
              epoch: actionEpoch,
              revision: action.revision,
            });
            if (actionOperation && !actionOperation.accepted) return;
            invarianceRuntimeRef.current?.cancelActive?.("stale_revision");
            invalidateInvariancePipeline();
            const commitActionUi = (effect: () => void) => {
              if (actionOperation) {
                actionOperation.commit(
                  "ui_commit",
                  { epoch: actionEpoch },
                  effect,
                );
              } else {
                effect();
              }
            };
            commitActionUi(() => setInvarianceRuntime(undefined));
            if (!(cancelRealtime?.("stale_revision") ?? false)) {
              cancelLocalEffects("stale_revision");
            }
            const wasComplete = currentValidationRef.current?.score === 2;
            const validation = validator.validate(action.revision);
            currentValidationRef.current = validation.ok
              ? validation.value
              : null;
            if (validation.ok && validation.value.score === 2) {
              commitActionUi(() => {
                setInvarianceRuntime(invarianceRuntimeRef.current);
                if (!wasComplete) {
                  pulseMascot("construction-complete", "celebrating", 2_600);
                }
              });
            }
            commitActionUi(() => {
              window.__GEOTUTOR_VALIDATION__ = validation;
              setProgress((current) => {
                const next = applyValidationResult(
                  current,
                  validation,
                  action.revision,
                );
                window.__GEOTUTOR_PROGRESS__ = next;
                return next;
              });
            });
            const currentSnapshot = snapshots.capture();
            if (!validation.ok || !currentSnapshot.ok) {
              const nextView = {
                ...initialProgressViewModel(),
                announcement: "Local evidence needs revalidation.",
              };
              commitActionUi(() => {
                progressViewRef.current = nextView;
                setProgressView(nextView);
              });
              previousSnapshotRef.current = currentSnapshot.value;
              actionOperation?.finish("validation_failed");
              return;
            }
            pedagogyPipelineRef.current = pedagogyPipelineRef.current.then(
              async () => {
                const currentState = pedagogyStateRef.current;
                const previousSnapshot = previousSnapshotRef.current;
                if (
                  !currentState ||
                  !previousSnapshot ||
                  disposed ||
                  (actionOperation &&
                    !actionOperation.isCurrent("ui_commit", {
                      epoch: actionEpoch,
                    }))
                ) {
                  return;
                }
                const sourceEpoch = currentState.epoch;
                const event = createValidatedActionEvent(
                  currentState,
                  action,
                  previousSnapshot,
                  currentSnapshot.value,
                  validation.value,
                );
                const result = await runLocalFirstAction(
                  currentState,
                  event,
                  progressViewRef.current,
                  {
                    renderProgress: (model) =>
                      new Promise<void>((resolve) => {
                        const render = () => {
                          progressRenderAckRef.current = resolve;
                          progressViewRef.current = model;
                          setProgressView(model);
                        };
                        if (actionOperation) {
                          const committed = actionOperation.commit(
                            "ui_commit",
                            { epoch: sourceEpoch },
                            render,
                          );
                          if (committed === undefined) resolve();
                        } else {
                          render();
                        }
                      }),
                    evidenceLog,
                    latencyMonitor,
                  },
                );
                if (
                  disposed ||
                  !result.accepted ||
                  pedagogyStateRef.current?.epoch !== sourceEpoch ||
                  (actionOperation &&
                    !actionOperation.isCurrent("ui_commit", {
                      epoch: sourceEpoch,
                      revision: action.revision,
                    }))
                ) {
                  return;
                }
                let nextPedagogyState = result.state;
                let directive: InterventionDirective | null = null;
                if (result.decision?.type === "speak") {
                  directive = materializeDirective(
                    result.state,
                    result.decision.directiveDraft,
                    () => `directive-${sourceEpoch}-${++directiveSequenceRef.current}`,
                  );
                }
                if (result.decision) {
                  nextPedagogyState = pedagogyReducer(nextPedagogyState, {
                    type: "policy_evaluated",
                    decision: policyDecisionType(result.decision),
                    sourceActionId: event.actionId,
                    sourceRequestId: null,
                    epoch: nextPedagogyState.epoch,
                    revision: nextPedagogyState.revision,
                    snapshotHash: nextPedagogyState.studentSnapshotHash,
                  });
                }
                if (result.decision?.type === "speak" && directive) {
                  const queued = queueDirective(directive);
                  if (queued.ok) {
                    directive = queued.directive;
                    nextPedagogyState = pedagogyReducer(nextPedagogyState, {
                      type: "directive_queued",
                      intervention: toPendingIntervention(directive),
                      epoch: nextPedagogyState.epoch,
                      revision: nextPedagogyState.revision,
                      snapshotHash: nextPedagogyState.studentSnapshotHash,
                    });
                    evidenceLog?.append({
                      revision: directive.baseRevision,
                      actionId: event.actionId,
                      kind: "directive",
                      correlationIds: {
                        directiveId: directive.directiveId,
                        evidenceIds: directive.evidenceIds,
                      },
                      status: "queued",
                    });
                    commitActionUi(() => {
                      pedagogyStateRef.current = nextPedagogyState;
                    });
                    const sendProactive = () =>
                      requestProactive?.(result.decision!, directive!) ??
                      "unavailable";
                    const requestStatus = actionOperation
                      ? actionOperation.commit(
                          "realtime_emit",
                          { epoch: sourceEpoch, revision: action.revision },
                          sendProactive,
                        ) ?? "unavailable"
                      : sendProactive();
                    if (shouldInvalidateQueuedDirective(requestStatus)) {
                      nextPedagogyState = pedagogyReducer(nextPedagogyState, {
                        type: "directive_invalidated",
                        directiveId: directive.directiveId,
                        epoch: nextPedagogyState.epoch,
                        revision: nextPedagogyState.revision,
                        snapshotHash: nextPedagogyState.studentSnapshotHash,
                      });
                    }
                  }
                }
                commitActionUi(() => {
                  pedagogyStateRef.current = nextPedagogyState;
                  previousSnapshotRef.current = currentSnapshot.value;
                  const debugWindow = window as Window & {
                    __GEOTUTOR_T4_TRACE__?: readonly LocalFirstTrace[];
                    __GEOTUTOR_POLICY_DECISION__?: typeof result.decision;
                  };
                  debugWindow.__GEOTUTOR_T4_TRACE__ = result.trace;
                  debugWindow.__GEOTUTOR_POLICY_DECISION__ = result.decision;
                });
              },
            )
              .catch(() => {
                if (disposed) return;
                const nextView = {
                  ...initialProgressViewModel(),
                  announcement: "Local evidence needs revalidation.",
                };
                commitActionUi(() => {
                  progressViewRef.current = nextView;
                  setProgressView(nextView);
                });
              })
              .finally(() => actionOperation?.finish());
          }
        }, (activity) => {
          let live = pedagogyStateRef.current;
          if (!live) return;
          if (activity.type === "student_drag_started") {
            dragOperation?.finish("superseded");
            dragOperation = operationArbiter?.begin({
              kind: "student_action",
              epoch: live.epoch,
              revision: live.revision,
            });
            if (dragOperation && !dragOperation.accepted) return;
            if (!(cancelRealtime?.("student_drag") ?? false)) {
              cancelLocalEffects("student_drag");
            }
            live = pedagogyStateRef.current;
            if (!live || live.interaction.studentIsDragging) return;
          } else if (!live.interaction.studentIsDragging) {
            dragOperation?.finish("drag_ended_without_state");
            dragOperation = undefined;
            return;
          }
          const commit = () => {
            pedagogyStateRef.current = pedagogyReducer(live, {
              type: activity.type,
              ...pedagogyAnchor(live),
            });
          };
          if (dragOperation) {
            dragOperation.commit(
              "ui_commit",
              { epoch: live.epoch, revision: live.revision },
              commit,
            );
          } else {
            commit();
          }
          if (activity.type === "student_drag_ended") {
            dragOperation?.finish();
            dragOperation = undefined;
          }
        });
        const bridgeResult = bridge.start();
        if (!bridgeResult.ok) {
          throw new Error(bridgeResult.error.message);
        }
        const checkpoint = new CheckpointService(
          adapter,
          registry,
          snapshots,
          bridge,
        );
        const checkpointResult = await checkpoint.captureInitial();
        if (!checkpointResult.ok) {
          throw new Error(checkpointResult.error.message);
        }
        const exerciseInitialization = new ExerciseInitializationService(
          adapter,
          registry,
          snapshots,
          bridge,
          checkpoint,
        );
        exerciseInitializationRef.current = exerciseInitialization;
        const invarianceScene = new InvarianceSceneService(
          adapter,
          registry,
          snapshots,
          checkpoint,
          bridge,
        );
        const invarianceSampler = new GeoGebraInvarianceSampler(adapter);
        let activeInvarianceHandle: InvarianceRunHandle | undefined;
        const experimentRuntime: InvarianceExperimentRuntime = Object.freeze({
          start(observer) {
            const validation = currentValidationRef.current;
            if (!validation || validation.score !== 2 || activeInvarianceHandle) {
              return null;
            }
            invalidateInvariancePipeline();
            const operation = new RunInvarianceTestOperation({
              getCurrentValidation: () => currentValidationRef.current,
              runInTemporaryScene: (request, execute) =>
                invarianceScene.run(request, execute),
              sample: async (request) => {
                const sample = await invarianceSampler.sample(request);
                observer.onSample(sample);
                return sample;
              },
              observe: observer.onEvent,
            });
            const evidenceIds = Object.freeze(
              validation.evidence.map(({ id }) => id),
            ) as InvarianceInputEvidenceIds;
            const handle = operation.start({
              candidateLine: validation.candidate,
              revision: validation.revision,
              evidenceIds,
            });
            activeInvarianceHandle = handle;
            void handle.result.finally(() => {
              const debugWindow = window as Window & {
                __GEOTUTOR_INVARIANCE_SCENE__?: InvarianceSceneReport;
              };
              if (invarianceScene.lastReport) {
                debugWindow.__GEOTUTOR_INVARIANCE_SCENE__ =
                  invarianceScene.lastReport;
              }
              if (activeInvarianceHandle === handle) {
                activeInvarianceHandle = undefined;
              }
            });
            return handle;
          },
          cancelActive(reason) {
            return activeInvarianceHandle?.cancel(reason) ?? false;
          },
          async cancelActiveAndWait(reason) {
            const handle = activeInvarianceHandle;
            if (!handle) return false;
            const cancelled = handle.cancel(reason);
            await handle.result.catch(() => undefined);
            return cancelled;
          },
        });
        invarianceRuntimeRef.current = experimentRuntime;
        if (currentValidationRef.current?.score === 2) {
          setInvarianceRuntime(experimentRuntime);
        }
        onInvarianceSummaryRuntime?.(
          Object.freeze({
            getCurrentContext: getCurrentInvarianceContext,
            renderSummary: renderInvarianceSummary,
          }),
        );
        const runGlobalReset = (
          reason: ResetReason,
          recoveryPlan?: ExercisePlanV1,
        ): Promise<ResetResult> => {
          if (globalResetPromise) return globalResetPromise;
          const source = snapshots.capture();
          const resetOperation = operationArbiter?.begin({
            kind: "reset",
            epoch: pedagogyEpochRef.current + 1,
            revision: source.ok ? source.value.revision : 0,
          });
          const run = async (): Promise<ResetResult> => {
            const result = await exerciseInitialization.reset(reason, {
            recoveryPlan: recoveryPlan ?? activePlanRef.current ?? undefined,
            guardMutation: () =>
              resetOperation
                ? resetOperation.commit(
                    "geogebra_mutation",
                    undefined,
                    () => true,
                  ) === true
                : true,
            cancelEffects: async () => {
              const cancelledScopes = new Set<string>();
              pedagogyEpochRef.current += 1;
              if (
                resetOperation &&
                !resetOperation.isCurrent("ui_commit", {
                  epoch: pedagogyEpochRef.current,
                })
              ) {
                throw new Error("Reset authority expired before cancellation.");
              }
              const live = pedagogyStateRef.current;
              const plan = activePlanRef.current;
              if (live && plan) {
                pedagogyStateRef.current = pedagogyReducer(live, {
                  type: "epoch_reset",
                  epoch: pedagogyEpochRef.current,
                  plan,
                  stepId: live.stepId,
                  revision: live.revision,
                  snapshotHash: live.studentSnapshotHash,
                });
              } else {
                pedagogyStateRef.current = null;
              }
              cancelledScopes.add("pedagogy_epoch");

              invalidateInvariancePipeline();
              currentValidationRef.current = null;
              setInvarianceRuntime(undefined);
              cancelledScopes.add("invariance_c04_c05");
              if (await experimentRuntime.cancelActiveAndWait?.("reset")) {
                cancelledScopes.add("invariance_c01_c03");
              }

              const realtimeCancelled = cancelRealtime?.("reset") ?? false;
              if (realtimeCancelled) {
                cancelledScopes.add("realtime_responses_audio_tools");
              }
              const localCancelled = cancelLocalEffects("reset");
              const hintDelivery = activeHintDeliveryRef.current;
              if (hintDelivery) {
                await hintDelivery.catch(() => undefined);
              }
              if (localCancelled || hintDelivery) {
                cancelledScopes.add("hints");
              }
              hintConfirmationsRef.current?.clear();
              pendingGuidedHintRef.current = undefined;
              setHintStatus("idle");

              progressRenderAckRef.current?.();
              progressRenderAckRef.current = null;
              await pedagogyPipelineRef.current.catch(() => undefined);
              cancelledScopes.add("pedagogy_pipeline");
              return Object.freeze([...cancelledScopes].sort());
            },
            });
            const commitResetUi = (effect: () => void) => {
              if (resetOperation) {
                resetOperation.commit("ui_commit", undefined, effect);
              } else {
                effect();
              }
            };
            commitResetUi(() => {
              window.__GEOTUTOR_RESET__ = result;
              if (result.ok && !disposed) {
                const evidence = adapter.withApi(collectGeoGebraEvidence);
                if (evidence.ok) {
                  window.__GEOTUTOR_GGB_EVIDENCE__ = evidence.value;
                  setState({ phase: "ready", evidence: evidence.value });
                }
                const nextProgress = initialProgress(
                  result.value.snapshot.revision,
                );
                window.__GEOTUTOR_PROGRESS__ = nextProgress;
                setProgress(nextProgress);
                resetPedagogyRef.current();
                setResetStatus(result.value.recovered ? "recovered" : "idle");
              } else if (!result.ok && !disposed) {
                setResetStatus(
                  result.error.state === "fatal" ? "fatal" : "failed",
                );
              }
            });
            return result;
          };
          globalResetPromise = run()
            .then(
              (result) => {
                resetOperation?.finish();
                if (result.ok) evidenceLog?.clear();
                return result;
              },
              (error) => {
                resetOperation?.finish("failed");
                throw error;
              },
            )
            .finally(() => {
              globalResetPromise = undefined;
            });
          return globalResetPromise;
        };
        globalResetRef.current = runGlobalReset;
        onExerciseInitializationRuntime?.({
          async initialize(confirmation, options) {
            const result = await exerciseInitialization.initialize(
              confirmation,
              options,
            );
            window.__GEOTUTOR_INITIALIZATION__ = result;
            if (
              !disposed &&
              (result.status === "initialized" ||
                result.status === "already_initialized")
            ) {
              const evidence = adapter.withApi(collectGeoGebraEvidence);
              if (evidence.ok) {
                window.__GEOTUTOR_GGB_EVIDENCE__ = evidence.value;
                setState({ phase: "ready", evidence: evidence.value });
              }
              const snapshot = snapshots.capture();
              if (snapshot.ok) {
                const nextProgress = initialProgress(snapshot.value.revision);
                window.__GEOTUTOR_PROGRESS__ = nextProgress;
                setProgress(nextProgress);
                activatePedagogy(confirmation.plan, snapshot.value);
              }
              setResetStatus("idle");
            }
            return result;
          },
          reset(reason, options) {
            return runGlobalReset(reason, options?.recoveryPlan);
          },
          async recover() {
            return runGlobalReset(
              "recovery_retry",
              activePlanRef.current ?? undefined,
            );
          },
        });
        highlights = new HighlightManager(adapter, registry);
        const hintConfirmations = new HintConfirmationLedger();
        hintConfirmationsRef.current = hintConfirmations;
        hintOrchestrator = new HintOrchestrator(
          adapter,
          registry,
          snapshots,
          checkpoint,
          highlights,
          hintConfirmations,
        );
        hintOrchestratorRef.current = hintOrchestrator;
        const gateway = new ToolGateway(
          createCoreToolHandlers({
            adapter,
            registry,
            snapshots,
            validator,
            getConfirmedExercise: (planId) =>
              toolWorkflowAuthority?.getConfirmedExercise(planId),
            initializeExercise: (confirmation, options) =>
              toolWorkflowAuthority?.initializeExercise(confirmation, options) ??
              Promise.resolve({
                status: "failed" as const,
                code: "initialization_unavailable",
                rolledBack: false,
              }),
            highlights,
          }),
        );
        onToolRuntime?.({
          gateway,
          getContext(turnId) {
            const current = snapshots.capture();
            if (!current.ok) return undefined;
            const workflowPhase = toolWorkflowAuthority?.getPhase() ?? "idle";
            const phase =
              workflowPhase === "constructing" &&
              window.__GEOTUTOR_PROGRESS__?.score === 2
                ? "completed"
                : workflowPhase;
            return {
              turnId,
              phase,
              epoch: pedagogyStateRef.current?.epoch ?? 0,
              revision: current.value.revision,
            };
          },
        });
        window.__GEOTUTOR_GGB_EVIDENCE__ = evidenceResult.value;
        window.clearTimeout(timeout);
        setState({ phase: "ready", evidence: evidenceResult.value });
      } catch (error) {
        if (!disposed) {
          window.clearTimeout(timeout);
          setState({
            phase: "unavailable",
            message:
              error instanceof Error ? error.message : "GeoGebra is unavailable.",
          });
          pulseMascot("geogebra-error", "error", 2_400);
        }
      }
    };

    void start();

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      accessibilityGuard.stop();
      delete window.__GEOTUTOR_GGB_EVIDENCE__;
      delete window.__GEOTUTOR_LAST_ACTION__;
      delete window.__GEOTUTOR_VALIDATION__;
      delete window.__GEOTUTOR_PROGRESS__;
      delete window.__GEOTUTOR_RESET__;
      delete window.__GEOTUTOR_INITIALIZATION__;
      const debugWindow = window as Window & {
        __GEOTUTOR_T4_TRACE__?: readonly LocalFirstTrace[];
        __GEOTUTOR_POLICY_DECISION__?: unknown;
      };
      delete debugWindow.__GEOTUTOR_T4_TRACE__;
      delete debugWindow.__GEOTUTOR_POLICY_DECISION__;
      delete (
        debugWindow as typeof debugWindow & {
          __GEOTUTOR_INVARIANCE_VERBALIZATION__?: InvarianceVerbalizationResult;
          __GEOTUTOR_INVARIANCE_SUMMARY__?: InvarianceSummaryRender;
          __GEOTUTOR_INVARIANCE_SCENE__?: InvarianceSceneReport;
        }
      ).__GEOTUTOR_INVARIANCE_VERBALIZATION__;
      delete (
        debugWindow as typeof debugWindow & {
          __GEOTUTOR_INVARIANCE_SUMMARY__?: InvarianceSummaryRender;
        }
      ).__GEOTUTOR_INVARIANCE_SUMMARY__;
      delete (
        debugWindow as typeof debugWindow & {
          __GEOTUTOR_INVARIANCE_SCENE__?: InvarianceSceneReport;
        }
      ).__GEOTUTOR_INVARIANCE_SCENE__;
      progressRenderAckRef.current?.();
      progressRenderAckRef.current = null;
      pedagogyStateRef.current = null;
      previousSnapshotRef.current = null;
      activePlanRef.current = null;
      resetPedagogyRef.current = () => undefined;
      pedagogyPipelineRef.current = Promise.resolve();
      resetInFlightRef.current = false;
      globalResetRef.current = undefined;
      exerciseInitializationRef.current = undefined;
      invarianceRuntimeRef.current?.cancelActive?.("application_stop");
      invarianceRuntimeRef.current = undefined;
      currentValidationRef.current = null;
      currentInvarianceResultRef.current = null;
      renderedInvarianceRunIds.clear();
      rejectPendingInvarianceRenderAcks();
      pendingGuidedHintRef.current = undefined;
      hintConfirmationsRef.current?.clear();
      hintConfirmationsRef.current = undefined;
      hintOrchestrator?.cancelActive();
      hintOrchestratorRef.current = undefined;
      stopMascot("guided-hint");
      stopMascot("guided-hint-error");
      stopMascot("workspace-reset");
      stopMascot("workspace-reset-error");
      stopMascot("construction-complete");
      stopMascot("geogebra-error");
      onToolRuntime?.(undefined);
      onExerciseInitializationRuntime?.(undefined);
      onPedagogyRuntime?.(undefined);
      onInvarianceSummaryRuntime?.(undefined);
      highlights?.cleanup();
      bridge?.stop();
      adapter.dispose();
      container.replaceChildren();
    };
  }, [
    onExerciseInitializationRuntime,
    onPedagogyRuntime,
    onToolRuntime,
    cancelLocalEffects,
    cancelRealtime,
    evidenceLog,
    getCurrentInvarianceContext,
    invalidateInvariancePipeline,
    latencyMonitor,
    onInvarianceSummaryRuntime,
    operationArbiter,
    pulseMascot,
    requestProactive,
    rejectPendingInvarianceRenderAcks,
    renderInvarianceSummary,
    stopMascot,
    toolWorkflowAuthority,
  ]);

  return (
    <section
      className="spike workspace-card workspace-card-build"
      aria-labelledby="geogebra-spike-title"
    >
      <div className="spike-heading">
        <div>
          <p className="section-index">
            {text("Step 2 · Build", "Étape 2 · Construire")}
          </p>
          <h2 id="geogebra-spike-title">
            {text("Your canvas, your move", "Ton espace, à toi de jouer")}
          </h2>
        </div>
        <p>
          {text(
            "Use the tools on the canvas to construct the perpendicular bisector. I'll quietly check each useful move.",
            "Utilise les outils pour construire la médiatrice. Je vérifie discrètement chaque geste utile.",
          )}
        </p>
      </div>

      <div className="spike-grid">
        <div
          ref={containerRef}
          className="geogebra-canvas"
          role="region"
          aria-label={text(
            "Interactive GeoGebra geometry workspace",
            "Espace de géométrie interactif GeoGebra",
          )}
        />

        <aside className="proof-panel">
          <p
            className={`proof-status proof-status-${state.phase}`}
            role="status"
            aria-live="polite"
          >
            {state.phase === "loading" && text("Loading applet", "Chargement de l'espace")}
            {state.phase === "ready" && (
              <>
                <span>{text("Workspace ready", "Espace prêt")}</span>
                <small>{text("API verified", "API vérifiée")}</small>
              </>
            )}
            {state.phase === "unavailable" && text("Applet unavailable", "Espace indisponible")}
          </p>

          {state.phase === "loading" && (
            <p>{text("Setting up your drawing tools…", "Préparation de tes outils de dessin…")}</p>
          )}

          {state.phase === "unavailable" && (
            <div className="fallback" role="alert">
              <p>
                {text(
                  state.message,
                  "L'espace GeoGebra n'a pas pu s'ouvrir.",
                )}
              </p>
              <p>
                {text(
                  "Your exercise is safe. Reload the page to try opening the canvas again.",
                  "Ton exercice est intact. Recharge la page pour essayer de rouvrir l'espace.",
                )}
              </p>
            </div>
          )}

          {state.phase === "ready" && (
            <>
              <div className="construction-progress">
                <ProgressFeedback model={progressView} />
                {progress.verifying && (
                  <p>
                    {text(
                      "Checking the latest stable construction…",
                      "Vérification de la dernière construction stable…",
                    )}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void resetConstruction()}
                  disabled={resetStatus === "resetting"}
                >
                  {resetStatus === "resetting"
                    ? text("Resetting…", "Réinitialisation…")
                    : text("Reset construction", "Réinitialiser la construction")}
                </button>
                {hintStatus !== "confirmation_required" ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void requestExplicitHint()}
                    disabled={hintStatus === "delivering"}
                  >
                    {hintStatus === "delivering"
                      ? text("Preparing help…", "Préparation de l'aide…")
                      : text("Ask for help", "Demander de l'aide")}
                  </button>
                ) : (
                  <div
                    role="group"
                    aria-label={text(
                      "Guided demonstration confirmation",
                      "Confirmation de la démonstration guidée",
                    )}
                  >
                    <p>
                      {text(
                        "A guided demonstration is temporary. Continue?",
                        "La démonstration guidée est temporaire. Continuer ?",
                      )}
                    </p>
                    <button type="button" onClick={() => void confirmGuidedHint()}>
                      {text("Confirm guided demo", "Confirmer la démonstration")}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={invalidateGuidedHint}
                    >
                      {text("Keep working myself", "Continuer par moi-même")}
                    </button>
                  </div>
                )}
                {hintStatus === "delivered" && (
                  <p role="status">
                    {text(
                      "Help delivered. The construction is back under your control.",
                      "Aide terminée. Tu as de nouveau la main sur la construction.",
                    )}
                  </p>
                )}
                {hintStatus === "failed" && (
                  <p role="alert">
                    {text(
                      "Help is unavailable. Your construction was preserved.",
                      "L'aide est indisponible. Ta construction a été conservée.",
                    )}
                  </p>
                )}
                {resetStatus === "recovered" && (
                  <p role="status">
                    {text(
                      "Construction recovered from the canonical fixture.",
                      "Construction restaurée depuis la figure de référence.",
                    )}
                  </p>
                )}
                {resetStatus === "failed" && (
                  <p role="alert">
                    {text(
                      "Reset failed. Reload the workspace before continuing.",
                      "La réinitialisation a échoué. Recharge l'espace avant de continuer.",
                    )}
                  </p>
                )}
                {resetStatus === "fatal" && (
                  <p role="alert">
                    {text(
                      "Reset could not restore a verified construction. Retry reset; no success was recorded.",
                      "La réinitialisation n'a pas restauré une construction vérifiée. Réessaie ; aucun succès n'a été enregistré.",
                    )}
                  </p>
                )}
              </div>
              <InvarianceExperiment
                runtime={invarianceRuntime}
                summary={invarianceSummary}
                onResult={handleInvarianceResult}
                onTerminalRendered={acknowledgeInvarianceRender}
              />
              <details className="proof-details">
                <summary>
                  {text(
                    "How Compass checks the construction",
                    "Comment Compass vérifie la construction",
                  )}
                </summary>
                <p className="proof-intro">
                  {text(
                    "The canvas is observed only after a stable action and every geometry result is checked locally.",
                    "L'espace est observé uniquement après une action stable et chaque résultat géométrique est vérifié localement.",
                  )}
                </p>
                <dl>
                  {state.evidence.objects.map((object) => (
                    <div key={object.label}>
                      <dt>{object.label}</dt>
                      <dd>
                        {object.command || text("independent point", "point indépendant")}
                      </dd>
                      <dd>
                        {text("exists", "existe")}: {String(object.exists)} · {text("defined", "défini")}: {String(object.defined)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function createValidatedActionEvent(
  state: PedagogyState,
  action: CompletedConstructionAction,
  previousSnapshot: ConstructionSnapshot,
  currentSnapshot: ConstructionSnapshot,
  validation: BisectorValidation,
): Extract<PedagogyEvent, { type: "validated_action_committed" }> {
  const facts: VerifiedFact[] = validation.evidence.map((evidence) => ({
    relationKey: evidence.relation,
    status: evidence.pass ? "verified" : "missing",
    evidenceId: evidence.id,
  }));
  const meaningfulDelta = deriveMeaningfulDelta({
    action,
    previousSnapshot,
    currentSnapshot,
    previousFacts: state.verifiedFacts,
    currentFacts: facts,
  });
  if (
    meaningfulDelta.previousFactSignature !==
    createFactSignature(state.verifiedFacts)
  ) {
    throw new Error("The local fact baseline changed before action commit.");
  }
  return {
    type: "validated_action_committed",
    epoch: state.epoch,
    exerciseId: state.exerciseId,
    stepId: state.stepId,
    actionId: action.id,
    revision: action.revision,
    snapshotHash: action.snapshotHash,
    facts,
    evidence: validation.evidence.map((evidence) => ({
      ...evidence,
      objects: [...evidence.objects],
      snapshotHash: action.snapshotHash,
    })),
    meaningfulDelta,
  };
}

function policyDecisionType(decision: PolicyDecision): "SILENT" | "QUEUE" | "SPEAK" {
  if (decision.type === "silent") return "SILENT";
  if (decision.type === "queue") return "QUEUE";
  return "SPEAK";
}

function pedagogyAnchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

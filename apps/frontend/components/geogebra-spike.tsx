"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  GEOGEBRA_VERSION,
  collectGeoGebraEvidence,
} from "@/lib/geogebra";
import { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import { CompletedActionBridge } from "@/lib/geogebra/action-bridge";
import { initializeMinimalScene, SceneRegistry } from "@/lib/geogebra/scene";
import { SnapshotService } from "@/lib/geogebra/snapshot";
import { PerpendicularBisectorValidator } from "@/lib/geogebra/validator";
import { CheckpointService } from "@/lib/geogebra/checkpoint";
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
  RealtimePedagogyRuntime,
  RealtimeProactiveRuntime,
} from "@/lib/realtime/webrtc-session";
import { shouldInvalidateQueuedDirective } from "@/lib/realtime/proactive-turn";
import type {
  CancellationReason,
  EvidenceLog,
} from "@/lib/pedagogy/evidence-log";

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
  cancelRealtime,
  evidenceLog,
}: {
  onToolRuntime?(runtime?: ToolRuntime): void;
  onExerciseInitializationRuntime?(runtime?: ExerciseInitializationRuntime): void;
  onConstructionReset?(): void;
  toolWorkflowAuthority?: ToolWorkflowAuthority;
  onPedagogyRuntime?(runtime?: RealtimePedagogyRuntime): void;
  requestProactive?: RealtimeProactiveRuntime["requestProactive"];
  cancelRealtime?(reason: CancellationReason): boolean;
  evidenceLog?: EvidenceLog;
}) {
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
  const [resetStatus, setResetStatus] = useState<"idle" | "resetting" | "recovered" | "failed">("idle");
  const resetInFlightRef = useRef(false);
  const exerciseInitializationRef = useRef<
    ExerciseInitializationService | undefined
  >(undefined);

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
    if (hintCancelled || pendingId) setHintStatus("idle");
    return hintCancelled || Boolean(pendingId);
  }, []);

  const resetConstruction = async () => {
    const exerciseInitialization = exerciseInitializationRef.current;
    if (!exerciseInitialization || resetInFlightRef.current) return;
    if (!(cancelRealtime?.("reset") ?? false)) cancelLocalEffects("reset");
    resetInFlightRef.current = true;
    setResetStatus("resetting");
    try {
      const result = await exerciseInitialization.recover();
      window.__GEOTUTOR_RESET__ = result;
      if (!result.ok) {
        setResetStatus("failed");
        return;
      }
      delete window.__GEOTUTOR_INITIALIZATION__;
      onConstructionReset?.();
      const evidence = window.__GEOTUTOR_GGB_EVIDENCE__;
      if (evidence) setState({ phase: "ready", evidence });
      const nextProgress = initialProgress(result.value.snapshot.revision);
      setProgress(nextProgress);
      window.__GEOTUTOR_PROGRESS__ = nextProgress;
      resetPedagogyRef.current();
      delete window.__GEOTUTOR_LAST_ACTION__;
      delete window.__GEOTUTOR_VALIDATION__;
      setResetStatus(result.value.recovered ? "recovered" : "idle");
    } catch {
      setResetStatus("failed");
    } finally {
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
      return;
    }
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
      return;
    }
    const delivery: HintDeliveryResult = await orchestrator.deliver(
      authorization,
      {
        revision: directive.baseRevision,
        confirmationToken,
      },
    );
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
      eventType: "directive_queued",
      epoch: queued.directive.epoch,
      revision: queued.directive.baseRevision,
      decision: "SPEAK",
      directiveId: queued.directive.directiveId,
      evidenceIds: queued.directive.evidenceIds,
      outcome: "accepted",
      reason: "explicit_help",
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
    let disposed = false;
    const adapter = new GeoGebraAdapter();
    const registry = new SceneRegistry();
    let bridge: CompletedActionBridge | undefined;
    let highlights: HighlightManager | undefined;
    let hintOrchestrator: HintOrchestrator | undefined;

    if (!container) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (!disposed) {
        setState({
          phase: "unavailable",
          message: "GeoGebra did not become ready within 30 seconds.",
        });
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
          activatePedagogy(plan, snapshot.value);
        };
        const validator = new PerpendicularBisectorValidator(adapter, registry);
        bridge = new CompletedActionBridge(adapter, registry, snapshots, (action) => {
          window.__GEOTUTOR_LAST_ACTION__ = action;
          if (action.studentAffectedNames.length > 0) {
            if (!(cancelRealtime?.("stale_revision") ?? false)) {
              cancelLocalEffects("stale_revision");
            }
            const validation = validator.validate(action.revision);
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
            const currentSnapshot = snapshots.capture();
            if (!validation.ok || !currentSnapshot.ok) {
              const nextView = {
                ...initialProgressViewModel(),
                announcement: "Local evidence needs revalidation.",
              };
              progressViewRef.current = nextView;
              setProgressView(nextView);
              previousSnapshotRef.current = currentSnapshot.value;
              return;
            }
            pedagogyPipelineRef.current = pedagogyPipelineRef.current.then(
              async () => {
                const currentState = pedagogyStateRef.current;
                const previousSnapshot = previousSnapshotRef.current;
                if (!currentState || !previousSnapshot || disposed) return;
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
                        progressRenderAckRef.current = resolve;
                        progressViewRef.current = model;
                        setProgressView(model);
                      }),
                    evidenceLog,
                  },
                );
                if (
                  disposed ||
                  !result.accepted ||
                  pedagogyStateRef.current?.epoch !== sourceEpoch
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
                      eventType: "directive_queued",
                      epoch: directive.epoch,
                      revision: directive.baseRevision,
                      actionId: event.actionId,
                      decision: "SPEAK",
                      directiveId: directive.directiveId,
                      evidenceIds: directive.evidenceIds,
                      outcome: "accepted",
                      reason: result.decision.reason,
                    });
                    pedagogyStateRef.current = nextPedagogyState;
                    const requestStatus = requestProactive?.(
                      result.decision,
                      directive,
                    ) ?? "unavailable";
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
                pedagogyStateRef.current = nextPedagogyState;
                previousSnapshotRef.current = currentSnapshot.value;
                const debugWindow = window as Window & {
                  __GEOTUTOR_T4_TRACE__?: readonly LocalFirstTrace[];
                  __GEOTUTOR_POLICY_DECISION__?: typeof result.decision;
                };
                debugWindow.__GEOTUTOR_T4_TRACE__ = result.trace;
                debugWindow.__GEOTUTOR_POLICY_DECISION__ = result.decision;
              },
            ).catch(() => {
              if (disposed) return;
              const nextView = {
                ...initialProgressViewModel(),
                announcement: "Local evidence needs revalidation.",
              };
              progressViewRef.current = nextView;
              setProgressView(nextView);
            });
          }
        }, (activity) => {
          let live = pedagogyStateRef.current;
          if (!live) return;
          if (activity.type === "student_drag_started") {
            if (!(cancelRealtime?.("student_drag") ?? false)) {
              cancelLocalEffects("student_drag");
            }
            live = pedagogyStateRef.current;
            if (!live || live.interaction.studentIsDragging) return;
          } else if (!live.interaction.studentIsDragging) {
            return;
          }
          pedagogyStateRef.current = pedagogyReducer(live, {
            type: activity.type,
            ...pedagogyAnchor(live),
          });
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
        onExerciseInitializationRuntime?.({
          async initialize(confirmation) {
            const result = await exerciseInitialization.initialize(confirmation);
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
          async recover() {
            const result = await exerciseInitialization.recover();
            window.__GEOTUTOR_RESET__ = result;
            if (result.ok && !disposed) {
              const evidence = adapter.withApi(collectGeoGebraEvidence);
              if (evidence.ok) {
                window.__GEOTUTOR_GGB_EVIDENCE__ = evidence.value;
                setState({ phase: "ready", evidence: evidence.value });
              }
              const nextProgress = initialProgress(result.value.snapshot.revision);
              window.__GEOTUTOR_PROGRESS__ = nextProgress;
              setProgress(nextProgress);
              resetPedagogyRef.current();
              setResetStatus(result.value.recovered ? "recovered" : "idle");
            }
            return result;
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
            initializeExercise: (confirmation) =>
              toolWorkflowAuthority?.initializeExercise(confirmation) ??
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
        }
      }
    };

    void start();

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
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
      progressRenderAckRef.current?.();
      progressRenderAckRef.current = null;
      pedagogyStateRef.current = null;
      previousSnapshotRef.current = null;
      activePlanRef.current = null;
      resetPedagogyRef.current = () => undefined;
      pedagogyPipelineRef.current = Promise.resolve();
      resetInFlightRef.current = false;
      exerciseInitializationRef.current = undefined;
      pendingGuidedHintRef.current = undefined;
      hintConfirmationsRef.current?.clear();
      hintConfirmationsRef.current = undefined;
      hintOrchestrator?.cancelActive();
      hintOrchestratorRef.current = undefined;
      onToolRuntime?.(undefined);
      onExerciseInitializationRuntime?.(undefined);
      onPedagogyRuntime?.(undefined);
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
    requestProactive,
    toolWorkflowAuthority,
  ]);

  return (
    <section className="spike" aria-labelledby="geogebra-spike-title">
      <div className="spike-heading">
        <div>
          <p className="section-index">T1 / Verifiable construction</p>
          <h2 id="geogebra-spike-title">A construction the app can verify locally</h2>
        </div>
        <p>
          GeoGebra Geometry {GEOGEBRA_VERSION} · non-commercial prototype ·
          attribution: GeoGebra
        </p>
      </div>

      <div className="spike-grid">
        <div
          ref={containerRef}
          className="geogebra-canvas"
          aria-label="Interactive GeoGebra geometry workspace"
        />

        <aside className="proof-panel">
          <p className={`proof-status proof-status-${state.phase}`}>
            {state.phase === "loading" && "Loading applet"}
            {state.phase === "ready" && "API verified"}
            {state.phase === "unavailable" && "Applet unavailable"}
          </p>

          {state.phase === "loading" && (
            <p>Waiting for the appletOnLoad API boundary…</p>
          )}

          {state.phase === "unavailable" && (
            <div className="fallback" role="alert">
              <p>{state.message}</p>
              <p>The GeoTutor shell remains available. Reload to retry the spike.</p>
            </div>
          )}

          {state.phase === "ready" && (
            <>
              <div className="construction-progress">
                <ProgressFeedback model={progressView} />
                {progress.verifying && <p>Checking the latest stable construction…</p>}
                <button
                  type="button"
                  onClick={() => void resetConstruction()}
                  disabled={resetStatus === "resetting"}
                >
                  {resetStatus === "resetting" ? "Resetting…" : "Reset construction"}
                </button>
                {hintStatus !== "confirmation_required" ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void requestExplicitHint()}
                    disabled={hintStatus === "delivering"}
                  >
                    {hintStatus === "delivering" ? "Preparing help…" : "Ask for help"}
                  </button>
                ) : (
                  <div role="group" aria-label="Guided demonstration confirmation">
                    <p>A guided demonstration is temporary. Continue?</p>
                    <button type="button" onClick={() => void confirmGuidedHint()}>
                      Confirm guided demo
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={invalidateGuidedHint}
                    >
                      Keep working myself
                    </button>
                  </div>
                )}
                {hintStatus === "delivered" && (
                  <p role="status">Help delivered. The construction is back under your control.</p>
                )}
                {hintStatus === "failed" && (
                  <p role="alert">Help is unavailable. Your construction was preserved.</p>
                )}
                {resetStatus === "recovered" && (
                  <p role="status">Construction recovered from the canonical fixture.</p>
                )}
                {resetStatus === "failed" && (
                  <p role="alert">Reset failed. Reload the workspace before continuing.</p>
                )}
              </div>
              <p className="proof-intro">
                Created transactionally, observed after stable actions and verified
                with independent evidence.
              </p>
              <dl>
                {state.evidence.objects.map((object) => (
                  <div key={object.label}>
                    <dt>{object.label}</dt>
                    <dd>{object.command || "independent point"}</dd>
                    <dd>
                      exists: {String(object.exists)} · defined: {String(object.defined)}
                    </dd>
                  </div>
                ))}
              </dl>
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

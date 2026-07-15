"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ExerciseConfirmation,
  type ExerciseInitializationViewState,
} from "./exercise-photo/exercise-confirmation";
import { GeoGebraSpike } from "./geogebra-spike";
import { RealtimeSpike } from "./realtime-spike";
import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import type { ToolRuntime, ToolWorkflowAuthority } from "@/lib/tools/runtime";
import type { ToolPhase } from "@/lib/tools/gateway";
import {
  isInitializationFailureRetryable,
  type ExerciseInitializationRuntime,
} from "@/lib/geogebra/exercise-initialization";
import type {
  RealtimeInvarianceRequestRuntime,
  RealtimeInvarianceSummaryRuntime,
  RealtimeCancellationRuntime,
  RealtimePedagogyRuntime,
  RealtimeProactiveRuntime,
} from "@/lib/realtime/webrtc-session";
import { EvidenceLog, type CancellationReason } from "@/lib/pedagogy/evidence-log";
import { OperationArbiter } from "@/lib/operations/arbiter";
import { LatencyBudgetMonitor } from "@/lib/reliability/latency-budget";
import { ReliabilityPanel } from "./reliability-panel";

export function TutorWorkspace() {
  const [toolRuntime, setToolRuntime] = useState<ToolRuntime>();
  const [pedagogyRuntime, setPedagogyRuntime] =
    useState<RealtimePedagogyRuntime>();
  const proactiveRuntimeRef = useRef<RealtimeProactiveRuntime | undefined>(undefined);
  const cancellationRuntimeRef = useRef<RealtimeCancellationRuntime | undefined>(undefined);
  const invarianceRequestRuntimeRef = useRef<
    RealtimeInvarianceRequestRuntime | undefined
  >(undefined);
  const [invarianceSummaryRuntime, setInvarianceSummaryRuntime] = useState<
    RealtimeInvarianceSummaryRuntime | undefined
  >(undefined);
  const evidenceLog = useMemo(() => new EvidenceLog(), []);
  const latencyMonitor = useMemo(() => new LatencyBudgetMonitor(), []);
  const operationArbiter = useMemo(
    () =>
      new OperationArbiter({
        onTrace(entry) {
          evidenceLog.appendOperationTrace(entry);
        },
      }),
    [evidenceLog],
  );
  const [initializationState, setInitializationState] =
    useState<ExerciseInitializationViewState>({ status: "idle" });
  const [exerciseResetToken, setExerciseResetToken] = useState(0);
  const exerciseRuntimeRef = useRef<ExerciseInitializationRuntime | undefined>(undefined);
  const pendingConfirmationRef = useRef<ExerciseConfirmedV1 | undefined>(undefined);
  const initializationInFlightRef = useRef(false);
  const initializingConfirmationIdRef = useRef<string | undefined>(undefined);
  const completedConfirmationIdsRef = useRef(new Set<string>());
  const workflowEpochRef = useRef(0);
  const toolPhaseRef = useRef<ToolPhase>("idle");
  const exerciseInitializedRef = useRef(false);
  const confirmedExercisesRef = useRef(new Map<string, ExerciseConfirmedV1>());
  const clearConfirmationAuthority = useCallback((confirmationId?: string) => {
    const pending = pendingConfirmationRef.current;
    if (!confirmationId || pending?.confirmationId === confirmationId) {
      pendingConfirmationRef.current = undefined;
    }
    for (const [exerciseId, confirmation] of confirmedExercisesRef.current) {
      if (!confirmationId || confirmation.confirmationId === confirmationId) {
        confirmedExercisesRef.current.delete(exerciseId);
      }
    }
    if (
      confirmedExercisesRef.current.size === 0 &&
      toolPhaseRef.current === "exercise_confirmed"
    ) {
      toolPhaseRef.current = exerciseInitializedRef.current
        ? "constructing"
        : "idle";
    }
  }, []);
  const toolWorkflowAuthority = useMemo<ToolWorkflowAuthority>(
    () => ({
      getPhase: () => toolPhaseRef.current,
      getConfirmedExercise: (planId) => confirmedExercisesRef.current.get(planId),
      initializeExercise: async (confirmation, options) => {
        const runtime = exerciseRuntimeRef.current;
        if (!runtime) {
          return {
            status: "failed",
            code: "initialization_unavailable",
            rolledBack: false,
          };
        }
        const epoch = workflowEpochRef.current;
        const upstreamAuthority = options?.isAuthorityCurrent;
        setInitializationState({ status: "initializing" });
        const result = await runtime.initialize(confirmation, {
          ...options,
          isAuthorityCurrent: () =>
            epoch === workflowEpochRef.current &&
            (upstreamAuthority?.() ?? true),
        });
        if (epoch !== workflowEpochRef.current) return result;
        if (
          result.status === "initialized" ||
          result.status === "already_initialized"
        ) {
          exerciseInitializedRef.current = true;
          toolPhaseRef.current = "constructing";
          completedConfirmationIdsRef.current.add(confirmation.confirmationId);
          clearConfirmationAuthority(confirmation.confirmationId);
          setInitializationState({
            status: "initialized",
            snapshotHash: result.snapshotHash,
          });
        } else {
          const retryable = isInitializationFailureRetryable(result);
          if (retryable) {
            toolPhaseRef.current = "exercise_confirmed";
          } else {
            clearConfirmationAuthority(confirmation.confirmationId);
          }
          setInitializationState({
            status: "failed",
            code: result.code,
            rolledBack: result.rolledBack,
            retryable,
          });
        }
        return result;
      },
    }),
    [clearConfirmationAuthority],
  );
  const handleToolRuntime = useCallback((runtime?: ToolRuntime) => setToolRuntime(runtime), []);
  const handlePedagogyRuntime = useCallback(
    (runtime?: RealtimePedagogyRuntime) => setPedagogyRuntime(runtime),
    [],
  );
  const handleProactiveRuntime = useCallback(
    (runtime?: RealtimeProactiveRuntime) => {
      proactiveRuntimeRef.current = runtime;
    },
    [],
  );
  const handleCancellationRuntime = useCallback(
    (runtime?: RealtimeCancellationRuntime) => {
      cancellationRuntimeRef.current = runtime;
    },
    [],
  );
  const handleInvarianceRequestRuntime = useCallback(
    (runtime?: RealtimeInvarianceRequestRuntime) => {
      invarianceRequestRuntimeRef.current = runtime;
    },
    [],
  );
  const handleInvarianceSummaryRuntime = useCallback(
    (runtime?: RealtimeInvarianceSummaryRuntime) => {
      setInvarianceSummaryRuntime(runtime);
    },
    [],
  );
  const requestInvarianceSummary = useCallback<
    RealtimeInvarianceRequestRuntime["requestInvarianceSummary"]
  >((result, directive) => {
    const runtime = invarianceRequestRuntimeRef.current;
    return runtime
      ? runtime.requestInvarianceSummary(result, directive)
      : Promise.resolve({
          status: "ignored",
          reason: "invalid_request",
          runId: result.runId,
          revision: result.revision,
        });
  }, []);
  const requestProactive = useCallback<
    RealtimeProactiveRuntime["requestProactive"]
  >(
    (decision, directive) =>
      proactiveRuntimeRef.current?.requestProactive(decision, directive) ??
      "unavailable",
    [],
  );
  const cancelRealtime = useCallback(
    (reason: CancellationReason) =>
      cancellationRuntimeRef.current?.cancelForActivity(reason) ?? false,
    [],
  );

  useEffect(() => {
    const debugWindow = window as Window & {
      __GEOTUTOR_EXPORT_EVIDENCE__?: () =>
        ReturnType<EvidenceLog["exportDebug"]>;
      __GEOTUTOR_OPERATION_REGISTRY__?: () =>
        ReturnType<OperationArbiter["snapshot"]>;
      __GEOTUTOR_EXPORT_RELIABILITY__?: () =>
        ReturnType<LatencyBudgetMonitor["exportDebug"]>;
    };
    debugWindow.__GEOTUTOR_EXPORT_EVIDENCE__ = () =>
      evidenceLog.exportDebug();
    debugWindow.__GEOTUTOR_OPERATION_REGISTRY__ = () =>
      operationArbiter.snapshot();
    debugWindow.__GEOTUTOR_EXPORT_RELIABILITY__ = () =>
      latencyMonitor.exportDebug();
    return () => {
      delete debugWindow.__GEOTUTOR_EXPORT_EVIDENCE__;
      delete debugWindow.__GEOTUTOR_OPERATION_REGISTRY__;
      delete debugWindow.__GEOTUTOR_EXPORT_RELIABILITY__;
      operationArbiter.close();
      evidenceLog.clear();
      latencyMonitor.clear();
    };
  }, [evidenceLog, latencyMonitor, operationArbiter]);

  useEffect(
    () => () => {
      workflowEpochRef.current += 1;
      clearConfirmationAuthority();
      completedConfirmationIdsRef.current.clear();
      toolPhaseRef.current = "idle";
      exerciseRuntimeRef.current = undefined;
      proactiveRuntimeRef.current = undefined;
      cancellationRuntimeRef.current = undefined;
      invarianceRequestRuntimeRef.current = undefined;
      initializationInFlightRef.current = false;
      initializingConfirmationIdRef.current = undefined;
    },
    [clearConfirmationAuthority],
  );

  const initializePendingExercise = useCallback(async () => {
    if (initializationInFlightRef.current) return;
    if (!pendingConfirmationRef.current) return;
    if (!exerciseRuntimeRef.current) {
      setInitializationState({ status: "waiting_for_applet" });
      return;
    }
    initializationInFlightRef.current = true;
    try {
      while (true) {
        const confirmation = pendingConfirmationRef.current;
        if (!confirmation) return;
        if (!exerciseRuntimeRef.current) {
          setInitializationState({ status: "waiting_for_applet" });
          return;
        }

        const workflowEpoch = workflowEpochRef.current;
        initializingConfirmationIdRef.current = confirmation.confirmationId;
        setInitializationState({ status: "initializing" });
        try {
          const result = await toolWorkflowAuthority.initializeExercise(
            confirmation,
          );
          if (workflowEpoch === workflowEpochRef.current) {
            if (
              result.status === "initialized" ||
              result.status === "already_initialized"
            ) {
              completedConfirmationIdsRef.current.add(
                confirmation.confirmationId,
              );
              if (
                pendingConfirmationRef.current?.confirmationId ===
                confirmation.confirmationId
              ) {
                pendingConfirmationRef.current = undefined;
              }
            }
            return;
          }
        } catch {
          if (workflowEpoch === workflowEpochRef.current) {
            setInitializationState({
              status: "failed",
              code: "initialization_unavailable",
              rolledBack: false,
              retryable: true,
            });
            return;
          }
        }

        const nextConfirmation = pendingConfirmationRef.current;
        if (
          !nextConfirmation ||
          nextConfirmation.confirmationId === confirmation.confirmationId
        ) {
          return;
        }
      }
    } finally {
      initializingConfirmationIdRef.current = undefined;
      initializationInFlightRef.current = false;
    }
  }, [toolWorkflowAuthority]);

  const handleExerciseRuntime = useCallback(
    (runtime?: ExerciseInitializationRuntime) => {
      exerciseRuntimeRef.current = runtime;
      if (runtime && pendingConfirmationRef.current) {
        void initializePendingExercise();
      }
    },
    [initializePendingExercise],
  );

  const handleExerciseConfirmed = useCallback(
    (confirmation: ExerciseConfirmedV1) => {
      const confirmationId = confirmation.confirmationId;
      if (
        completedConfirmationIdsRef.current.has(confirmationId) ||
        initializingConfirmationIdRef.current === confirmationId ||
        pendingConfirmationRef.current?.confirmationId === confirmationId
      ) {
        return;
      }
      workflowEpochRef.current += 1;
      clearConfirmationAuthority();
      completedConfirmationIdsRef.current.clear();
      confirmedExercisesRef.current.set(confirmation.plan.exerciseId, confirmation);
      toolPhaseRef.current = "exercise_confirmed";
      pendingConfirmationRef.current = confirmation;
      void initializePendingExercise();
    },
    [clearConfirmationAuthority, initializePendingExercise],
  );

  const handleExerciseDraftChanged = useCallback(() => {
    workflowEpochRef.current += 1;
    clearConfirmationAuthority();
    completedConfirmationIdsRef.current.clear();
    toolPhaseRef.current = exerciseInitializedRef.current ? "constructing" : "idle";
    setInitializationState({ status: "idle" });
  }, [clearConfirmationAuthority]);

  const retryExerciseInitialization = useCallback(async () => {
    const runtime = exerciseRuntimeRef.current;
    if (
      !runtime ||
      initializationInFlightRef.current ||
      !pendingConfirmationRef.current ||
      initializationState.status !== "failed" ||
      !initializationState.retryable
    ) {
      return;
    }
    if (
      initializationState.status === "failed" &&
      initializationState.code === "recovery_required"
    ) {
      initializationInFlightRef.current = true;
      setInitializationState({ status: "initializing" });
      const recovery = await runtime.reset("recovery_retry", {
        recoveryPlan: pendingConfirmationRef.current?.plan,
      }).catch(() => undefined);
      initializationInFlightRef.current = false;
      if (!recovery?.ok) {
        setInitializationState({
          status: "failed",
          code: "recovery_required",
          rolledBack: false,
          retryable: true,
        });
        return;
      }
    }
    await initializePendingExercise();
  }, [initializationState, initializePendingExercise]);

  const handleConstructionReset = useCallback(() => {
    workflowEpochRef.current += 1;
    clearConfirmationAuthority();
    completedConfirmationIdsRef.current.clear();
    toolPhaseRef.current = exerciseInitializedRef.current ? "constructing" : "idle";
    setInitializationState({ status: "reset" });
    setExerciseResetToken((current) => current + 1);
  }, [clearConfirmationAuthority]);

  return (
    <div className="student-workspace">
      <ExerciseConfirmation
        onConfirmed={handleExerciseConfirmed}
        onDraftChanged={handleExerciseDraftChanged}
        initializationState={initializationState}
        onRetryInitialization={
          initializationState.status === "failed" &&
          initializationState.retryable
            ? () => void retryExerciseInitialization()
            : undefined
        }
        resetToken={exerciseResetToken}
        latencyMonitor={latencyMonitor}
      />
      <GeoGebraSpike
        onToolRuntime={handleToolRuntime}
        onExerciseInitializationRuntime={handleExerciseRuntime}
        onConstructionReset={handleConstructionReset}
        toolWorkflowAuthority={toolWorkflowAuthority}
        onPedagogyRuntime={handlePedagogyRuntime}
        requestProactive={requestProactive}
        requestInvarianceSummary={requestInvarianceSummary}
        onInvarianceSummaryRuntime={handleInvarianceSummaryRuntime}
        cancelRealtime={cancelRealtime}
        evidenceLog={evidenceLog}
        operationArbiter={operationArbiter}
        latencyMonitor={latencyMonitor}
      />
      <RealtimeSpike
        toolRuntime={toolRuntime}
        pedagogyRuntime={pedagogyRuntime}
        onProactiveRuntime={handleProactiveRuntime}
        onCancellationRuntime={handleCancellationRuntime}
        invarianceSummaryRuntime={invarianceSummaryRuntime}
        onInvarianceRequestRuntime={handleInvarianceRequestRuntime}
        evidenceLog={evidenceLog}
        operationArbiter={operationArbiter}
        latencyMonitor={latencyMonitor}
      />
      <details className="technical-details">
        <summary>
          <span>Behind the scenes</span>
          <small>Performance and privacy details</small>
        </summary>
        <ReliabilityPanel monitor={latencyMonitor} />
      </details>
    </div>
  );
}

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
import type { ExerciseInitializationRuntime } from "@/lib/geogebra/exercise-initialization";
import type {
  RealtimePedagogyRuntime,
  RealtimeProactiveRuntime,
} from "@/lib/realtime/webrtc-session";
import { EvidenceLog, type CancellationReason } from "@/lib/pedagogy/evidence-log";

export function TutorWorkspace() {
  const [toolRuntime, setToolRuntime] = useState<ToolRuntime>();
  const [pedagogyRuntime, setPedagogyRuntime] =
    useState<RealtimePedagogyRuntime>();
  const proactiveRuntimeRef = useRef<RealtimeProactiveRuntime | undefined>(undefined);
  const evidenceLog = useMemo(() => new EvidenceLog(), []);
  const [initializationState, setInitializationState] =
    useState<ExerciseInitializationViewState>({ status: "idle" });
  const [exerciseResetToken, setExerciseResetToken] = useState(0);
  const exerciseRuntimeRef = useRef<ExerciseInitializationRuntime | undefined>(undefined);
  const pendingConfirmationRef = useRef<ExerciseConfirmedV1 | undefined>(undefined);
  const initializationInFlightRef = useRef(false);
  const workflowEpochRef = useRef(0);
  const toolPhaseRef = useRef<ToolPhase>("idle");
  const exerciseInitializedRef = useRef(false);
  const confirmedExercisesRef = useRef(new Map<string, ExerciseConfirmedV1>());
  const toolWorkflowAuthority = useMemo<ToolWorkflowAuthority>(
    () => ({
      getPhase: () => toolPhaseRef.current,
      getConfirmedExercise: (planId) => confirmedExercisesRef.current.get(planId),
      initializeExercise: async (confirmation) => {
        const runtime = exerciseRuntimeRef.current;
        if (!runtime) {
          return {
            status: "failed",
            code: "initialization_unavailable",
            rolledBack: false,
          };
        }
        const epoch = workflowEpochRef.current;
        setInitializationState({ status: "initializing" });
        const result = await runtime.initialize(confirmation);
        if (epoch !== workflowEpochRef.current) return result;
        if (
          result.status === "initialized" ||
          result.status === "already_initialized"
        ) {
          exerciseInitializedRef.current = true;
          toolPhaseRef.current = "constructing";
          setInitializationState({
            status: "initialized",
            snapshotHash: result.snapshotHash,
          });
        } else {
          toolPhaseRef.current = "exercise_confirmed";
          setInitializationState({
            status: "failed",
            code: result.code,
            rolledBack: result.rolledBack,
          });
        }
        return result;
      },
    }),
    [],
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
      proactiveRuntimeRef.current?.cancelForActivity(reason) ?? false,
    [],
  );

  useEffect(() => {
    const debugWindow = window as Window & {
      __GEOTUTOR_EXPORT_EVIDENCE__?: () => ReturnType<EvidenceLog["export"]>;
    };
    debugWindow.__GEOTUTOR_EXPORT_EVIDENCE__ = () => evidenceLog.export();
    return () => {
      delete debugWindow.__GEOTUTOR_EXPORT_EVIDENCE__;
      evidenceLog.clear();
    };
  }, [evidenceLog]);

  useEffect(
    () => () => {
      workflowEpochRef.current += 1;
      pendingConfirmationRef.current = undefined;
      confirmedExercisesRef.current.clear();
      toolPhaseRef.current = "idle";
      exerciseRuntimeRef.current = undefined;
      proactiveRuntimeRef.current = undefined;
      initializationInFlightRef.current = false;
    },
    [],
  );

  const initializePendingExercise = useCallback(async () => {
    const runtime = exerciseRuntimeRef.current;
    let confirmation = pendingConfirmationRef.current;
    if (!runtime || !confirmation) {
      setInitializationState({ status: "waiting_for_applet" });
      return;
    }
    if (initializationInFlightRef.current) return;
    const workflowEpoch = workflowEpochRef.current;
    initializationInFlightRef.current = true;
    setInitializationState({ status: "initializing" });
    try {
      const result = await toolWorkflowAuthority.initializeExercise(
        confirmation,
      );
      if (workflowEpoch !== workflowEpochRef.current) return;
      if (
        result.status === "initialized" ||
        result.status === "already_initialized"
      ) {
        if (pendingConfirmationRef.current === confirmation) {
          pendingConfirmationRef.current = undefined;
        }
      }
    } catch {
      if (workflowEpoch !== workflowEpochRef.current) return;
      setInitializationState({
        status: "failed",
        code: "initialization_unavailable",
        rolledBack: false,
      });
    } finally {
      initializationInFlightRef.current = false;
      confirmation = undefined;
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
      workflowEpochRef.current += 1;
      confirmedExercisesRef.current.set(confirmation.plan.exerciseId, confirmation);
      toolPhaseRef.current = "exercise_confirmed";
      pendingConfirmationRef.current = confirmation;
      void initializePendingExercise();
    },
    [initializePendingExercise],
  );

  const handleExerciseDraftChanged = useCallback(() => {
    workflowEpochRef.current += 1;
    pendingConfirmationRef.current = undefined;
    confirmedExercisesRef.current.clear();
    toolPhaseRef.current = exerciseInitializedRef.current ? "constructing" : "idle";
    setInitializationState({ status: "idle" });
  }, []);

  const retryExerciseInitialization = useCallback(async () => {
    const runtime = exerciseRuntimeRef.current;
    if (!runtime || initializationInFlightRef.current) return;
    if (
      initializationState.status === "failed" &&
      initializationState.code === "recovery_required"
    ) {
      initializationInFlightRef.current = true;
      setInitializationState({ status: "initializing" });
      const recovery = await runtime.recover().catch(() => undefined);
      initializationInFlightRef.current = false;
      if (!recovery?.ok) {
        setInitializationState({
          status: "failed",
          code: "recovery_required",
          rolledBack: false,
        });
        return;
      }
    }
    await initializePendingExercise();
  }, [initializationState, initializePendingExercise]);

  const handleConstructionReset = useCallback(() => {
    workflowEpochRef.current += 1;
    pendingConfirmationRef.current = undefined;
    confirmedExercisesRef.current.clear();
    toolPhaseRef.current = exerciseInitializedRef.current ? "constructing" : "idle";
    setInitializationState({ status: "reset" });
    setExerciseResetToken((current) => current + 1);
  }, []);

  return (
    <>
      <ExerciseConfirmation
        onConfirmed={handleExerciseConfirmed}
        onDraftChanged={handleExerciseDraftChanged}
        initializationState={initializationState}
        onRetryInitialization={() => void retryExerciseInitialization()}
        resetToken={exerciseResetToken}
      />
      <GeoGebraSpike
        onToolRuntime={handleToolRuntime}
        onExerciseInitializationRuntime={handleExerciseRuntime}
        onConstructionReset={handleConstructionReset}
        toolWorkflowAuthority={toolWorkflowAuthority}
        onPedagogyRuntime={handlePedagogyRuntime}
        requestProactive={requestProactive}
        cancelRealtime={cancelRealtime}
        evidenceLog={evidenceLog}
      />
      <RealtimeSpike
        toolRuntime={toolRuntime}
        pedagogyRuntime={pedagogyRuntime}
        onProactiveRuntime={handleProactiveRuntime}
        evidenceLog={evidenceLog}
      />
    </>
  );
}

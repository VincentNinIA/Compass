"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  ExerciseConfirmation,
  type ExerciseInitializationViewState,
} from "./exercise-photo/exercise-confirmation";
import { GeoGebraSpike } from "./geogebra-spike";
import { GeneralExerciseWorkspace } from "./general-exercise-workspace";
import { GeoGebraScratchpad } from "./geogebra-scratchpad";
import { RealtimeSpike } from "./realtime-spike";
import {
  isGeneralExerciseConfirmedV1,
  type ConfirmedExercise,
  type ExerciseConfirmedV1,
  type GeneralExerciseConfirmedV1,
} from "@/lib/exercise/exercise-confirmation";
import { createGeneralExerciseContextV1 } from "@/lib/exercise/general-exercise-contracts";
import type { TeacherExercisePublicationV1 } from "@/lib/teacher/exercise";
import {
  LEARNING_SESSION_REPORT_SCHEMA_VERSION,
  type LearningSessionReportV1,
} from "@/lib/learning/session-report";
import type { ToolRuntime, ToolWorkflowAuthority } from "@/lib/tools/runtime";
import type { GeoGebraWorldStateV1 } from "@/lib/geogebra/mission-progress";
import {
  awardMission,
  completedMissionIndexes,
  exerciseXp,
  sessionXp,
  type GamificationLedger,
  type MissionAwardTier,
} from "@/lib/gamification/progress";
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
import { useLanguage } from "./language-provider";
import {
  CompassMascot,
  MascotProvider,
  useMascotController,
} from "./compass-mascot";

export type TutorWorkspaceScreen = "upload" | "confirm" | "work";

const PANORAMA_DEMO_CONFIRMATION: GeneralExerciseConfirmedV1 = {
  kind: "general",
  confirmationId: "t14-panorama-demo",
  confirmedAt: 0,
  exercise: {
    schemaVersion: "general_exercise.v1",
    outcome: "ready",
    language: "fr",
    subject: "mathematics",
    title: "Exercice 1",
    statement:
      "Placer E, F et G puis construire la droite FG, la demi-droite EF, le segment EG et le point K.",
    tasks: [
      "Placer trois points E, F et G non alignés.",
      "Tracer en vert la droite passant par les points F et G.",
      "Tracer en bleu la demi-droite d'origine E et passant par le point F.",
      "Tracer en rouge le segment d'extrémités E et G.",
      "Placer un point K sur la demi-droite EF et hors du segment EF.",
      "Écrire les deux relations avec les notations du cours.",
    ],
    concepts: ["droite", "demi-droite", "segment", "appartenance"],
    ambiguityCode: null,
    clarificationQuestion: null,
  },
};

const GAMIFICATION_DEMO_CONFIRMATION: GeneralExerciseConfirmedV1 = {
  kind: "general",
  confirmationId: "t15-gamification-demo",
  confirmedAt: 0,
  exercise: {
    schemaVersion: "general_exercise.v1",
    outcome: "ready",
    language: "fr",
    subject: "history",
    title: "Comprendre les Lumières",
    statement:
      "Présenter deux idées des Lumières, les illustrer puis rédiger une courte conclusion.",
    tasks: [
      "Présenter deux idées importantes des Lumières.",
      "Associer chaque idée à un exemple historique.",
      "Rédiger une conclusion en deux phrases.",
    ],
    concepts: ["Lumières", "argumentation", "exemple"],
    ambiguityCode: null,
    clarificationQuestion: null,
  },
};

function TutorWorkspaceContent({
  specialistGeometryMode,
  panoramaDemoMode,
  gamificationDemoMode,
  assignedExercise,
  screen,
  onScreenChange,
  onHome,
  onLearningReport,
}: {
  specialistGeometryMode: boolean;
  panoramaDemoMode: boolean;
  gamificationDemoMode: boolean;
  assignedExercise?: TeacherExercisePublicationV1;
  screen?: TutorWorkspaceScreen;
  onScreenChange?(screen: TutorWorkspaceScreen): void;
  onHome?(): void;
  onLearningReport?(report: LearningSessionReportV1): void;
}) {
  const { text } = useLanguage();
  const {
    start: startMascot,
    stop: stopMascot,
    pulse: pulseMascot,
    reset: resetMascot,
  } = useMascotController();
  const [toolRuntime, setToolRuntime] = useState<ToolRuntime>();
  const [geogebraWorldState, setGeoGebraWorldState] =
    useState<GeoGebraWorldStateV1>();
  const [xpLedger, setXpLedger] = useState<GamificationLedger>([]);
  const xpLedgerRef = useRef<GamificationLedger>([]);
  const [reflectionState, setReflectionState] = useState<{
    exerciseId?: string;
    taskIndexes: ReadonlySet<number>;
    transferCompleted: boolean;
  }>({ taskIndexes: new Set(), transferCompleted: false });
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
  const [generalConfirmation, setGeneralConfirmation] = useState<
    GeneralExerciseConfirmedV1 | undefined
  >(
    panoramaDemoMode
      ? PANORAMA_DEMO_CONFIRMATION
      : gamificationDemoMode
        ? GAMIFICATION_DEMO_CONFIRMATION
        : assignedExercise
          ? {
              kind: "general",
              confirmationId: assignedExercise.id,
              confirmedAt: assignedExercise.publishedAt,
              exercise: assignedExercise.exercise,
            }
          : undefined,
  );
  const [legacyModuleActive, setLegacyModuleActive] = useState(false);
  const legacyModuleVisible = specialistGeometryMode || legacyModuleActive;
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
    if (initializationState.status === "initializing") {
      startMascot("exercise-initialization", "modifying");
      return;
    }
    stopMascot("exercise-initialization");
    if (initializationState.status === "failed") {
      pulseMascot("exercise-initialization-error", "error", 2_400);
    } else if (initializationState.status === "reset") {
      resetMascot();
    }
  }, [
    initializationState.status,
    pulseMascot,
    resetMascot,
    startMascot,
    stopMascot,
  ]);

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
    (confirmation: ConfirmedExercise) => {
      if (isGeneralExerciseConfirmedV1(confirmation)) {
        workflowEpochRef.current += 1;
        clearConfirmationAuthority();
        completedConfirmationIdsRef.current.clear();
        pendingConfirmationRef.current = undefined;
        toolPhaseRef.current = "idle";
        setLegacyModuleActive(false);
        setGeneralConfirmation(confirmation);
        setInitializationState({ status: "idle" });
        onScreenChange?.("work");
        return;
      }
      const confirmationId = confirmation.confirmationId;
      if (
        completedConfirmationIdsRef.current.has(confirmationId) ||
        initializingConfirmationIdRef.current === confirmationId ||
        pendingConfirmationRef.current?.confirmationId === confirmationId
      ) {
        return;
      }
      workflowEpochRef.current += 1;
      setGeneralConfirmation(undefined);
      setLegacyModuleActive(true);
      clearConfirmationAuthority();
      completedConfirmationIdsRef.current.clear();
      confirmedExercisesRef.current.set(confirmation.plan.exerciseId, confirmation);
      toolPhaseRef.current = "exercise_confirmed";
      pendingConfirmationRef.current = confirmation;
      onScreenChange?.("work");
      void initializePendingExercise();
    },
    [clearConfirmationAuthority, initializePendingExercise, onScreenChange],
  );

  const handleExerciseDraftChanged = useCallback(() => {
    workflowEpochRef.current += 1;
    clearConfirmationAuthority();
    completedConfirmationIdsRef.current.clear();
    toolPhaseRef.current = exerciseInitializedRef.current ? "constructing" : "idle";
    setInitializationState({ status: "idle" });
    setGeneralConfirmation(undefined);
    setLegacyModuleActive(false);
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

  const startNewExercise = useCallback(() => {
    handleExerciseDraftChanged();
    setExerciseResetToken((current) => current + 1);
    onScreenChange?.("upload");
  }, [handleExerciseDraftChanged, onScreenChange]);

  const generalExercise = generalConfirmation?.exercise;
  const currentExerciseId = generalConfirmation?.confirmationId;
  const creditMission = useCallback(
    (exerciseId: string, taskIndex: number, tier: MissionAwardTier) => {
      const current = xpLedgerRef.current;
      const next = awardMission(current, exerciseId, taskIndex, tier);
      if (next === current) return false;
      xpLedgerRef.current = next;
      setXpLedger(next);
      return true;
    },
    [],
  );
  const verifiedTaskIndexes = useMemo(
    () => new Set(geogebraWorldState?.verifiedTaskIndexes ?? []),
    [geogebraWorldState],
  );
  const completedTaskIndexes = useMemo(
    () => completedMissionIndexes(xpLedger, currentExerciseId),
    [currentExerciseId, xpLedger],
  );
  const currentExerciseXp = useMemo(
    () => exerciseXp(xpLedger, currentExerciseId),
    [currentExerciseId, xpLedger],
  );
  const totalSessionXp = useMemo(() => sessionXp(xpLedger), [xpLedger]);
  const earnedTaskIndexes = useMemo(
    () => new Set([...completedTaskIndexes, ...verifiedTaskIndexes]),
    [completedTaskIndexes, verifiedTaskIndexes],
  );
  const reflectedTaskIndexes = useMemo(
    () =>
      reflectionState.exerciseId === currentExerciseId
        ? reflectionState.taskIndexes
        : new Set<number>(),
    [currentExerciseId, reflectionState],
  );
  const transferCompleted =
    reflectionState.exerciseId === currentExerciseId &&
    reflectionState.transferCompleted;

  useEffect(() => {
    if (
      !assignedExercise ||
      !currentExerciseId ||
      currentExerciseId !== assignedExercise.id ||
      earnedTaskIndexes.size === 0
    ) {
      return;
    }
    onLearningReport?.({
      schemaVersion: LEARNING_SESSION_REPORT_SCHEMA_VERSION,
      exerciseId: assignedExercise.id,
      title:
        assignedExercise.exercise.title ??
        text("Untitled exercise", "Exercice sans titre"),
      subject: assignedExercise.exercise.subject,
      totalMissions: assignedExercise.exercise.tasks.length,
      completedMissions: earnedTaskIndexes.size,
      verifiedMissions: verifiedTaskIndexes.size,
      reflectedMissions: reflectedTaskIndexes.size,
      exerciseXp: currentExerciseXp,
      transferCompleted,
      updatedAt: Date.now(),
    });
  }, [
    assignedExercise,
    currentExerciseId,
    currentExerciseXp,
    earnedTaskIndexes,
    onLearningReport,
    reflectedTaskIndexes,
    text,
    transferCompleted,
    verifiedTaskIndexes,
  ]);
  const handleGeoGebraWorldState = useCallback(
    (worldState?: GeoGebraWorldStateV1) => {
      setGeoGebraWorldState(worldState);
      if (!worldState || !currentExerciseId) return;
      let credited = false;
      for (const taskIndex of worldState.verifiedTaskIndexes) {
        credited =
          creditMission(currentExerciseId, taskIndex, "verified") || credited;
      }
      if (credited) {
        pulseMascot("mission-verified", "celebrating", 2_400);
      }
    },
    [creditMission, currentExerciseId, pulseMascot],
  );
  const handleMissionCompleted = useCallback(
    (taskIndex: number, learnerReflection: string) => {
      if (!currentExerciseId || learnerReflection.trim().length < 3) return;
      setReflectionState((current) => ({
        exerciseId: currentExerciseId,
        taskIndexes: new Set([
          ...(current.exerciseId === currentExerciseId
            ? current.taskIndexes
            : []),
          taskIndex,
        ]),
        transferCompleted:
          current.exerciseId === currentExerciseId && current.transferCompleted,
      }));
      if (creditMission(currentExerciseId, taskIndex, "completed")) {
        pulseMascot("mission-completed", "celebrating", 2_000);
      }
    },
    [creditMission, currentExerciseId, pulseMascot],
  );
  const handleTransferComplete = useCallback(() => {
    if (!currentExerciseId) return;
    setReflectionState((current) => ({
      exerciseId: currentExerciseId,
      taskIndexes:
        current.exerciseId === currentExerciseId
          ? current.taskIndexes
          : new Set<number>(),
      transferCompleted: true,
    }));
  }, [currentExerciseId]);
  const searchableExercise = generalExercise
    ? `${generalExercise.subject} ${generalExercise.concepts.join(" ")}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
    : "";
  const usesMathScratchpad = /math|geometr|algebr|trigonom|droite|segment|demi-droite/.test(
    searchableExercise,
  );

  const coach = (
    <RealtimeSpike
      key={
        specialistGeometryMode
          ? "specialist-geometry-coach"
          : (generalConfirmation?.confirmationId ?? "general-coach-pending")
      }
      tutorProfile={
        specialistGeometryMode || legacyModuleActive
          ? "specialized_geometry"
          : usesMathScratchpad
            ? "geogebra_tutor"
            : "general_tutor"
      }
      exerciseContext={
        !specialistGeometryMode && generalConfirmation
          ? createGeneralExerciseContextV1(
              generalConfirmation.exercise,
              assignedExercise?.id === generalConfirmation.confirmationId
                ? assignedExercise.guidance
                : undefined,
            )
          : undefined
      }
      toolRuntime={toolRuntime}
      geogebraWorldState={geogebraWorldState}
      pedagogyRuntime={pedagogyRuntime}
      onProactiveRuntime={handleProactiveRuntime}
      onCancellationRuntime={handleCancellationRuntime}
      invarianceSummaryRuntime={invarianceSummaryRuntime}
      onInvarianceRequestRuntime={handleInvarianceRequestRuntime}
      evidenceLog={evidenceLog}
      operationArbiter={operationArbiter}
      latencyMonitor={latencyMonitor}
      layout={screen ? (usesMathScratchpad ? "panorama" : "workspace") : "card"}
    />
  );

  const legacyGeometry = legacyModuleVisible ? (
    <div className="legacy-geometry-module" data-active="true">
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
    </div>
  ) : null;

  if (specialistGeometryMode || !screen) {
    return (
      <div className="student-workspace">
        <CompassMascot />
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
        <GeneralExerciseWorkspace
          exercise={generalExercise}
          completedTaskIndexes={completedTaskIndexes}
          score={currentExerciseXp}
          onCompleteTask={usesMathScratchpad ? undefined : handleMissionCompleted}
          transferCompleted={transferCompleted}
          onTransferComplete={handleTransferComplete}
        />
        {legacyGeometry}
        {coach}
        <details className="technical-details">
          <summary>
            <span>{text("Behind the scenes", "Dans les coulisses")}</span>
            <small>
              {text(
                "Performance and privacy details",
                "Détails de performance et de confidentialité",
              )}
            </small>
          </summary>
          <ReliabilityPanel monitor={latencyMonitor} />
        </details>
      </div>
    );
  }

  return (
    <div className="student-workspace learning-workspace" data-screen={screen}>
      {screen !== "work" ? <CompassMascot /> : null}

      <section
        className="learning-screen learning-screen-intake"
        aria-labelledby={`${screen}-screen-title`}
        hidden={screen === "work"}
      >
        <div className="learning-screen-bar">
          <button
            type="button"
            className="button-secondary screen-back-button"
            onClick={() =>
              screen === "confirm" ? onScreenChange?.("upload") : onHome?.()
            }
          >
            <span aria-hidden="true">←</span>{" "}
            {screen === "confirm"
              ? text("Back to the photo", "Retour à la photo")
              : text("Back home", "Retour à l'accueil")}
          </button>
          <span className="screen-step-label">
            {screen === "confirm"
              ? text("Step 3 of 4", "Étape 3 sur 4")
              : text("Step 2 of 4", "Étape 2 sur 4")}
          </span>
        </div>
        <div className="learning-screen-intro">
          <p className="eyebrow">
            {screen === "confirm"
              ? text("Check before starting", "Vérifie avant de commencer")
              : text("One clear photo", "Une photo bien lisible")}
          </p>
          <h1 id={`${screen}-screen-title`} data-screen-title tabIndex={-1}>
            {screen === "confirm"
              ? text("Is this really the exercise?", "Est-ce bien cet exercice ?")
              : text("Add your exercise", "Ajoute ton exercice")}
          </h1>
        </div>
        <ExerciseConfirmation
          onConfirmed={handleExerciseConfirmed}
          onDraftChanged={handleExerciseDraftChanged}
          onAnalysisStarted={() => onScreenChange?.("confirm")}
          initializationState={initializationState}
          onRetryInitialization={
            initializationState.status === "failed" &&
            initializationState.retryable
              ? () => void retryExerciseInitialization()
              : undefined
          }
          resetToken={exerciseResetToken}
          latencyMonitor={latencyMonitor}
          view={screen === "confirm" ? "confirmation" : "upload"}
        />
      </section>

      {screen === "work" ? (
        <section
          className={`learning-screen learning-screen-work${
            usesMathScratchpad ? " learning-screen-work--geogebra" : ""
          }`}
          aria-labelledby="work-screen-title"
        >
          <div className="learning-screen-bar">
            <button
              type="button"
              className="button-secondary screen-back-button"
              onClick={startNewExercise}
            >
              <span aria-hidden="true">＋</span>{" "}
              {text("New exercise", "Nouvel exercice")}
            </button>
            <div className="workspace-status-cluster">
              <span className="screen-step-label">
                {text("Step 4 of 4 · Workspace", "Étape 4 sur 4 · Atelier")}
              </span>
              <output
                className="workspace-xp"
                aria-live="polite"
                aria-atomic="true"
                aria-label={text("Session XP", "XP de session")}
              >
                <span className="workspace-xp-mark" aria-hidden="true" />
                <strong>{totalSessionXp}</strong>
                <small>XP</small>
              </output>
            </div>
          </div>
          <div className="work-screen-heading">
            <div>
              <p className="eyebrow">
                {usesMathScratchpad
                  ? text("Your GeoGebra workspace", "Ton atelier GeoGebra")
                  : text("Your workspace", "Ton atelier")}
              </p>
              <h1 id="work-screen-title" data-screen-title tabIndex={-1}>
                {usesMathScratchpad
                  ? text("GeoGebra, Compass and you.", "GeoGebra, Compass et toi.")
                  : text("Compass is ready with you.", "Compass est prêt avec toi.")}
              </h1>
            </div>
            <p>
              {usesMathScratchpad
                ? text(
                    "Work directly on the large board. Compass stays beside it to guide your clicks or draw when you explicitly ask.",
                    "Travaille directement sur le grand tableau. Compass reste à côté pour guider tes clics ou tracer si tu le demandes clairement.",
                  )
                : text(
                    "Talk first or start working: your coach and your exercise stay together on this screen.",
                    "Parle d'abord ou commence à travailler : ton coach et ton exercice restent réunis sur cet écran.",
                  )}
            </p>
          </div>
          <ol className="learning-routine" aria-label={text("How to use Compass", "Comment travailler avec Compass")}>
            <li>
              <span aria-hidden="true">1</span>
              <strong>{text("Try one move", "Essaie une étape")}</strong>
            </li>
            <li>
              <span aria-hidden="true">2</span>
              <strong>{text("Name what you tried", "Dis ce que tu as essayé")}</strong>
            </li>
            <li>
              <span aria-hidden="true">3</span>
              <strong>
                {usesMathScratchpad
                  ? text(
                      "Name the objects before asking Compass to draw",
                      "Nomme les objets avant de demander un tracé",
                    )
                  : text("Ask for the smallest useful hint", "Demande le plus petit indice utile")}
              </strong>
            </li>
          </ol>

          {legacyModuleActive ? (
            <>
              <div className="coach-workbench-header">
                <CompassMascot placement="workspace" />
                {coach}
              </div>
              {legacyGeometry}
            </>
          ) : usesMathScratchpad ? (
            <div className="geogebra-workbench">
              <div className="geogebra-workbench-coach">
                <CompassMascot placement="workspace" />
                {coach}
              </div>
              <GeoGebraScratchpad
                onToolRuntime={handleToolRuntime}
                exercise={generalExercise}
                onWorldState={handleGeoGebraWorldState}
              />
              <GeneralExerciseWorkspace
                exercise={generalExercise}
                layout="rail"
                verifiedTaskIndexes={verifiedTaskIndexes}
                completedTaskIndexes={completedTaskIndexes}
                score={currentExerciseXp}
                onCompleteTask={handleMissionCompleted}
                transferCompleted={transferCompleted}
                onTransferComplete={handleTransferComplete}
              />
            </div>
          ) : (
            <>
              <div className="coach-workbench-header">
                <CompassMascot placement="workspace" />
                {coach}
              </div>
              <div className="learning-workbench-grid learning-workbench-grid--general">
                <GeneralExerciseWorkspace
                  exercise={generalExercise}
                  layout="card"
                  completedTaskIndexes={completedTaskIndexes}
                  score={currentExerciseXp}
                  onCompleteTask={handleMissionCompleted}
                  transferCompleted={transferCompleted}
                  onTransferComplete={handleTransferComplete}
                />
              </div>
            </>
          )}

          <details className="technical-details">
            <summary>
              <span>{text("Behind the scenes", "Dans les coulisses")}</span>
              <small>
                {text(
                  "Performance and privacy details",
                  "Détails de performance et de confidentialité",
                )}
              </small>
            </summary>
            <ReliabilityPanel monitor={latencyMonitor} />
          </details>
        </section>
      ) : null}
    </div>
  );
}

const subscribeToSpecialistMode = () => () => undefined;
const getServerSpecialistMode = () => false;
const getBrowserSpecialistMode = () =>
  new URLSearchParams(window.location.search).get("specialist") === "geometry";
const getBrowserPanoramaDemoMode = () =>
  new URLSearchParams(window.location.search).get("demo") === "geogebra";
const getBrowserGamificationDemoMode = () =>
  new URLSearchParams(window.location.search).get("demo") === "gamification";

export function TutorWorkspace({
  assignedExercise,
  screen,
  onScreenChange,
  onHome,
  onLearningReport,
}: {
  assignedExercise?: TeacherExercisePublicationV1;
  screen?: TutorWorkspaceScreen;
  onScreenChange?(screen: TutorWorkspaceScreen): void;
  onHome?(): void;
  onLearningReport?(report: LearningSessionReportV1): void;
} = {}) {
  const specialistGeometryMode = useSyncExternalStore(
    subscribeToSpecialistMode,
    getBrowserSpecialistMode,
    getServerSpecialistMode,
  );
  const panoramaDemoMode = useSyncExternalStore(
    subscribeToSpecialistMode,
    getBrowserPanoramaDemoMode,
    getServerSpecialistMode,
  );
  const gamificationDemoMode = useSyncExternalStore(
    subscribeToSpecialistMode,
    getBrowserGamificationDemoMode,
    getServerSpecialistMode,
  );

  return (
    <MascotProvider>
      <TutorWorkspaceContent
        specialistGeometryMode={specialistGeometryMode}
        panoramaDemoMode={panoramaDemoMode}
        gamificationDemoMode={gamificationDemoMode}
        assignedExercise={assignedExercise}
        screen={screen}
        onScreenChange={onScreenChange}
        onHome={onHome}
        onLearningReport={onLearningReport}
      />
    </MascotProvider>
  );
}

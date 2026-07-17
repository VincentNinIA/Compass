"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  RealtimeSessionError,
  RealtimeWebRtcSession,
  type RealtimeCancellationRuntime,
  type RealtimeConnectionState,
  type RealtimeInvarianceRequestRuntime,
  type RealtimeInvarianceSummaryRuntime,
  type RealtimePedagogyRuntime,
  type RealtimeProactiveRuntime,
} from "@/lib/realtime/webrtc-session";
import {
  EMPTY_RETRY_BACKOFF,
  assessCapabilitySupport,
  createInitialCapabilityMode,
  isCapabilityReconnectSafe,
  nextRetryBackoff,
  retryAllowed,
  transitionCapabilityMode,
  type BrowserCapabilitySnapshot,
  type CapabilityModeReason,
  type CapabilitySupport,
  type RetryBackoff,
} from "@/lib/realtime/capability-mode";
import type {
  RealtimeSessionMode,
  RealtimeTutorProfile,
} from "@/lib/realtime/session-route";
import type { GeneralExerciseContextV1 } from "@/lib/exercise/general-exercise-contracts";
import type { ToolRuntime } from "@/lib/tools/runtime";
import type { GeoGebraWorldStateV1 } from "@/lib/geogebra/mission-progress";
import type { GeometryRealtimePedagogyContextV1 } from "@/lib/geometry-investigation/learning-runtime";
import type { GeometryWorldCommitV2 } from "@/lib/geometry-investigation/stabilizer";
import type { EvidenceLog } from "@/lib/pedagogy/evidence-log";
import type { OperationArbiter } from "@/lib/operations/arbiter";
import {
  LATENCY_BUDGETS,
  type LatencyBudgetMonitor,
} from "@/lib/reliability/latency-budget";
import {
  useLanguage,
  type AppLanguage,
} from "./language-provider";
import {
  mascotActivityForRealtimeEvent,
  mascotActivityForVoiceTurn,
  useMascotController,
} from "./compass-mascot";

function friendlyError(error: unknown, language: AppLanguage): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return language === "fr"
      ? "L’accès au microphone a été refusé. Autorise-le puis réessaie."
      : "Microphone permission was denied. Allow access and try again.";
  }
  if (error instanceof RealtimeSessionError) {
    return error.message;
  }
  return language === "fr"
    ? "La connexion Realtime n’a pas pu être établie. Tu peux réessayer."
    : "The Realtime connection could not be established. You can try again.";
}

const INITIAL_SUPPORT: CapabilitySupport = {
  liveVoice: false,
  typedLive: false,
  localReason: "local_ready",
};

function localFailureReason(
  mode: RealtimeSessionMode,
  error: unknown,
  wasLive: boolean,
): CapabilityModeReason {
  if (
    error instanceof RealtimeSessionError &&
    error.code === "latency_budget_exceeded"
  ) {
    return "latency_budget_exceeded";
  }
  if (
    mode === "live_voice" &&
    ((error instanceof DOMException && error.name === "NotAllowedError") ||
      (error instanceof RealtimeSessionError && error.code === "microphone_unavailable"))
  ) {
    return "microphone_permission_denied";
  }
  if (mode === "live_voice") {
    return wasLive ? "voice_connection_lost" : "voice_connection_failed";
  }
  return wasLive ? "typed_connection_lost" : "typed_connection_failed";
}

function modeExplanation(
  kind: "live_voice" | "typed_live" | "scripted_local",
  language: AppLanguage,
  tutorProfile: RealtimeTutorProfile = "specialized_geometry",
) {
  if (kind === "live_voice") {
    return language === "fr"
      ? "Voix en direct : la connexion, oai-events, le microphone et l’audio distant sont vérifiés."
      : "Live voice: peer, oai-events, microphone and remote audio are verified.";
  }
  if (kind === "typed_live") {
    return language === "fr"
      ? "Texte en direct : une session OpenAI Realtime sans audio est connectée ; le microphone et le son sont désactivés."
      : "Live text: a text-only OpenAI Realtime session is connected; microphone and audio are off.";
  }
  if (tutorProfile === "general_tutor") {
    return language === "fr"
      ? "Mode local : l'exercice confirmé reste dans cette page ; aucune requête n'est envoyée avant ta connexion au coach."
      : "Local mode: the confirmed exercise stays on this page; no request is sent until you connect the coach.";
  }
  if (tutorProfile === "geogebra_tutor") {
    return language === "fr"
      ? "Mode local : GeoGebra reste utilisable. Connecte la voix ou le texte pour que Compass te guide dans l'applet ou trace à ta demande."
      : "Local mode: GeoGebra remains usable. Connect voice or text so Compass can guide you in the applet or draw when asked.";
  }
  return language === "fr"
    ? "Mode local : la construction, la validation et les solutions de repli restent locales ; aucune requête n’est envoyée à OpenAI ou à un modèle."
    : "Scripted local: construction, validation and fallbacks stay local; no OpenAI or model request is sent.";
}

function modeTitle(
  kind: "live_voice" | "typed_live" | "scripted_local",
  language: AppLanguage,
) {
  if (kind === "live_voice") {
    return language === "fr" ? "À l’écoute" : "Listening and ready";
  }
  if (kind === "typed_live") {
    return language === "fr" ? "Le chat est prêt" : "Chat is ready";
  }
  return language === "fr" ? "Prêt quand tu l’es" : "Ready when you are";
}

function modeStudentCopy(
  kind: "live_voice" | "typed_live" | "scripted_local",
  language: AppLanguage,
  tutorProfile: RealtimeTutorProfile = "specialized_geometry",
) {
  if (kind === "live_voice") {
    return language === "fr"
      ? "Pose ta question à voix haute — tu peux interrompre à tout moment."
      : "Ask your question out loud — you can interrupt anytime.";
  }
  if (kind === "typed_live") {
    return language === "fr"
      ? "Écris une question en gardant ton microphone désactivé."
      : "Type a question and keep your microphone off.";
  }
  if (tutorProfile === "general_tutor") {
    return language === "fr"
      ? "Confirme ton exercice, puis choisis la voix ou le texte pour raisonner avec Compass."
      : "Confirm your exercise, then choose voice or text to reason with Compass.";
  }
  if (tutorProfile === "geogebra_tutor") {
    return language === "fr"
      ? "Tu es dans GeoGebra : Compass peut expliquer les clics et, sur demande, tracer entre deux points existants."
      : "You are in GeoGebra: Compass can explain the clicks and, when asked, draw between two existing points.";
  }
  return language === "fr"
    ? "Ton espace de construction et les indices locaux fonctionnent avant même de contacter un coach."
    : "Your canvas and local hints work even before you connect a coach.";
}

export function RealtimeSpike({
  toolRuntime,
  pedagogyRuntime,
  onProactiveRuntime,
  onCancellationRuntime,
  invarianceSummaryRuntime,
  onInvarianceRequestRuntime,
  evidenceLog,
  operationArbiter,
  latencyMonitor,
  tutorProfile = "specialized_geometry",
  exerciseContext,
  geogebraWorldState,
  geometryWorldObservation,
  onLearnerSpeechStart,
  layout = "card",
}: {
  toolRuntime?: ToolRuntime;
  pedagogyRuntime?: RealtimePedagogyRuntime;
  onProactiveRuntime?(runtime?: RealtimeProactiveRuntime): void;
  onCancellationRuntime?(runtime?: RealtimeCancellationRuntime): void;
  invarianceSummaryRuntime?: RealtimeInvarianceSummaryRuntime;
  onInvarianceRequestRuntime?(runtime?: RealtimeInvarianceRequestRuntime): void;
  evidenceLog?: EvidenceLog;
  operationArbiter?: OperationArbiter;
  latencyMonitor?: LatencyBudgetMonitor;
  tutorProfile?: RealtimeTutorProfile;
  exerciseContext?: GeneralExerciseContextV1;
  geogebraWorldState?: GeoGebraWorldStateV1;
  geometryWorldObservation?: Readonly<{
    commit: GeometryWorldCommitV2;
    pedagogy?: GeometryRealtimePedagogyContextV1;
  }>;
  onLearnerSpeechStart?(): void;
  layout?: "card" | "workspace" | "dock" | "panorama";
}) {
  const { language, text } = useLanguage();
  const {
    start: startMascot,
    stop: stopMascot,
    pulse: pulseMascot,
  } = useMascotController();
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<RealtimeWebRtcSession | undefined>(undefined);
  const connectionStateRef = useRef<RealtimeConnectionState>("idle");
  const transportIntentRef = useRef<RealtimeSessionMode | undefined>(undefined);
  const remoteAudioRef = useRef(false);
  const capabilityModeRef = useRef(createInitialCapabilityMode());
  const sessionStartedAtRef = useRef<number | undefined>(undefined);
  const sessionLatencyRecordedRef = useRef(false);
  const firstAudioLatencyRecordedRef = useRef(false);
  const firstAudioTimerRef = useRef<number | undefined>(undefined);
  const invarianceSummaryRuntimeRef = useRef(invarianceSummaryRuntime);
  const geogebraWorldStateRef = useRef(geogebraWorldState);
  const geometryWorldObservationRef = useRef(geometryWorldObservation);
  useLayoutEffect(() => {
    invarianceSummaryRuntimeRef.current = invarianceSummaryRuntime;
  }, [invarianceSummaryRuntime]);
  useLayoutEffect(() => {
    geogebraWorldStateRef.current = geogebraWorldState;
    if (geogebraWorldState) {
      sessionRef.current?.publishGeoGebraWorldState(geogebraWorldState);
    }
  }, [geogebraWorldState]);
  useLayoutEffect(() => {
    geometryWorldObservationRef.current = geometryWorldObservation;
    if (geometryWorldObservation) {
      const { commit, pedagogy } = geometryWorldObservation;
      sessionRef.current?.publishGeometryWorldV2(
        commit.world,
        commit.delta,
        pedagogy,
      );
    }
  }, [geometryWorldObservation]);
  const [state, setState] = useState<RealtimeConnectionState>("idle");
  const [transportIntent, setTransportIntent] = useState<RealtimeSessionMode>();
  const [capabilityMode, setCapabilityMode] = useState(() =>
    createInitialCapabilityMode(),
  );
  const [support, setSupport] = useState<CapabilitySupport>(INITIAL_SUPPORT);
  const [backoff, setBackoff] = useState<RetryBackoff>(EMPTY_RETRY_BACKOFF);
  const [backoffClock, setBackoffClock] = useState(() => Date.now());
  const [timeline, setTimeline] = useState<string[]>([]);
  const [lastEvent, setLastEvent] = useState<string>();
  const [sessionProfile, setSessionProfile] = useState<string>();
  const [voiceTurn, setVoiceTurn] = useState<string>();
  const [toolLoop, setToolLoop] = useState<string>();
  const [remoteAudio, setRemoteAudio] = useState(false);
  const [error, setError] = useState<string>();
  const [testPrompt, setTestPrompt] = useState("");
  const [testPromptStatus, setTestPromptStatus] = useState<string>();
  const [textOutput, setTextOutput] = useState<string>();

  const appendTimeline = useCallback((entry: string) => {
    setTimeline((current) => [...current.slice(-6), entry]);
  }, []);

  const clearRealtimeMascot = useCallback(() => {
    stopMascot("realtime-input");
    stopMascot("realtime-response");
    stopMascot("realtime-turn");
    stopMascot("realtime-error");
  }, [stopMascot]);

  const handleRealtimeMascotEvent = useCallback(
    (eventType: string) => {
      const activity = mascotActivityForRealtimeEvent(eventType);
      if (activity === undefined) return;
      if (activity === null) {
        stopMascot("realtime-input");
        stopMascot("realtime-response");
      } else if (activity === "error") {
        clearRealtimeMascot();
        pulseMascot("realtime-error", "error", 2_400);
      } else if (activity === "speaking") {
        stopMascot("realtime-input");
        stopMascot("realtime-error");
        startMascot("realtime-response", activity);
      } else {
        stopMascot("realtime-response");
        stopMascot("realtime-error");
        startMascot("realtime-input", activity);
      }
    },
    [
      clearRealtimeMascot,
      pulseMascot,
      startMascot,
      stopMascot,
    ],
  );

  const publishMode = useCallback(
    (
      kind: "live_voice" | "typed_live" | "scripted_local",
      reason: CapabilityModeReason,
      trigger:
        | "user_connected_voice"
        | "user_connected_typed"
        | "transport_failure"
        | "user_selected_local"
        | "construction_reset"
        | "offline"
        | "capability_missing",
    ) => {
      const next = transitionCapabilityMode(
        capabilityModeRef.current,
        { kind, reason },
        trigger,
      );
      capabilityModeRef.current = next;
      setCapabilityMode(next);
      if (trigger !== "user_selected_local") {
        evidenceLog?.append({
          revision: pedagogyRuntime?.getState().revision ?? 0,
          kind: `capability_${kind}`,
          status: kind === "scripted_local" ? "degraded" : "accepted",
        });
      }
    },
    [evidenceLog, pedagogyRuntime],
  );

  const connectionIsSafe = useCallback(() => {
    return isCapabilityReconnectSafe(
      connectionStateRef.current,
      pedagogyRuntime?.getState(),
    );
  }, [pedagogyRuntime]);

  const publishCancellationRuntime = useCallback(
    (session?: RealtimeWebRtcSession) => {
      if (!session) {
        onCancellationRuntime?.(undefined);
        return;
      }
      onCancellationRuntime?.({
        cancelForActivity(reason) {
          const cancelled = session.cancelForActivity(reason);
          if (reason !== "reset") return cancelled;

          session.stop();
          if (sessionRef.current === session) {
            sessionRef.current = undefined;
            transportIntentRef.current = undefined;
            setTransportIntent(undefined);
            remoteAudioRef.current = false;
            setRemoteAudio(false);
            onProactiveRuntime?.(undefined);
            clearRealtimeMascot();
            publishMode(
              "scripted_local",
              "construction_reset",
              "construction_reset",
            );
            onCancellationRuntime?.(undefined);
          }
          return true;
        },
      });
    },
    [
      clearRealtimeMascot,
      onCancellationRuntime,
      onProactiveRuntime,
      publishMode,
    ],
  );

  const markFailure = useCallback(
    (mode: RealtimeSessionMode, reason: unknown) => {
      const wasLive = capabilityModeRef.current.kind === mode;
      const localReason = localFailureReason(mode, reason, wasLive);
      publishMode("scripted_local", localReason, "transport_failure");
      setBackoff((current) => {
        const next = nextRetryBackoff(current);
        setBackoffClock(Date.now());
        return next;
      });
      onProactiveRuntime?.(undefined);
      onCancellationRuntime?.(undefined);
      clearRealtimeMascot();
      pulseMascot("realtime-error", "error", 2_400);
    },
    [
      clearRealtimeMascot,
      onCancellationRuntime,
      onProactiveRuntime,
      publishMode,
      pulseMascot,
    ],
  );

  const promoteConnectedMode = useCallback(
    (mode: RealtimeSessionMode) => {
      if (connectionStateRef.current !== "live") return;
      if (mode === "live_voice" && !remoteAudioRef.current) return;
      publishMode(
        mode,
        mode === "live_voice" ? "voice_connected" : "typed_connected",
        mode === "live_voice"
          ? "user_connected_voice"
          : "user_connected_typed",
      );
      setBackoff(EMPTY_RETRY_BACKOFF);
      if (mode === "live_voice" && sessionRef.current) {
        const session = sessionRef.current;
        onProactiveRuntime?.({
          requestProactive: (decision, directive) =>
            session.requestProactive(decision, directive),
          cancelForActivity: (reason) => session.cancelForActivity(reason),
        });
      } else {
        onProactiveRuntime?.(undefined);
      }
    },
    [onProactiveRuntime, publishMode],
  );

  const createSession = useCallback((mode: RealtimeSessionMode) => {
    if (!audioRef.current) return undefined;
    const session = new RealtimeWebRtcSession(
      audioRef.current,
      {
        onState: (next) => {
          connectionStateRef.current = next;
          setState(next);
          if (next === "closed") clearRealtimeMascot();
          if (next === "live") {
            const startedAt = sessionStartedAtRef.current;
            const sample =
              !sessionLatencyRecordedRef.current && startedAt !== undefined
                ? latencyMonitor?.record("session", Date.now() - startedAt)
                : undefined;
            sessionLatencyRecordedRef.current = true;
            if (sample?.status === "degraded") {
              const failure = new RealtimeSessionError(
                "latency_budget_exceeded",
                LATENCY_BUDGETS.session.userMessage,
                true,
              );
              setError(failure.message);
              queueMicrotask(() => {
                if (sessionRef.current === session) {
                  session.stop();
                  sessionRef.current = undefined;
                }
                markFailure(mode, failure);
              });
              return;
            }
            promoteConnectedMode(mode);
          }
        },
        onTimeline: appendTimeline,
        onEvent: (event) => {
          setLastEvent(event.type);
          handleRealtimeMascotEvent(event.type);
          if (event.type === "input_audio_buffer.speech_started") {
            onLearnerSpeechStart?.();
          }
        },
        onSessionSummary: (summary) =>
          setSessionProfile(
            "voice" in summary
              ? `${summary.model} · ${summary.voice} · ${summary.reasoningEffort}`
              : `${summary.model} · text only · ${summary.reasoningEffort}`,
          ),
        onVoiceTurn: (turn) => {
          setVoiceTurn(`${turn.turnId} · ${turn.state}`);
          const activity = mascotActivityForVoiceTurn(turn.state);
          if (activity === "error") {
            stopMascot("realtime-turn");
            pulseMascot("realtime-error", "error", 2_400);
          } else if (activity) {
            stopMascot("realtime-error");
            startMascot("realtime-turn", activity);
          } else {
            stopMascot("realtime-turn");
          }
        },
        onToolLoop: (result) =>
          setToolLoop(
            `${result.responseId} · ${result.outputCount} output(s) · ${result.continued ? "continued" : "stopped"}`,
          ),
        onRemoteAudio: (attached) => {
          remoteAudioRef.current = attached;
          setRemoteAudio(attached);
          if (attached) {
            if (firstAudioTimerRef.current !== undefined) {
              window.clearTimeout(firstAudioTimerRef.current);
              firstAudioTimerRef.current = undefined;
            }
            const startedAt = sessionStartedAtRef.current;
            const sample =
              !firstAudioLatencyRecordedRef.current && startedAt !== undefined
                ? latencyMonitor?.record("first_audio", Date.now() - startedAt)
                : undefined;
            firstAudioLatencyRecordedRef.current = true;
            if (sample?.status === "degraded") {
              const failure = new RealtimeSessionError(
                "latency_budget_exceeded",
                LATENCY_BUDGETS.first_audio.userMessage,
                true,
              );
              setError(failure.message);
              queueMicrotask(() => {
                if (sessionRef.current === session) {
                  session.stop();
                  sessionRef.current = undefined;
                }
                markFailure(mode, failure);
              });
              return;
            }
            promoteConnectedMode(mode);
          }
        },
        onTextOutput: (output) => {
          setTextOutput(output);
          setTestPromptStatus(
            text("Live text response received.", "Réponse texte reçue."),
          );
        },
        onFailure: (failure) => {
          setError(failure.message);
          markFailure(mode, failure);
        },
      },
      {
        toolRuntime,
        pedagogyRuntime,
        evidenceLog,
        operationArbiter,
        latencyMonitor,
        invarianceSummaryRuntime: {
          getCurrentContext() {
            const runtime = invarianceSummaryRuntimeRef.current;
            if (!runtime) throw new Error("Invariance context is unavailable.");
            return runtime.getCurrentContext();
          },
          renderSummary(summary) {
            const runtime = invarianceSummaryRuntimeRef.current;
            if (!runtime) throw new Error("Invariance renderer is unavailable.");
            return runtime.renderSummary(summary);
          },
        },
        transportMode: mode,
        tutorProfile,
        exerciseContext,
        geogebraWorldState: geogebraWorldStateRef.current,
        geometryHarnessVersion: geometryWorldObservationRef.current ? "v2" : "v1",
      },
    );
    const geometryObservation = geometryWorldObservationRef.current;
    if (geometryObservation) {
      session.publishGeometryWorldV2(
        geometryObservation.commit.world,
        geometryObservation.commit.delta,
        geometryObservation.pedagogy,
      );
    }
    return session;
  }, [
    appendTimeline,
    clearRealtimeMascot,
    evidenceLog,
    handleRealtimeMascotEvent,
    markFailure,
    pedagogyRuntime,
    promoteConnectedMode,
    toolRuntime,
    operationArbiter,
    onLearnerSpeechStart,
    latencyMonitor,
    pulseMascot,
    startMascot,
    stopMascot,
    text,
    tutorProfile,
    exerciseContext,
  ]);

  const requestInvarianceSummary = useCallback<
    RealtimeInvarianceRequestRuntime["requestInvarianceSummary"]
  >(
    (result, directive) => {
      let session = sessionRef.current;
      if (!session) {
        session = createSession("typed_live");
        sessionRef.current = session;
        publishCancellationRuntime(session);
      }
      return session
        ? session.requestInvarianceSummary(result, directive)
        : Promise.resolve({
            status: "ignored" as const,
            reason: "invalid_request" as const,
            runId: result.runId,
            revision: result.revision,
          });
    },
    [createSession, publishCancellationRuntime],
  );

  const stopSession = useCallback(() => {
    if (firstAudioTimerRef.current !== undefined) {
      window.clearTimeout(firstAudioTimerRef.current);
      firstAudioTimerRef.current = undefined;
    }
    sessionRef.current?.stop();
    sessionRef.current = undefined;
    transportIntentRef.current = undefined;
    setTransportIntent(undefined);
    remoteAudioRef.current = false;
    setRemoteAudio(false);
    clearRealtimeMascot();
    onProactiveRuntime?.(undefined);
    publishCancellationRuntime(undefined);
  }, [clearRealtimeMascot, onProactiveRuntime, publishCancellationRuntime]);

  const stop = () => {
    stopSession();
    publishMode(
      "scripted_local",
      "user_selected_local",
      "user_selected_local",
    );
  };

  const start = async (mode: RealtimeSessionMode) => {
    if (
      tutorProfile !== "specialized_geometry" &&
      !exerciseContext &&
      !geometryWorldObservationRef.current
    ) {
      setError(
        text(
          "Confirm your exercise before opening the coach.",
          "Confirme ton exercice avant d'ouvrir le coach.",
        ),
      );
      return;
    }
    if (tutorProfile === "geogebra_tutor" && !toolRuntime) {
      setError(
        text(
          "Wait until the GeoGebra board is ready before opening the coach.",
          "Attends que le tableau GeoGebra soit prêt avant d'ouvrir le coach.",
        ),
      );
      return;
    }
    if (!audioRef.current || state === "connecting" || state === "live") {
      return;
    }

    const modeSupported =
      mode === "live_voice" ? support.liveVoice : support.typedLive;
    if (!modeSupported) {
      const reason = support.localReason;
      publishMode(
        "scripted_local",
        reason,
        reason === "offline" ? "offline" : "capability_missing",
      );
      setError(
        reason === "offline"
          ? text(
              tutorProfile === "general_tutor"
                ? "This device is offline. Your confirmed exercise remains available on this page."
                : "This device is offline. Local construction and validation remain available.",
              tutorProfile === "general_tutor"
                ? "Cet appareil est hors ligne. Ton exercice confirmé reste disponible sur cette page."
                : "Cet appareil est hors ligne. La construction et la validation locales restent disponibles.",
            )
          : mode === "live_voice" && support.typedLive
            ? text(
                "Voice is unavailable here. Live text remains available.",
                "La voix n’est pas disponible ici. Le texte en direct reste accessible.",
              )
            : text(
                "This browser cannot open the requested Realtime transport.",
                "Ce navigateur ne peut pas ouvrir la connexion Realtime demandée.",
              ),
      );
      return;
    }
    if (!retryAllowed(backoff)) return;
    if (!connectionIsSafe()) {
      setError(
        text(
          "Finish the current student/tutor activity before starting a live connection.",
          "Termine l’activité en cours avant de lancer une connexion en direct.",
        ),
      );
      return;
    }

    stopSession();
    transportIntentRef.current = mode;
    setTransportIntent(mode);
    setTimeline([]);
    setLastEvent(undefined);
    setSessionProfile(undefined);
    setVoiceTurn(undefined);
    setToolLoop(undefined);
    setRemoteAudio(false);
    setError(undefined);
    setTestPromptStatus(undefined);
    setTextOutput(undefined);
    sessionStartedAtRef.current = Date.now();
    sessionLatencyRecordedRef.current = false;
    firstAudioLatencyRecordedRef.current = false;

    const session = createSession(mode);
    if (!session) return;
    sessionRef.current = session;
    publishCancellationRuntime(session);
    if (mode === "live_voice") {
      firstAudioTimerRef.current = window.setTimeout(() => {
        if (
          sessionRef.current !== session ||
          remoteAudioRef.current ||
          firstAudioLatencyRecordedRef.current
        ) {
          return;
        }
        firstAudioLatencyRecordedRef.current = true;
        latencyMonitor?.record(
          "first_audio",
          LATENCY_BUDGETS.first_audio.limitMs + 1,
        );
        const failure = new RealtimeSessionError(
          "latency_budget_exceeded",
          LATENCY_BUDGETS.first_audio.userMessage,
          true,
        );
        setError(failure.message);
        session.stop();
        if (sessionRef.current === session) sessionRef.current = undefined;
        markFailure(mode, failure);
      }, LATENCY_BUDGETS.first_audio.limitMs);
    }

    try {
      await session.start();
    } catch (reason) {
      if (firstAudioTimerRef.current !== undefined) {
        window.clearTimeout(firstAudioTimerRef.current);
        firstAudioTimerRef.current = undefined;
      }
      if (
        !sessionLatencyRecordedRef.current &&
        sessionStartedAtRef.current !== undefined
      ) {
        sessionLatencyRecordedRef.current = true;
        latencyMonitor?.record(
          "session",
          Math.max(0, Date.now() - sessionStartedAtRef.current),
        );
      }
      setError(friendlyError(reason, language));
      markFailure(mode, reason);
    }
  };

  useEffect(() => {
    const updateSupport = () => {
      const snapshot: BrowserCapabilitySnapshot = {
        webRtc: typeof window.RTCPeerConnection === "function",
        dataChannel:
          typeof window.RTCPeerConnection?.prototype?.createDataChannel ===
          "function",
        microphone:
          typeof navigator.mediaDevices?.getUserMedia === "function",
        audio: typeof audioRef.current?.play === "function",
        online: navigator.onLine !== false,
      };
      const next = assessCapabilitySupport(snapshot);
      setSupport(next);
      if (!next.typedLive) {
        if (sessionRef.current) stopSession();
        publishMode(
          "scripted_local",
          next.localReason,
          next.localReason === "offline" ? "offline" : "capability_missing",
        );
      } else if (
        capabilityModeRef.current.kind === "scripted_local" &&
        (next.localReason !== "local_ready" ||
          [
            "offline",
            "browser_missing_webrtc",
            "browser_missing_microphone",
            "browser_missing_audio",
          ].includes(capabilityModeRef.current.reason))
      ) {
        publishMode(
          "scripted_local",
          next.localReason,
          next.localReason === "offline" ? "offline" : "capability_missing",
        );
      }
    };
    updateSupport();
    window.addEventListener("online", updateSupport);
    window.addEventListener("offline", updateSupport);
    return () => {
      window.removeEventListener("online", updateSupport);
      window.removeEventListener("offline", updateSupport);
    };
  }, [publishMode, stopSession]);

  useEffect(() => {
    const remaining = backoff.retryAt - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setBackoffClock(Date.now()), remaining);
    return () => window.clearTimeout(timer);
  }, [backoff]);

  useEffect(() => {
    onInvarianceRequestRuntime?.({ requestInvarianceSummary });
    return () => onInvarianceRequestRuntime?.(undefined);
  }, [onInvarianceRequestRuntime, requestInvarianceSummary]);

  const sendTestPrompt = () => {
    const accepted = sessionRef.current?.requestTextTurn(testPrompt) ?? false;
    setTestPromptStatus(
      accepted
        ? text("Test prompt queued.", "Question mise en attente.")
        : text("Test prompt rejected.", "Question refusée."),
    );
    if (accepted) {
      stopMascot("realtime-error");
      startMascot("realtime-input", "thinking");
      setTestPrompt("");
    }
  };

  useEffect(
    () => () => {
      if (firstAudioTimerRef.current !== undefined) {
        window.clearTimeout(firstAudioTimerRef.current);
        firstAudioTimerRef.current = undefined;
      }
      sessionRef.current?.stop();
      clearRealtimeMascot();
      onProactiveRuntime?.(undefined);
      onCancellationRuntime?.(undefined);
    },
    [clearRealtimeMascot, onCancellationRuntime, onProactiveRuntime],
  );

  const retryReady = retryAllowed(backoff, backoffClock);
  const livePromptAvailable =
    state === "live" &&
    (capabilityMode.kind === "typed_live" || capabilityMode.kind === "live_voice");
  const coachReady =
    tutorProfile === "specialized_geometry" ||
    ((exerciseContext !== undefined || geometryWorldObservation !== undefined) &&
      (tutorProfile !== "geogebra_tutor" || toolRuntime !== undefined));

  return (
    <section
      className={`spike realtime-spike workspace-card workspace-card-coach realtime-spike--${layout}`}
      aria-labelledby="realtime-spike-title"
    >
      <div className="spike-heading">
        <div>
          <p className="section-index">
            {tutorProfile === "geogebra_tutor"
              ? layout === "panorama"
                ? text("Compass is watching your board", "Compass observe ton plan")
                : text("GeoGebra coach", "Coach GeoGebra")
              : text("Your coach · Optional", "Ton coach · Facultatif")}
          </p>
          <h2 id="realtime-spike-title">
            {tutorProfile === "geogebra_tutor"
              ? layout === "panorama"
                ? text("Explore. I’m right here.", "Explore. Je suis juste là.")
                : text("Tell me where you're stuck.", "Dis-moi où tu bloques.")
              : text(
                  "Stuck? Let's talk it through.",
                  "Bloqué ? Réfléchissons ensemble.",
                )}
          </h2>
        </div>
        <p>
          {tutorProfile === "geogebra_tutor"
            ? text(
                "I follow what changes on this GeoGebra board. I can explain the clicks or, when you explicitly ask, create, rename, move and construct with the objects on it.",
                "Je suis ce qui change dans ce tableau GeoGebra. Je peux t'expliquer les clics ou, si tu me le demandes clairement, créer, renommer, déplacer et construire avec les objets présents.",
              )
            : text(
                "Choose voice or text when you want a nudge. Compass asks questions that help you find the next move yourself.",
                "Choisis la voix ou le texte quand tu as besoin d’un coup de pouce. Compass te pose des questions pour t’aider à trouver toi-même la prochaine étape.",
              )}
        </p>
      </div>

      <div
        className={`capability-mode capability-mode-${capabilityMode.kind}`}
        data-capability-mode={capabilityMode.kind}
        role="status"
        aria-live="polite"
      >
        <span className="coach-avatar" aria-hidden="true">C</span>
        <span>{text("Your coach", "Ton coach")}</span>
        <strong>{modeTitle(capabilityMode.kind, language)}</strong>
        <p>{modeStudentCopy(capabilityMode.kind, language, tutorProfile)}</p>
        <span className="visually-hidden">
          {capabilityMode.kind.replaceAll("_", " ")}.{" "}
          {modeExplanation(capabilityMode.kind, language, tutorProfile)}
        </span>
        <span className="capability-mode-reason visually-hidden">
          {text("Reason", "Motif")}: {capabilityMode.reason.replaceAll("_", " ")}
        </span>
        <time
          dateTime={new Date(capabilityMode.since).toISOString()}
          suppressHydrationWarning
        >
          {text("Since", "Depuis")} {new Date(capabilityMode.since).toLocaleTimeString(
            language === "fr" ? "fr-FR" : "en-US",
          )}
        </time>
      </div>

      <div className="realtime-console">
        <div className="connection-control">
          <p className={`connection-state connection-state-${state}`} role="status">
            {language === "fr"
              ? {
                  idle: "en attente",
                  connecting: "connexion",
                  live: "en direct",
                  failed: "échec",
                  closed: "fermée",
                }[state]
              : state}
          </p>
          <p className="connection-copy" aria-live="polite" aria-atomic="true">
            {state === "idle" &&
              (coachReady
                ? text(
                    tutorProfile === "general_tutor"
                      ? "Your confirmed exercise is ready. Choose voice or text when you want help."
                      : tutorProfile === "geogebra_tutor"
                        ? "GeoGebra is ready. Start voice or text, then ask for the next click or an explicit construction."
                        : "Local deterministic guidance is ready. Choose a live mode only when needed.",
                    tutorProfile === "general_tutor"
                      ? "Ton exercice confirmé est prêt. Choisis la voix ou le texte quand tu veux de l'aide."
                      : tutorProfile === "geogebra_tutor"
                        ? "GeoGebra est prêt. Lance la voix ou le texte, puis demande le prochain clic ou un tracé précis."
                        : "L’accompagnement local est prêt. Choisis un mode en direct seulement si tu en as besoin.",
                  )
                : text(
                    "Confirm an exercise first so Compass knows what to help with.",
                    "Confirme d'abord un exercice pour que Compass sache sur quoi t'aider.",
                  ))}
            {state === "connecting" &&
              (transportIntent === "typed_live"
                ? text(
                    "Opening a text-only Realtime data channel…",
                    "Ouverture d’un canal Realtime en mode texte…",
                  )
                : text(
                    "Negotiating microphone, audio and the secure WebRTC session…",
                    "Connexion du microphone, de l’audio et de la session WebRTC sécurisée…",
                  ))}
            {state === "live" &&
              (capabilityMode.kind === "live_voice"
                ? text(
                    "Speak naturally. Microphone and remote audio are enabled.",
                    "Parle naturellement. Le microphone et l’audio distant sont activés.",
                  )
                : capabilityMode.kind === "typed_live"
                  ? text(
                      "Type below. Replies come from a live text-only Realtime session.",
                      "Écris ci-dessous. Les réponses viennent d’une session Realtime en mode texte.",
                    )
                  : text(
                      "The voice transport is connected; remote audio is still being verified.",
                      "La connexion vocale est établie ; l’audio distant est encore en cours de vérification.",
                    ))}
            {state === "failed" && error}
            {state === "closed" &&
              text(
                tutorProfile === "general_tutor"
                  ? "All live resources are closed. Your exercise stays available on this page."
                  : "All live resources are closed. Local construction and validation continue.",
                tutorProfile === "general_tutor"
                  ? "Toutes les ressources en direct sont fermées. Ton exercice reste disponible sur cette page."
                  : "Toutes les ressources en direct sont fermées. La construction et la validation locales continuent.",
              )}
          </p>
          <div className="connection-actions">
            <button
              type="button"
              onClick={() => void start("live_voice")}
              disabled={
                state === "connecting" ||
                state === "live" ||
                !support.liveVoice ||
                !retryReady ||
                !coachReady
              }
            >
              {text("Start voice", "Démarrer la voix")}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => void start("typed_live")}
              disabled={
                state === "connecting" ||
                state === "live" ||
                !support.typedLive ||
                !retryReady ||
                !coachReady
              }
            >
              {text("Use live text", "Utiliser le texte en direct")}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={stop}
              disabled={state !== "connecting" && state !== "live"}
            >
              {text("Stop", "Arrêter")}
            </button>
          </div>
          <form
            className="realtime-test-prompt"
            onSubmit={(event) => {
              event.preventDefault();
              sendTestPrompt();
            }}
          >
            <label htmlFor="realtime-test-prompt">
              {text("Ask your question", "Pose ta question")}
            </label>
            <div>
              <input
                id="realtime-test-prompt"
                value={testPrompt}
                onChange={(event) => setTestPrompt(event.target.value)}
                disabled={!livePromptAvailable}
                maxLength={1_000}
              />
              <button
                type="submit"
                className="button-secondary"
                disabled={!livePromptAvailable || testPrompt.trim().length === 0}
              >
                {text("Send question", "Envoyer la question")}
              </button>
            </div>
            <p role="status">{testPromptStatus}</p>
            {textOutput ? (
              <output
                className="typed-live-output"
                aria-label={text("Live text response", "Réponse texte en direct")}
              >
                {textOutput}
              </output>
            ) : null}
          </form>
          <audio
            ref={audioRef}
            autoPlay
            aria-label={text("Compass remote audio", "Audio distant de Compass")}
          />
        </div>

        <details
          className="coach-diagnostics"
          open={layout !== "dock" && (state === "live" || state === "failed")}
        >
          <summary>{text("Connection details", "Détails de connexion")}</summary>
          <div className="connection-evidence" aria-live="polite">
            <div>
            <span>{text("Capability mode", "Mode disponible")}</span>
            <strong>{capabilityMode.kind}</strong>
            </div>
            <div>
            <span>{text("Browser support", "Compatibilité du navigateur")}</span>
            <strong>
              {support.liveVoice
                ? text("voice + text", "voix + texte")
                : support.typedLive
                  ? text("text only", "texte seulement")
                  : text("local only", "local seulement")}
            </strong>
            </div>
            <div>
            <span>{text("Data channel", "Canal de données")}</span>
            <strong>
              {state === "live"
                ? text("oai-events open", "oai-events ouvert")
                : text("not open", "non ouvert")}
            </strong>
            </div>
            <div>
            <span>{text("Verified session", "Session vérifiée")}</span>
            <strong>{sessionProfile ?? text("not verified", "non vérifiée")}</strong>
            </div>
            <div>
            <span>{text("Voice turn", "Tour de parole")}</span>
            <strong>{voiceTurn ?? text("none", "aucun")}</strong>
            </div>
            <div>
            <span>{text("Tool loop", "Boucle d’outils")}</span>
            <strong>{toolLoop ?? text("none", "aucune")}</strong>
            </div>
            <div>
            <span>{text("Last server event", "Dernier événement serveur")}</span>
            <strong>{lastEvent ?? text("none", "aucun")}</strong>
            </div>
            <div>
            <span>{text("Remote audio", "Audio distant")}</span>
            <strong>
              {remoteAudio
                ? text("track attached", "piste connectée")
                : text("not attached", "non connecté")}
            </strong>
            </div>
            <div>
            <span>{text("Manual retry backoff", "Délai avant nouvel essai")}</span>
            <strong>
              {backoff.failures === 0
                ? text("clear", "aucun")
                : retryReady
                  ? text(
                      `ready after ${backoff.failures} failure(s)`,
                      `prêt après ${backoff.failures} échec(s)`,
                    )
                  : text(
                      `${Math.ceil(backoff.delayMs / 1_000)}s · failure ${backoff.failures}`,
                      `${Math.ceil(backoff.delayMs / 1_000)} s · échec ${backoff.failures}`,
                    )}
            </strong>
            </div>
            <ol aria-label={text("WebRTC timeline", "Chronologie WebRTC")}>
              {timeline.map((entry, index) => (
                <li key={`${index}-${entry}`}>{entry}</li>
              ))}
            </ol>
          </div>
        </details>
      </div>
    </section>
  );
}

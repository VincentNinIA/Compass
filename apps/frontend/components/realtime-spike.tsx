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
import type { RealtimeSessionMode } from "@/lib/realtime/session-route";
import type { ToolRuntime } from "@/lib/tools/runtime";
import type { EvidenceLog } from "@/lib/pedagogy/evidence-log";
import type { OperationArbiter } from "@/lib/operations/arbiter";
import {
  LATENCY_BUDGETS,
  type LatencyBudgetMonitor,
} from "@/lib/reliability/latency-budget";

function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission was denied. Allow access and try again.";
  }
  if (error instanceof RealtimeSessionError) {
    return error.message;
  }
  return "The Realtime connection could not be established. You can try again.";
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

function modeExplanation(kind: "live_voice" | "typed_live" | "scripted_local") {
  if (kind === "live_voice") {
    return "Live voice: peer, oai-events, microphone and remote audio are verified.";
  }
  if (kind === "typed_live") {
    return "Live text: a text-only OpenAI Realtime session is connected; microphone and audio are off.";
  }
  return "Scripted local: construction, validation and fallbacks stay local; no OpenAI or model request is sent.";
}

function modeTitle(kind: "live_voice" | "typed_live" | "scripted_local") {
  if (kind === "live_voice") return "Listening and ready";
  if (kind === "typed_live") return "Chat is ready";
  return "Ready when you are";
}

function modeStudentCopy(kind: "live_voice" | "typed_live" | "scripted_local") {
  if (kind === "live_voice") return "Ask your question out loud — you can interrupt anytime.";
  if (kind === "typed_live") return "Type a question and keep your microphone off.";
  return "Your canvas and local hints work even before you connect a coach.";
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
}) {
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
  useLayoutEffect(() => {
    invarianceSummaryRuntimeRef.current = invarianceSummaryRuntime;
  }, [invarianceSummaryRuntime]);
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
    [onCancellationRuntime, onProactiveRuntime, publishMode],
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
    },
    [onCancellationRuntime, onProactiveRuntime, publishMode],
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
        onEvent: (event) => setLastEvent(event.type),
        onSessionSummary: (summary) =>
          setSessionProfile(
            "voice" in summary
              ? `${summary.model} · ${summary.voice} · ${summary.reasoningEffort}`
              : `${summary.model} · text only · ${summary.reasoningEffort}`,
          ),
        onVoiceTurn: (turn) => setVoiceTurn(`${turn.turnId} · ${turn.state}`),
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
        onTextOutput: (text) => {
          setTextOutput(text);
          setTestPromptStatus("Live text response received.");
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
      },
    );
    return session;
  }, [
    appendTimeline,
    evidenceLog,
    markFailure,
    pedagogyRuntime,
    promoteConnectedMode,
    toolRuntime,
    operationArbiter,
    latencyMonitor,
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
    onProactiveRuntime?.(undefined);
    publishCancellationRuntime(undefined);
  }, [onProactiveRuntime, publishCancellationRuntime]);

  const stop = () => {
    stopSession();
    publishMode(
      "scripted_local",
      "user_selected_local",
      "user_selected_local",
    );
  };

  const start = async (mode: RealtimeSessionMode) => {
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
          ? "This device is offline. Local construction and validation remain available."
          : mode === "live_voice" && support.typedLive
            ? "Voice is unavailable here. Live text remains available."
            : "This browser cannot open the requested Realtime transport.",
      );
      return;
    }
    if (!retryAllowed(backoff)) return;
    if (!connectionIsSafe()) {
      setError(
        "Finish the current student/tutor activity before starting a live connection.",
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
      setError(friendlyError(reason));
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
    setTestPromptStatus(accepted ? "Test prompt queued." : "Test prompt rejected.");
    if (accepted) setTestPrompt("");
  };

  useEffect(
    () => () => {
      if (firstAudioTimerRef.current !== undefined) {
        window.clearTimeout(firstAudioTimerRef.current);
        firstAudioTimerRef.current = undefined;
      }
      sessionRef.current?.stop();
      onProactiveRuntime?.(undefined);
      onCancellationRuntime?.(undefined);
    },
    [onCancellationRuntime, onProactiveRuntime],
  );

  const retryReady = retryAllowed(backoff, backoffClock);
  const livePromptAvailable =
    state === "live" &&
    (capabilityMode.kind === "typed_live" || capabilityMode.kind === "live_voice");

  return (
    <section
      className="spike realtime-spike workspace-card workspace-card-coach"
      aria-labelledby="realtime-spike-title"
    >
      <div className="spike-heading">
        <div>
          <p className="section-index">Your coach · Optional</p>
          <h2 id="realtime-spike-title">Stuck? Let&apos;s talk it through.</h2>
        </div>
        <p>
          Choose voice or text when you want a nudge. GeoTutor asks questions
          that help you find the next move yourself.
        </p>
      </div>

      <div
        className={`capability-mode capability-mode-${capabilityMode.kind}`}
        data-capability-mode={capabilityMode.kind}
        role="status"
        aria-live="polite"
      >
        <span className="coach-avatar" aria-hidden="true">G</span>
        <span>Your coach</span>
        <strong>{modeTitle(capabilityMode.kind)}</strong>
        <p>{modeStudentCopy(capabilityMode.kind)}</p>
        <span className="visually-hidden">
          {capabilityMode.kind.replaceAll("_", " ")}. {modeExplanation(capabilityMode.kind)}
        </span>
        <span className="capability-mode-reason visually-hidden">
          Reason: {capabilityMode.reason.replaceAll("_", " ")}
        </span>
        <time
          dateTime={new Date(capabilityMode.since).toISOString()}
          suppressHydrationWarning
        >
          Since {new Date(capabilityMode.since).toLocaleTimeString()}
        </time>
      </div>

      <div className="realtime-console">
        <div className="connection-control">
          <p className={`connection-state connection-state-${state}`} role="status">
            {state}
          </p>
          <p className="connection-copy" aria-live="polite" aria-atomic="true">
            {state === "idle" &&
              "Local deterministic guidance is ready. Choose a live mode only when needed."}
            {state === "connecting" &&
              (transportIntent === "typed_live"
                ? "Opening a text-only Realtime data channel…"
                : "Negotiating microphone, audio and the secure WebRTC session…")}
            {state === "live" &&
              (capabilityMode.kind === "live_voice"
                ? "Speak naturally. Microphone and remote audio are enabled."
                : capabilityMode.kind === "typed_live"
                  ? "Type below. Replies come from a live text-only Realtime session."
                  : "The voice transport is connected; remote audio is still being verified.")}
            {state === "failed" && error}
            {state === "closed" &&
              "All live resources are closed. Local construction and validation continue."}
          </p>
          <div className="connection-actions">
            <button
              type="button"
              onClick={() => void start("live_voice")}
              disabled={
                state === "connecting" ||
                state === "live" ||
                !support.liveVoice ||
                !retryReady
              }
            >
              Start voice
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => void start("typed_live")}
              disabled={
                state === "connecting" ||
                state === "live" ||
                !support.typedLive ||
                !retryReady
              }
            >
              Use live text
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={stop}
              disabled={state !== "connecting" && state !== "live"}
            >
              Stop
            </button>
          </div>
          <form
            className="realtime-test-prompt"
            onSubmit={(event) => {
              event.preventDefault();
              sendTestPrompt();
            }}
          >
            <label htmlFor="realtime-test-prompt">Ask your question</label>
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
                Send question
              </button>
            </div>
            <p role="status">{testPromptStatus}</p>
            {textOutput ? (
              <output className="typed-live-output" aria-label="Live text response">
                {textOutput}
              </output>
            ) : null}
          </form>
          <audio ref={audioRef} autoPlay aria-label="GeoTutor remote audio" />
        </div>

        <details
          className="coach-diagnostics"
          open={state === "live" || state === "failed"}
        >
          <summary>Connection details</summary>
          <div className="connection-evidence" aria-live="polite">
            <div>
            <span>Capability mode</span>
            <strong>{capabilityMode.kind}</strong>
            </div>
            <div>
            <span>Browser support</span>
            <strong>
              {support.liveVoice
                ? "voice + text"
                : support.typedLive
                  ? "text only"
                  : "local only"}
            </strong>
            </div>
            <div>
            <span>Data channel</span>
            <strong>{state === "live" ? "oai-events open" : "not open"}</strong>
            </div>
            <div>
            <span>Verified session</span>
            <strong>{sessionProfile ?? "not verified"}</strong>
            </div>
            <div>
            <span>Voice turn</span>
            <strong>{voiceTurn ?? "none"}</strong>
            </div>
            <div>
            <span>Tool loop</span>
            <strong>{toolLoop ?? "none"}</strong>
            </div>
            <div>
            <span>Last server event</span>
            <strong>{lastEvent ?? "none"}</strong>
            </div>
            <div>
            <span>Remote audio</span>
            <strong>{remoteAudio ? "track attached" : "not attached"}</strong>
            </div>
            <div>
            <span>Manual retry backoff</span>
            <strong>
              {backoff.failures === 0
                ? "clear"
                : retryReady
                  ? `ready after ${backoff.failures} failure(s)`
                  : `${Math.ceil(backoff.delayMs / 1_000)}s · failure ${backoff.failures}`}
            </strong>
            </div>
            <ol aria-label="WebRTC timeline">
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

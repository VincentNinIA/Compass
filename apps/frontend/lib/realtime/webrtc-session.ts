import {
  VoiceTurnManager,
  type ExplicitTurnRequest,
  type VoiceTurn,
} from "./voice-turn";
import { RealtimeToolLoop, type ToolLoopResult } from "./tool-loop";
import type { ToolRuntime } from "@/lib/tools/runtime";
import type { InterventionDirective } from "@/lib/pedagogy/directive";
import type { PolicyDecision } from "@/lib/pedagogy/policy";
import type { PedagogyEvent, PedagogyState } from "@/lib/pedagogy/state";
import {
  ProactiveTurnOrchestrator,
  type ProactiveRequestResult,
  type ProactiveTurnSnapshot,
} from "./proactive-turn";
import { ResponseGate } from "./response-gate";
import { CancellationCoordinator } from "@/lib/pedagogy/cancellation";
import type {
  CancellationReason,
  EvidenceLog,
} from "@/lib/pedagogy/evidence-log";

export type RealtimeConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "failed"
  | "closed";

export type RealtimeServerEvent = {
  type: string;
};

export type RealtimeSessionSummary = {
  model: "gpt-realtime-2.1";
  voice: "marin";
  reasoningEffort: "low";
  turnDetection: "server_vad";
  createResponse: false;
  interruptResponse: true;
};

type RealtimeWebRtcCallbacks = {
  onState(state: RealtimeConnectionState): void;
  onTimeline(entry: string): void;
  onEvent(event: RealtimeServerEvent): void;
  onSessionSummary(summary: RealtimeSessionSummary): void;
  onVoiceTurn(turn: VoiceTurn): void;
  onToolLoop(result: ToolLoopResult): void;
  onRemoteAudio(attached: boolean): void;
  onFailure(error: RealtimeSessionError): void;
};

export type RealtimePedagogyRuntime = {
  getState(): PedagogyState;
  dispatch(event: PedagogyEvent): PedagogyState;
  cancelLocalEffects?(reason: CancellationReason): boolean;
  onProactiveTurn?(snapshot: ProactiveTurnSnapshot): void;
};

export type RealtimeProactiveRuntime = {
  requestProactive(
    decision: PolicyDecision,
    directive: InterventionDirective,
  ): ProactiveRequestResult;
  cancelForActivity(reason: CancellationReason): boolean;
};

type RealtimeWebRtcDependencies = {
  mediaDevices?: Pick<MediaDevices, "getUserMedia">;
  createPeerConnection?: () => RTCPeerConnection;
  fetchImpl?: typeof fetch;
  toolRuntime?: ToolRuntime;
  pedagogyRuntime?: RealtimePedagogyRuntime;
  evidenceLog?: EvidenceLog;
};

const KNOWN_ROUTE_ERRORS = new Set([
  "realtime_unconfigured",
  "upstream_authentication_failed",
  "upstream_configuration_rejected",
  "upstream_rate_limited",
  "upstream_unavailable",
  "upstream_invalid_response",
  "upstream_timeout",
]);

const EXPECTED_SESSION = {
  model: "gpt-realtime-2.1",
  voice: "marin",
  reasoningEffort: "low",
  turnDetection: "server_vad",
  createResponse: false,
  interruptResponse: true,
} as const satisfies RealtimeSessionSummary;

export class RealtimeSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RealtimeSessionError";
  }
}

async function readRouteError(response: Response): Promise<RealtimeSessionError> {
  try {
    const payload = (await response.json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (
      typeof payload.error?.code === "string" &&
      KNOWN_ROUTE_ERRORS.has(payload.error.code) &&
      typeof payload.error.message === "string"
    ) {
      return new RealtimeSessionError(payload.error.code, payload.error.message);
    }
  } catch {
    // The application never exposes an unknown upstream body to the UI.
  }
  return new RealtimeSessionError(
    "session_negotiation_failed",
    "Realtime session negotiation failed.",
  );
}

export class RealtimeWebRtcSession {
  private readonly mediaDevices: Pick<MediaDevices, "getUserMedia">;
  private readonly createPeerConnection: () => RTCPeerConnection;
  private readonly fetchImpl: typeof fetch;
  private readonly callbacks: RealtimeWebRtcCallbacks;
  private readonly audioElement: HTMLAudioElement;

  private stream?: MediaStream;
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private state: RealtimeConnectionState = "idle";
  private stopped = false;
  private resourcesReleased = false;
  private channelOpen = false;
  private sessionVerified = false;
  private activeResponseId?: string;
  private readonly cancelledResponseIds = new Set<string>();
  private readonly interruptedSpeechItems = new Set<string>();
  private audioSuppressed = false;
  private sendsBlocked = false;
  private readonly responseGate: ResponseGate;
  private readonly voiceTurns: VoiceTurnManager;
  private readonly proactiveTurns?: ProactiveTurnOrchestrator;
  private readonly toolLoop?: RealtimeToolLoop;
  private readonly pedagogyRuntime?: RealtimePedagogyRuntime;
  private readonly evidenceLog?: EvidenceLog;
  private readonly cancellationCoordinator?: CancellationCoordinator;
  private clientEventSequence = 0;

  constructor(
    audioElement: HTMLAudioElement,
    callbacks: RealtimeWebRtcCallbacks,
    dependencies: RealtimeWebRtcDependencies = {},
  ) {
    this.audioElement = audioElement;
    this.callbacks = callbacks;
    this.mediaDevices = dependencies.mediaDevices ?? navigator.mediaDevices;
    this.createPeerConnection =
      dependencies.createPeerConnection ?? (() => new RTCPeerConnection());
    this.fetchImpl = dependencies.fetchImpl ?? ((input, init) => fetch(input, init));
    this.responseGate = new ResponseGate();
    const pedagogyRuntime = dependencies.pedagogyRuntime;
    this.pedagogyRuntime = pedagogyRuntime;
    this.evidenceLog = dependencies.evidenceLog;
    this.voiceTurns = new VoiceTurnManager({
      send: (event) => this.sendClientEvent(event),
      onTurn: (turn) => {
        callbacks.onVoiceTurn(turn);
        if (pedagogyRuntime) this.reduceExplicitTurn(pedagogyRuntime, turn);
      },
      responseGate: this.responseGate,
      createExplicitRequest: pedagogyRuntime
        ? (turnId, speechEventId) =>
            this.createExplicitRequest(pedagogyRuntime, turnId, speechEventId)
        : undefined,
    });
    if (pedagogyRuntime) {
      this.proactiveTurns = new ProactiveTurnOrchestrator({
        send: (event) => this.sendClientEvent(event),
        getState: () => pedagogyRuntime.getState(),
        dispatch: (event) => pedagogyRuntime.dispatch(event),
        responseGate: this.responseGate,
        onStatus: pedagogyRuntime.onProactiveTurn,
        onGateReleased: () => this.voiceTurns.resumePending(),
        evidenceLog: dependencies.evidenceLog,
      });
    }
    if (dependencies.toolRuntime) {
      this.toolLoop = new RealtimeToolLoop({
        gateway: dependencies.toolRuntime.gateway,
        getContext: dependencies.toolRuntime.getContext,
        send: (event) => this.sendClientEvent(event),
        onContinuation: () => this.voiceTurns.continueAfterTools(),
        onFailure: () => this.voiceTurns.failAfterTools(),
        evidenceLog: dependencies.evidenceLog,
      });
    }
    if (pedagogyRuntime) {
      this.cancellationCoordinator = new CancellationCoordinator({
        getState: () => pedagogyRuntime.getState(),
        dispatch: (event) => pedagogyRuntime.dispatch(event),
        cancelTransport: (reason) => this.cancelTransport(reason),
        cancelHint: (reason) =>
          pedagogyRuntime.cancelLocalEffects?.(reason) ?? false,
        getScope: () => this.cancellationScope(),
        evidenceLog: dependencies.evidenceLog,
      });
    }
  }

  async start(): Promise<void> {
    if (this.state !== "idle") {
      throw new RealtimeSessionError(
        "invalid_state",
        "This Realtime session has already been started.",
      );
    }

    this.setState("connecting");
    this.callbacks.onTimeline("Requesting microphone permission");

    try {
      this.stream = await this.mediaDevices.getUserMedia({ audio: true });
      if (this.stopped) {
        this.stopTracks(this.stream);
        this.stream = undefined;
        return;
      }

      this.callbacks.onTimeline("Microphone acquired");
      const peer = this.createPeerConnection();
      this.peer = peer;
      this.channel = peer.createDataChannel("oai-events");
      this.bindResourceHandlers();

      for (const track of this.stream.getTracks()) {
        peer.addTrack(track, this.stream);
      }

      const offer = await peer.createOffer();
      if (this.stopped) {
        return;
      }
      await peer.setLocalDescription(offer);
      if (this.stopped) {
        return;
      }
      if (!offer.sdp) {
        throw new RealtimeSessionError("invalid_offer", "The browser produced no SDP offer.");
      }

      this.callbacks.onTimeline("SDP offer created");
      const response = await this.fetchImpl("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (this.stopped) {
        return;
      }
      if (!response.ok) {
        throw await readRouteError(response);
      }

      const answer = await response.text();
      if (this.stopped) {
        return;
      }
      if (!answer.startsWith("v=0")) {
        throw new RealtimeSessionError(
          "invalid_answer",
          "The server returned an invalid SDP answer.",
        );
      }

      await peer.setRemoteDescription({ type: "answer", sdp: answer });
      if (this.stopped) {
        return;
      }
      this.callbacks.onTimeline("SDP answer applied");
    } catch (error) {
      if (this.stopped) {
        return;
      }
      this.releaseResources();
      this.setState("failed");
      throw error;
    }
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.cancelForActivity("application_stop");
    this.stopped = true;
    this.releaseResources();
    this.setState("closed");
    this.callbacks.onTimeline("Session resources released");
  }

  requestProactive(
    decision: PolicyDecision,
    directive: InterventionDirective,
  ): ProactiveRequestResult {
    if (
      !this.proactiveTurns ||
      this.stopped ||
      !this.channelOpen ||
      this.sendsBlocked
    ) {
      return "unavailable";
    }
    return this.proactiveTurns.request(decision, directive);
  }

  cancelActiveResponse(reason: "barge-in" | "stop"): boolean {
    return this.cancelForActivity(
      reason === "barge-in" ? "student_speech" : "application_stop",
    );
  }

  cancelForActivity(reason: CancellationReason): boolean {
    const result = this.cancellationCoordinator?.cancel(reason);
    return result
      ? result.status === "cancelled"
      : this.cancelTransport(reason);
  }

  isSendBlocked(): boolean {
    return this.sendsBlocked;
  }

  private cancelTransport(reason: CancellationReason): boolean {
    const proactive = this.proactiveTurns?.snapshot();
    if (proactive) {
      this.toolLoop?.cancel();
      this.voiceTurns.cancelOpen();
      if (proactive.responseId) {
        this.cancelledResponseIds.add(proactive.responseId);
      }
      const cancelled = this.proactiveTurns!.cancelForExplicit();
      this.activeResponseId = undefined;
      this.suppressLocalAudio();
      this.callbacks.onTimeline(`Cancelled proactive response for ${reason}`);
      return cancelled;
    }
    const responseId = this.activeResponseId;
    const hadOpenWork = Boolean(
      responseId || this.voiceTurns.hasOpenWork() || this.toolLoop?.hasInFlight(),
    );
    if (!hadOpenWork) return false;
    this.toolLoop?.cancel();
    this.voiceTurns.cancelOpen();
    if (responseId) this.cancelledResponseIds.add(responseId);
    this.activeResponseId = undefined;
    const cancelled = this.sendClientEvent(
      responseId
        ? { type: "response.cancel", response_id: responseId }
        : { type: "response.cancel" },
    );
    const cleared = this.sendClientEvent({ type: "output_audio_buffer.clear" });
    this.suppressLocalAudio();
    this.callbacks.onTimeline(
      `Cancelled ${responseId ?? "pending response"} for ${reason}`,
    );
    return cancelled && cleared;
  }

  private cancellationScope(): string {
    const proactive = this.proactiveTurns?.snapshot();
    return [
      proactive
        ? `proactive:${proactive.directiveId}:${proactive.responseId ?? proactive.itemId}`
        : "-",
      this.voiceTurns.currentTurnId() ?? "-",
      this.voiceTurns.currentResponseId() ?? "-",
      this.activeResponseId ?? "-",
      this.toolLoop?.hasInFlight() ? "tooling" : "-",
    ].join("|");
  }

  private bindResourceHandlers(): void {
    if (!this.peer || !this.channel) {
      return;
    }

    this.peer.onconnectionstatechange = () => {
      if (!this.peer || this.stopped) {
        return;
      }
      this.callbacks.onTimeline(`Peer ${this.peer.connectionState}`);
      if (this.peer.connectionState === "failed") {
        this.fail(
          "peer_connection_failed",
          "The WebRTC peer connection failed. You can try again.",
        );
      }
    };

    this.peer.ontrack = (event) => {
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      this.audioElement.srcObject = remoteStream;
      if (!this.audioSuppressed && !this.sendsBlocked) {
        void this.audioElement.play().catch(() => {
          this.callbacks.onTimeline("Remote audio ready; playback needs interaction");
        });
      }
      this.callbacks.onRemoteAudio(true);
      this.callbacks.onTimeline("Remote audio track attached");
    };

    this.channel.onopen = () => {
      if (!this.stopped) {
        this.channelOpen = true;
        this.callbacks.onTimeline("Data channel oai-events open");
        this.maybeSetLive();
      }
    };

    this.channel.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as unknown;
        if (!isRawRealtimeEvent(event)) return;
        const responseId = readEventResponseId(event);
        const responseOwner = readEventResponseOwner(event);
        if (event.type === "output_audio_buffer.cleared") {
          this.restoreRealtimeCoherence();
        }
        if (responseId && this.cancelledResponseIds.has(responseId)) {
          this.callbacks.onTimeline(`Ignored late ${event.type}`);
          return;
        }
        const responseTurnId = readEventTurnId(event);
        if (
          event.type === "response.done" &&
          !responseOwner?.startsWith("proactive:") &&
          responseTurnId !== this.voiceTurns.currentTurnId()
        ) {
          this.callbacks.onTimeline("Ignored unowned response.done");
          return;
        }
        if (
          (event.type === "session.created" || event.type === "session.updated") &&
          !this.acceptSessionCreated(event)
        ) {
          return;
        }
        if (event.type === "input_audio_buffer.speech_started") {
          const itemId = readString(event.item_id);
          if (itemId && !this.interruptedSpeechItems.has(itemId)) {
            this.interruptedSpeechItems.add(itemId);
            this.cancelForActivity("student_speech");
          }
        }
        if (this.pedagogyRuntime && event.type === "input_audio_buffer.speech_started") {
          this.dispatchInteraction(this.pedagogyRuntime, "student_speech_started");
        }
        if (this.pedagogyRuntime && event.type === "input_audio_buffer.speech_stopped") {
          this.dispatchInteraction(this.pedagogyRuntime, "student_speech_ended");
        }
        if (event.type === "error") {
          this.cancelForActivity("response_error");
        }
        if (
          responseId &&
          this.pedagogyRuntime &&
          !responseOwner?.startsWith("proactive:") &&
          (event.type === "response.created" || event.type === "response.done") &&
          !responseAnchorIsCurrent(event, this.pedagogyRuntime.getState())
        ) {
          if (!this.activeResponseId || this.activeResponseId === responseId) {
            this.activeResponseId = responseId;
            this.cancelForActivity("stale_revision");
          } else {
            this.cancelledResponseIds.add(responseId);
            this.sendClientEvent({ type: "response.cancel", response_id: responseId });
            this.sendClientEvent({ type: "output_audio_buffer.clear" });
            this.suppressLocalAudio();
          }
          this.callbacks.onTimeline(`Rejected stale ${event.type}`);
          return;
        }
        const proactiveHandled = this.proactiveTurns?.handle(event) ?? false;
        this.voiceTurns.handle(event);
        if (event.type === "response.created" && responseId) {
          const proactiveOwner = responseOwner?.startsWith("proactive:");
          if (
            (proactiveOwner &&
              (!proactiveHandled ||
                this.proactiveTurns?.snapshot()?.responseId !== responseId)) ||
            (!proactiveOwner && this.voiceTurns.currentResponseId() !== responseId)
          ) {
            this.cancelledResponseIds.add(responseId);
            this.sendClientEvent({ type: "response.cancel", response_id: responseId });
            this.sendClientEvent({ type: "output_audio_buffer.clear" });
            this.suppressLocalAudio();
            this.callbacks.onTimeline(`Rejected unowned response ${responseId}`);
            return;
          }
          this.activeResponseId = responseId;
          if (
            this.audioSuppressed &&
            !this.sendsBlocked &&
            this.audioElement.srcObject
          ) {
            this.audioSuppressed = false;
            void this.audioElement.play().catch(() => {
              this.callbacks.onTimeline("Remote audio resume needs interaction");
            });
          }
        }
        if (this.toolLoop?.canHandle(event)) {
          if (responseTurnId) {
            void this.toolLoop.handle(event, responseTurnId).then((result) => {
              if (result) this.callbacks.onToolLoop(result);
            });
          }
        }
        if (event.type === "response.done" && responseId === this.activeResponseId) {
          this.activeResponseId = undefined;
        }
        this.callbacks.onEvent({ type: event.type });
        this.callbacks.onTimeline(`Received ${event.type}`);
      } catch {
        this.callbacks.onTimeline("Ignored malformed server event");
      }
    };

    this.channel.onerror = () => {
      if (!this.stopped) {
        this.fail(
          "data_channel_failed",
          "The Realtime data channel failed. You can try again.",
        );
      }
    };

    this.channel.onclose = () => {
      if (!this.stopped) {
        this.fail(
          "data_channel_closed",
          "The Realtime data channel closed unexpectedly. You can try again.",
        );
      }
    };
  }

  private releaseResources(): void {
    if (this.resourcesReleased) {
      return;
    }
    this.resourcesReleased = true;

    if (this.peer) {
      this.peer.onconnectionstatechange = null;
      this.peer.ontrack = null;
    }
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onmessage = null;
      this.channel.onerror = null;
      this.channel.onclose = null;
      if (this.channel.readyState !== "closed") {
        this.channel.close();
      }
    }
    this.stopTracks(this.stream);
    if (this.peer && this.peer.signalingState !== "closed") {
      this.peer.close();
    }

    this.audioElement.pause();
    this.audioElement.srcObject = null;
    this.callbacks.onRemoteAudio(false);
    this.channel = undefined;
    this.peer = undefined;
    this.stream = undefined;
    this.voiceTurns.close();
    this.proactiveTurns?.close();
    this.toolLoop?.cancel();
  }

  private acceptSessionCreated(event: RawRealtimeEvent): boolean {
    const summary = readSessionSummary(event);
    if (!summary || !sameSessionSummary(summary, EXPECTED_SESSION)) {
      this.callbacks.onTimeline(`Session mismatch: ${sessionMismatchFields(event).join(", ")}`);
      this.fail(
        "unexpected_session_configuration",
        "Realtime returned an unexpected session configuration.",
      );
      return false;
    }
    this.sessionVerified = true;
    this.callbacks.onSessionSummary(summary);
    this.callbacks.onTimeline("Session configuration verified");
    this.maybeSetLive();
    return true;
  }

  private maybeSetLive(): void {
    if (this.channelOpen && this.sessionVerified && !this.stopped) {
      this.setState("live");
    }
  }

  private sendClientEvent(event: { type: string; [key: string]: unknown }): boolean {
    const isRecoveryControl =
      event.type === "response.cancel" ||
      event.type === "output_audio_buffer.clear";
    if (this.sendsBlocked && !isRecoveryControl) {
      this.callbacks.onTimeline(`Blocked ${event.type} until Realtime is coherent`);
      return false;
    }
    if (!this.channel || this.channel.readyState !== "open" || this.stopped) {
      if (event.type === "output_audio_buffer.clear") this.markClearFailed();
      return false;
    }
    const clientEvent =
      typeof event.event_id === "string" && event.event_id.length > 0
        ? event
        : { ...event, event_id: `rtc-event-${++this.clientEventSequence}` };
    try {
      this.channel.send(JSON.stringify(clientEvent));
      this.callbacks.onTimeline(`Sent ${event.type}`);
      return true;
    } catch {
      if (event.type === "output_audio_buffer.clear") this.markClearFailed();
      this.callbacks.onTimeline(`Failed to send ${event.type}`);
      return false;
    }
  }

  private markClearFailed(): void {
    this.suppressLocalAudio();
    if (this.sendsBlocked) return;
    this.sendsBlocked = true;
    const state = this.pedagogyRuntime?.getState();
    this.evidenceLog?.append({
      eventType: "send_blocked",
      epoch: state?.epoch ?? 0,
      revision: state?.revision ?? 0,
      ...(state?.activeResponse?.responseId
        ? { responseId: state.activeResponse.responseId }
        : {}),
      ...(state?.verifiedFacts.length
        ? { evidenceIds: state.verifiedFacts.map(({ evidenceId }) => evidenceId) }
        : {}),
      outcome: "blocked",
      reason: "clear_failed",
    });
    this.callbacks.onTimeline("Audio clear failed; new sends are blocked");
  }

  private suppressLocalAudio(): void {
    if (!this.audioSuppressed) this.audioElement.pause();
    this.audioSuppressed = true;
  }

  private restoreRealtimeCoherence(): void {
    if (!this.sendsBlocked) return;
    this.sendsBlocked = false;
    const state = this.pedagogyRuntime?.getState();
    this.evidenceLog?.append({
      eventType: "realtime_coherent",
      epoch: state?.epoch ?? 0,
      revision: state?.revision ?? 0,
      outcome: "accepted",
      reason: "audio_buffer_cleared",
    });
    this.callbacks.onTimeline("Realtime audio buffer is coherent");
  }

  private createExplicitRequest(
    runtime: RealtimePedagogyRuntime,
    turnId: string,
    speechEventId: string | undefined,
  ): ExplicitTurnRequest | undefined {
    const state = runtime.getState();
    if (
      !speechEventId ||
      state.studentSnapshotHash.length === 0 ||
      state.interaction.studentIsDragging ||
      state.interaction.studentIsSpeaking ||
      state.interaction.tutorIsSpeaking ||
      state.pendingIntervention ||
      state.activeResponse
    ) {
      return undefined;
    }
    return {
      turnId,
      epoch: state.epoch,
      revision: state.revision,
      snapshotHash: state.studentSnapshotHash,
      speechEventId,
    };
  }

  private reduceExplicitTurn(
    runtime: RealtimePedagogyRuntime,
    turn: VoiceTurn,
  ): void {
    if (!turn.responseId) return;
    const state = runtime.getState();
    const common = {
      epoch: state.epoch,
      revision: state.revision,
      snapshotHash: state.studentSnapshotHash,
    };
    if (turn.state === "responding") {
      runtime.dispatch({
        type: "response_started",
        responseId: turn.responseId,
        ...common,
      });
      return;
    }
    if (
      turn.state === "tooling" &&
      state.activeResponse?.responseId === turn.responseId
    ) {
      runtime.dispatch({
        type: "response_finished",
        responseId: turn.responseId,
        ...common,
      });
      return;
    }
    if (state.activeResponse?.responseId !== turn.responseId) return;
    const type =
      turn.state === "completed"
        ? "response_finished"
        : turn.state === "cancelled"
          ? "response_cancelled"
          : turn.state === "failed"
            ? "response_failed"
            : undefined;
    if (type) runtime.dispatch({ type, responseId: turn.responseId, ...common });
  }

  private dispatchInteraction(
    runtime: RealtimePedagogyRuntime,
    type: "student_speech_started" | "student_speech_ended",
  ): void {
    const state = runtime.getState();
    runtime.dispatch({
      type,
      epoch: state.epoch,
      revision: state.revision,
      snapshotHash: state.studentSnapshotHash,
    });
  }

  private stopTracks(stream?: MediaStream): void {
    for (const track of stream?.getTracks() ?? []) {
      if (track.readyState !== "ended") {
        track.stop();
      }
    }
  }

  private fail(code: string, message: string): void {
    if (this.stopped || this.state === "failed") {
      return;
    }
    const error = new RealtimeSessionError(code, message);
    this.callbacks.onTimeline(message);
    this.cancelForActivity("response_error");
    this.releaseResources();
    this.callbacks.onFailure(error);
    this.setState("failed");
  }

  private setState(state: RealtimeConnectionState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.callbacks.onState(state);
  }
}

type RawRealtimeEvent = {
  type: string;
  [key: string]: unknown;
};

function isRawRealtimeEvent(value: unknown): value is RawRealtimeEvent {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { type?: unknown }).type === "string",
  );
}

function readEventResponseId(event: RawRealtimeEvent): string | undefined {
  if (typeof event.response_id === "string" && event.response_id.length > 0) {
    return event.response_id;
  }
  if (
    event.response &&
    typeof event.response === "object" &&
    typeof (event.response as { id?: unknown }).id === "string"
  ) {
    return (event.response as { id: string }).id;
  }
  return undefined;
}

function readEventTurnId(event: RawRealtimeEvent): string | undefined {
  if (!event.response || typeof event.response !== "object") return undefined;
  const metadata = (event.response as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return readString((metadata as { geotutor_turn_id?: unknown }).geotutor_turn_id);
}

function readEventResponseOwner(event: RawRealtimeEvent): string | undefined {
  if (!event.response || typeof event.response !== "object") return undefined;
  const metadata = (event.response as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return readString(
    (metadata as { geotutor_response_owner?: unknown })
      .geotutor_response_owner,
  );
}

function responseAnchorIsCurrent(
  event: RawRealtimeEvent,
  state: PedagogyState,
): boolean {
  if (!event.response || typeof event.response !== "object") return false;
  const metadata = (event.response as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return false;
  const value = metadata as {
    geotutor_epoch?: unknown;
    geotutor_revision?: unknown;
    geotutor_snapshot_hash?: unknown;
  };
  return (
    value.geotutor_epoch === String(state.epoch) &&
    value.geotutor_revision === String(state.revision) &&
    value.geotutor_snapshot_hash === state.studentSnapshotHash
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readSessionSummary(event: RawRealtimeEvent): RealtimeSessionSummary | undefined {
  const session = event.session;
  if (!session || typeof session !== "object") return undefined;
  const value = session as {
    model?: unknown;
    audio?: {
      input?: {
        turn_detection?: {
          type?: unknown;
          create_response?: unknown;
          interrupt_response?: unknown;
        };
      };
      output?: { voice?: unknown };
    };
    reasoning?: { effort?: unknown };
  };
  if (
    value.model !== EXPECTED_SESSION.model ||
    value.audio?.output?.voice !== EXPECTED_SESSION.voice ||
    value.reasoning?.effort !== EXPECTED_SESSION.reasoningEffort ||
    value.audio?.input?.turn_detection?.type !== EXPECTED_SESSION.turnDetection ||
    value.audio.input.turn_detection.create_response !== EXPECTED_SESSION.createResponse ||
    value.audio.input.turn_detection.interrupt_response !==
      EXPECTED_SESSION.interruptResponse
  ) {
    return undefined;
  }
  return { ...EXPECTED_SESSION };
}

function sessionMismatchFields(event: RawRealtimeEvent): string[] {
  const session = event.session as
    | {
        model?: unknown;
        audio?: {
          input?: {
            turn_detection?: {
              type?: unknown;
              create_response?: unknown;
              interrupt_response?: unknown;
            };
          };
          output?: { voice?: unknown };
        };
        reasoning?: { effort?: unknown };
      }
    | undefined;
  const checks = {
    model: session?.model === EXPECTED_SESSION.model,
    voice: session?.audio?.output?.voice === EXPECTED_SESSION.voice,
    reasoning: session?.reasoning?.effort === EXPECTED_SESSION.reasoningEffort,
    vad: session?.audio?.input?.turn_detection?.type === EXPECTED_SESSION.turnDetection,
    createResponse:
      session?.audio?.input?.turn_detection?.create_response ===
      EXPECTED_SESSION.createResponse,
    interruptResponse:
      session?.audio?.input?.turn_detection?.interrupt_response ===
      EXPECTED_SESSION.interruptResponse,
  };
  return Object.entries(checks)
    .filter(([, matches]) => !matches)
    .map(([field]) => field);
}

function sameSessionSummary(
  actual: RealtimeSessionSummary,
  expected: RealtimeSessionSummary,
): boolean {
  return (
    actual.model === expected.model &&
    actual.voice === expected.voice &&
    actual.reasoningEffort === expected.reasoningEffort &&
    actual.turnDetection === expected.turnDetection &&
    actual.createResponse === expected.createResponse &&
    actual.interruptResponse === expected.interruptResponse
  );
}

export type RealtimeConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "failed"
  | "closed";

export type RealtimeServerEvent = {
  type: string;
  [key: string]: unknown;
};

type RealtimeWebRtcCallbacks = {
  onState(state: RealtimeConnectionState): void;
  onTimeline(entry: string): void;
  onEvent(event: RealtimeServerEvent): void;
  onRemoteAudio(attached: boolean): void;
  onFailure(error: RealtimeSessionError): void;
};

type RealtimeWebRtcDependencies = {
  mediaDevices?: Pick<MediaDevices, "getUserMedia">;
  createPeerConnection?: () => RTCPeerConnection;
  fetchImpl?: typeof fetch;
};

const KNOWN_ROUTE_ERRORS = new Set([
  "realtime_unconfigured",
  "upstream_authentication_failed",
  "upstream_rate_limited",
  "upstream_unavailable",
  "upstream_invalid_response",
  "upstream_timeout",
]);

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
    this.stopped = true;
    this.releaseResources();
    this.setState("closed");
    this.callbacks.onTimeline("Session resources released");
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
      void this.audioElement.play().catch(() => {
        this.callbacks.onTimeline("Remote audio ready; playback needs interaction");
      });
      this.callbacks.onRemoteAudio(true);
      this.callbacks.onTimeline("Remote audio track attached");
    };

    this.channel.onopen = () => {
      if (!this.stopped) {
        this.setState("live");
        this.callbacks.onTimeline("Data channel oai-events open");
      }
    };

    this.channel.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as RealtimeServerEvent;
        if (typeof event.type === "string") {
          this.callbacks.onEvent(event);
          this.callbacks.onTimeline(`Received ${event.type}`);
        }
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

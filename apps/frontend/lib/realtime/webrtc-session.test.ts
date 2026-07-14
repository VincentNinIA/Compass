import { describe, expect, it, vi } from "vitest";

import {
  RealtimeSessionError,
  RealtimeWebRtcSession,
  type RealtimeConnectionState,
  type RealtimeServerEvent,
} from "./webrtc-session";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=audio 9 RTP/AVP 111\r\n";
const ANSWER = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\nm=audio 9 RTP/AVP 111\r\n";

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = "connecting";
  close = vi.fn(() => {
    this.readyState = "closed";
  });
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;

  open() {
    this.readyState = "open";
    this.onopen?.(new Event("open"));
  }

  message(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  unexpectedClose() {
    this.readyState = "closed";
    this.onclose?.(new Event("close"));
  }
}

class FakePeerConnection {
  readonly channel = new FakeDataChannel();
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  createDataChannel = vi.fn(() => this.channel as unknown as RTCDataChannel);
  addTrack = vi.fn();
  createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: OFFER }));
  setLocalDescription = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async () => undefined);
  close = vi.fn(() => {
    this.signalingState = "closed";
    this.connectionState = "closed";
  });
}

function createHarness(response = new Response(ANSWER, { status: 201 })) {
  const track = {
    readyState: "live" as MediaStreamTrackState,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: vi.fn(() => [track]),
  } as unknown as MediaStream;
  const peer = new FakePeerConnection();
  const audio = {
    srcObject: null,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
  } as unknown as HTMLAudioElement;
  const states: RealtimeConnectionState[] = [];
  const timeline: string[] = [];
  const events: RealtimeServerEvent[] = [];
  const onRemoteAudio = vi.fn();
  const failures: RealtimeSessionError[] = [];
  const fetchImpl = vi.fn(async () => response);
  const getUserMedia = vi.fn(async () => stream);

  const session = new RealtimeWebRtcSession(
    audio,
    {
      onState: (state) => states.push(state),
      onTimeline: (entry) => timeline.push(entry),
      onEvent: (event) => events.push(event),
      onRemoteAudio,
      onFailure: (failure) => failures.push(failure),
    },
    {
      mediaDevices: { getUserMedia },
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      fetchImpl: fetchImpl as typeof fetch,
    },
  );

  return {
    session,
    peer,
    track,
    stream,
    audio,
    states,
    timeline,
    events,
    onRemoteAudio,
    failures,
    fetchImpl,
    getUserMedia,
  };
}

describe("RealtimeWebRtcSession", () => {
  it("negotiates audio and oai-events, then cleans every resource once", async () => {
    const harness = createHarness();

    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify({ type: "session.created" }));

    expect(harness.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(harness.peer.createDataChannel).toHaveBeenCalledWith("oai-events");
    expect(harness.peer.addTrack).toHaveBeenCalledWith(harness.track, harness.stream);
    expect(harness.fetchImpl).toHaveBeenCalledWith(
      "/api/realtime/session",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: OFFER,
      }),
    );
    expect(harness.peer.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: ANSWER,
    });
    expect(harness.states).toEqual(["connecting", "live"]);
    expect(harness.events).toEqual([{ type: "session.created" }]);

    const remoteTrack = {} as MediaStreamTrack;
    const remoteStream = {} as MediaStream;
    harness.peer.ontrack?.({
      track: remoteTrack,
      streams: [remoteStream],
    } as unknown as RTCTrackEvent);
    expect(harness.audio.srcObject).toBe(remoteStream);
    expect(harness.audio.play).toHaveBeenCalledTimes(1);
    expect(harness.onRemoteAudio).toHaveBeenCalledWith(true);

    harness.session.stop();
    harness.session.stop();

    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.peer.channel.close).toHaveBeenCalledTimes(1);
    expect(harness.peer.close).toHaveBeenCalledTimes(1);
    expect(harness.audio.pause).toHaveBeenCalledTimes(1);
    expect(harness.audio.srcObject).toBeNull();
    expect(harness.onRemoteAudio).toHaveBeenLastCalledWith(false);
    expect(harness.states).toEqual(["connecting", "live", "closed"]);
  });

  it("releases acquired resources when the SDP route fails", async () => {
    const harness = createHarness(
      Response.json(
        {
          error: {
            code: "realtime_unconfigured",
            message: "Realtime is not configured on this server.",
          },
        },
        { status: 503 },
      ),
    );

    await expect(harness.session.start()).rejects.toEqual(
      expect.objectContaining<Partial<RealtimeSessionError>>({
        code: "realtime_unconfigured",
      }),
    );

    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.peer.channel.close).toHaveBeenCalledTimes(1);
    expect(harness.peer.close).toHaveBeenCalledTimes(1);
    expect(harness.onRemoteAudio).toHaveBeenCalledWith(false);
    expect(harness.states).toEqual(["connecting", "failed"]);
  });

  it("stops a microphone track that resolves after Stop", async () => {
    let resolvePermission!: (stream: MediaStream) => void;
    const permission = new Promise<MediaStream>((resolve) => {
      resolvePermission = resolve;
    });
    const harness = createHarness();
    harness.getUserMedia.mockReturnValueOnce(permission);

    const start = harness.session.start();
    harness.session.stop();
    resolvePermission(harness.stream);
    await start;

    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.peer.createDataChannel).not.toHaveBeenCalled();
    expect(harness.states).toEqual(["connecting", "closed"]);
  });

  it("settles cleanly when Stop occurs during SDP negotiation", async () => {
    let resolveFetch!: (response: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const harness = createHarness();
    harness.fetchImpl.mockReturnValueOnce(pendingFetch);

    const start = harness.session.start();
    await vi.waitFor(() => expect(harness.fetchImpl).toHaveBeenCalledTimes(1));
    harness.session.stop();
    resolveFetch(new Response(ANSWER, { status: 201 }));
    await start;

    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.peer.channel.close).toHaveBeenCalledTimes(1);
    expect(harness.peer.close).toHaveBeenCalledTimes(1);
    expect(harness.peer.setRemoteDescription).not.toHaveBeenCalled();
    expect(harness.states).toEqual(["connecting", "closed"]);
  });

  it("turns an unexpected data channel close into a retryable failed state", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();

    harness.peer.channel.unexpectedClose();

    expect(harness.states).toEqual(["connecting", "live", "failed"]);
    expect(harness.failures).toEqual([
      expect.objectContaining({ code: "data_channel_closed" }),
    ]);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.peer.close).toHaveBeenCalledTimes(1);
  });

  it("reports microphone refusal without allocating peer resources", async () => {
    const harness = createHarness();
    harness.getUserMedia.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    await expect(harness.session.start()).rejects.toMatchObject({
      name: "NotAllowedError",
    });

    expect(harness.peer.createDataChannel).not.toHaveBeenCalled();
    expect(harness.track.stop).not.toHaveBeenCalled();
    expect(harness.states).toEqual(["connecting", "failed"]);
  });
});

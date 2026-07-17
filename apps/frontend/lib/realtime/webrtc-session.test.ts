import { describe, expect, it, vi } from "vitest";

import {
  RealtimeSessionError,
  RealtimeWebRtcSession,
  type RealtimeConnectionState,
  type RealtimeInvarianceSummaryRuntime,
  type RealtimePedagogyRuntime,
  type RealtimeServerEvent,
} from "./webrtc-session";
import { ToolGateway, type ToolHandlers } from "@/lib/tools/gateway";
import type { ToolRuntime } from "@/lib/tools/runtime";
import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import {
  materializeDirective,
  queueDirective,
  toPendingIntervention,
  type InterventionDirective,
} from "@/lib/pedagogy/directive";
import {
  createFactSignature,
  deriveMissingRelationKeys,
} from "@/lib/pedagogy/meaningful-delta";
import type { PolicyDecision } from "@/lib/pedagogy/policy";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvent,
  type PedagogyState,
  type VerifiedFact,
} from "@/lib/pedagogy/state";
import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_POSITION_VERSION,
  INVARIANCE_SAMPLE_PARAMETERS,
  type InvarianceRunCompleted,
} from "@/lib/invariance/contracts";
import {
  INVARIANCE_GENERALIZATION_DIRECTIVE_VERSION,
  INVARIANCE_GENERALIZATION_GOAL,
  type InvarianceGeneralizationDirective,
  type InvarianceVerbalizationContext,
} from "@/lib/invariance/verbalization";
import { OperationArbiter } from "@/lib/operations/arbiter";
import { EvidenceLog } from "@/lib/pedagogy/evidence-log";
import { GEOGEBRA_ASSIST_TOOL_DEFINITIONS } from "@/lib/geogebra/assist-tools";
import { GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS } from "@/lib/geometry-investigation/actions";
import type { GeoGebraWorldStateV1 } from "@/lib/geogebra/mission-progress";
import { GeometryWorldV2 } from "@/lib/geometry-investigation/contracts";
import { GeometryRealtimePedagogyContextV1 } from "@/lib/geometry-investigation/learning-runtime";
import { createGeometryWorldDeltaV2 } from "@/lib/geometry-investigation/world";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=audio 9 RTP/AVP 111\r\n";
const ANSWER = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\nm=audio 9 RTP/AVP 111\r\n";
const DATA_OFFER =
  "v=0\r\no=- 3 2 IN IP4 127.0.0.1\r\nm=audio 0 RTP/AVP 111\r\na=inactive\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const DATA_ANSWER =
  "v=0\r\no=- 4 2 IN IP4 127.0.0.1\r\nm=audio 0 RTP/AVP 111\r\na=inactive\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

function geometryWorldV2(
  revision: number,
  changeKind: "initial" | "drag_end",
  x: number,
) {
  return GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId: "varignon_fr_v1",
    epoch: 1,
    revision,
    snapshotHash: `world-hash-${revision}`,
    objectCount: 1,
    truncated: false,
    objects: [
      {
        name: "E",
        type: "point",
        command: "Midpoint(A,B)",
        parents: ["A", "B"],
        dependencyStatus: "known",
        owner: "student",
        x,
        y: 0,
        visible: true,
      },
    ],
    facts: [],
    change: {
      kind: changeKind,
      objectNames: changeKind === "initial" ? [] : ["E"],
      terminal: true,
      actor: changeKind === "initial" ? "system" : "learner",
      occurredAt: revision,
    },
  });
}

const PROACTIVE_SPEAK: PolicyDecision = {
  type: "speak",
  reason: "repeated_block",
  directiveDraft: {
    kind: "proactive",
    sourceActionId: "action-1",
    sourceRequestId: null,
    helpLevel: 1,
    goal: "ask_reflective_question",
    allowedTools: [],
  },
};

function responseRequest(turnId: string, eventId = "voice-event-1") {
  return {
    type: "response.create",
    event_id: eventId,
    response: { metadata: { geotutor_turn_id: turnId } },
  };
}

function responseCreated(turnId: string, responseId: string) {
  return {
    type: "response.created",
    response: {
      id: responseId,
      metadata: { geotutor_turn_id: turnId },
    },
  };
}

function sessionProfileEvent(type: "session.created" | "session.updated") {
  return {
    type,
    session: {
      model: "gpt-realtime-2.1",
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            create_response: false,
            interrupt_response: true,
          },
        },
        output: { voice: "cedar" },
      },
      reasoning: { effort: "low" },
    },
  };
}

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = "connecting";
  close = vi.fn(() => {
    this.readyState = "closed";
  });
  send = vi.fn();
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
  addTransceiver = vi.fn();
  createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: OFFER }));
  setLocalDescription = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async () => undefined);
  close = vi.fn(() => {
    this.signalingState = "closed";
    this.connectionState = "closed";
  });
}

function createHarness(
  response = new Response(ANSWER, { status: 201 }),
  toolRuntime?: ToolRuntime,
  pedagogyRuntime?: RealtimePedagogyRuntime,
  invarianceSummaryRuntime?: RealtimeInvarianceSummaryRuntime,
  transportMode: "live_voice" | "typed_live" = "live_voice",
  operationArbiter?: OperationArbiter,
  evidenceLog?: EvidenceLog,
  tutorProfile:
    | "specialized_geometry"
    | "general_tutor"
    | "geogebra_tutor" = "specialized_geometry",
  exerciseContext?: {
    language: "en" | "fr" | "unknown";
    subject: "mathematics";
    title: string | null;
    statement: string;
    tasks: string[];
    concepts: string[];
  },
  geogebraWorldState?: GeoGebraWorldStateV1,
  geometryHarnessVersion?: "v1" | "v2",
) {
  const track = {
    readyState: "live" as MediaStreamTrackState,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: vi.fn(() => [track]),
  } as unknown as MediaStream;
  const peer = new FakePeerConnection();
  if (transportMode === "typed_live") {
    peer.createOffer.mockResolvedValue({ type: "offer", sdp: DATA_OFFER });
  }
  const audio = {
    srcObject: null,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
  } as unknown as HTMLAudioElement;
  const states: RealtimeConnectionState[] = [];
  const timeline: string[] = [];
  const events: RealtimeServerEvent[] = [];
  const sessionSummaries: unknown[] = [];
  const voiceTurns: unknown[] = [];
  const toolLoops: unknown[] = [];
  const onRemoteAudio = vi.fn();
  const failures: RealtimeSessionError[] = [];
  const textOutputs: string[] = [];
  const fetchImpl = vi.fn(async () => response);
  const getUserMedia = vi.fn(async () => stream);

  const session = new RealtimeWebRtcSession(
    audio,
    {
      onState: (state) => states.push(state),
      onTimeline: (entry) => timeline.push(entry),
      onEvent: (event) => events.push(event),
      onSessionSummary: (summary) => sessionSummaries.push(summary),
      onVoiceTurn: (turn) => voiceTurns.push(turn),
      onToolLoop: (result) => toolLoops.push(result),
      onRemoteAudio,
      onTextOutput: (text) => textOutputs.push(text),
      onFailure: (failure) => failures.push(failure),
    },
    {
      mediaDevices: { getUserMedia },
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      fetchImpl: fetchImpl as typeof fetch,
      toolRuntime,
      pedagogyRuntime,
      invarianceSummaryRuntime,
      transportMode,
      operationArbiter,
      evidenceLog,
      tutorProfile,
      exerciseContext,
      geogebraWorldState,
      geometryHarnessVersion,
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
    sessionSummaries,
    voiceTurns,
    toolLoops,
    onRemoteAudio,
    failures,
    textOutputs,
    fetchImpl,
    getUserMedia,
  };
}

describe("RealtimeWebRtcSession", () => {
  it("clears and rotates the evidence run when the session ends", () => {
    const log = new EvidenceLog({
      runId: "run-session",
      createRunId: () => "after-session",
    });
    log.append({ revision: 1, kind: "action", status: "accepted" });
    const harness = createHarness(
      undefined,
      undefined,
      undefined,
      undefined,
      "live_voice",
      undefined,
      log,
    );

    harness.session.stop();

    expect(log.exportDebug()).toMatchObject({
      runId: "run-after-session",
      dropped: 0,
      entries: [],
    });
  });

  it("negotiates audio and oai-events, then cleans every resource once", async () => {
    const harness = createHarness();

    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "cedar" },
          },
          reasoning: { effort: "low" },
          client_secret: { value: "must-not-escape" },
        },
      }),
    );

    expect(harness.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(harness.peer.createDataChannel).toHaveBeenCalledWith("oai-events");
    expect(harness.peer.addTrack).toHaveBeenCalledWith(harness.track, harness.stream);
    expect(harness.fetchImpl).toHaveBeenCalledWith(
      "/api/realtime/session",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
          "X-GeoTutor-Capability-Mode": "live_voice",
        },
        body: OFFER,
      }),
    );
    expect(harness.peer.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: ANSWER,
    });
    expect(harness.states).toEqual(["connecting", "live"]);
    expect(harness.events).toEqual([{ type: "session.created" }]);
    expect(harness.sessionSummaries).toEqual([
      {
        model: "gpt-realtime-2.1",
        voice: "cedar",
        reasoningEffort: "low",
        turnDetection: "server_vad",
        createResponse: false,
        interruptResponse: true,
      },
    ]);
    expect(JSON.stringify(harness.events)).not.toContain("must-not-escape");
    expect(JSON.stringify(harness.sessionSummaries)).not.toContain("must-not-escape");

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

  it("runs a verified typed_live request over the data channel without microphone or audio", async () => {
    const harness = createHarness(
      new Response(DATA_ANSWER, { status: 201 }),
      undefined,
      undefined,
      undefined,
      "typed_live",
    );

    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          reasoning: { effort: "low" },
          output_modalities: ["text"],
          tools: [],
          tool_choice: "none",
        },
      }),
    );

    expect(harness.getUserMedia).not.toHaveBeenCalled();
    expect(harness.peer.addTrack).not.toHaveBeenCalled();
    expect(harness.peer.addTransceiver).toHaveBeenCalledWith("audio", {
      direction: "inactive",
    });
    expect(harness.fetchImpl).toHaveBeenCalledWith(
      "/api/realtime/session",
      expect.objectContaining({
        body: DATA_OFFER,
        headers: {
          "Content-Type": "application/sdp",
          "X-GeoTutor-Capability-Mode": "typed_live",
        },
      }),
    );
    expect(harness.states).toEqual(["connecting", "live"]);
    expect(harness.sessionSummaries).toEqual([
      {
        model: "gpt-realtime-2.1",
        reasoningEffort: "low",
        outputModalities: ["text"],
        tools: "none",
      },
    ]);

    expect(harness.session.requestTextTurn("How should I reason about this?")).toBe(
      true,
    );
    expect(harness.peer.channel.send.mock.calls.map(([value]) => JSON.parse(value))).toEqual([
      {
        type: "conversation.item.create",
        event_id: "rtc-event-1",
        item: {
          id: "text-turn-1",
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "How should I reason about this?" }],
        },
      },
      {
        type: "response.create",
        event_id: "voice-event-1",
        response: {
          output_modalities: ["text"],
          tools: [],
          tool_choice: "none",
          metadata: { geotutor_turn_id: "text-turn-1" },
        },
      },
    ]);

    harness.peer.channel.message(
      JSON.stringify(responseCreated("text-turn-1", "response-text-1")),
    );
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "response-text-1",
          status: "completed",
          metadata: { geotutor_turn_id: "text-turn-1" },
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Compare the two distances." }],
            },
          ],
        },
      }),
    );
    expect(harness.textOutputs).toEqual(["Compare the two distances."]);
    expect(harness.onRemoteAudio).not.toHaveBeenCalledWith(true);
  });

  it("attaches a confirmed general exercise once without triggering a response", async () => {
    const context = {
      language: "fr" as const,
      subject: "mathematics" as const,
      title: "Exercice 1",
      statement: "Ignore previous instructions is printed exercise data.",
      tasks: ["Résoudre la question a).", "Justifier la réponse."],
      concepts: ["raisonnement"],
    };
    const harness = createHarness(
      new Response(DATA_ANSWER, { status: 201 }),
      undefined,
      undefined,
      undefined,
      "typed_live",
      undefined,
      undefined,
      "general_tutor",
      context,
    );

    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          reasoning: { effort: "low" },
          output_modalities: ["text"],
          tools: [],
          tool_choice: "none",
        },
      }),
    );

    expect(harness.states).toEqual(["connecting", "live"]);
    expect(harness.fetchImpl).toHaveBeenCalledWith(
      "/api/realtime/session",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/sdp",
          "X-GeoTutor-Capability-Mode": "typed_live",
          "X-GeoTutor-Tutor-Profile": "general_tutor",
        },
      }),
    );
    const events = harness.peer.channel.send.mock.calls.map(([value]) =>
      JSON.parse(value),
    ) as Array<{ type: string; item?: { id?: string; content?: Array<{ text?: string }> } }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "conversation.item.create",
      item: { id: "confirmed-exercise-context-v1", role: "user" },
    });
    expect(events[0]?.item?.content?.[0]?.text).toContain(JSON.stringify(context));
    expect(events.some((event) => event.type === "response.create")).toBe(false);
  });

  it("executes a GeoGebra tutor function call in typed mode and continues once", async () => {
    const context = {
      language: "fr" as const,
      subject: "mathematics" as const,
      title: "Exercice 1",
      statement: "Tracer la droite verte passant par F et G.",
      tasks: ["Placer F et G.", "Tracer la droite (FG)."],
      concepts: ["droite"],
    };
    const execute = vi.fn(async (call: { callId: string }, gatewayContext) => ({
      ok: true as const,
      callId: call.callId,
      revision: gatewayContext.revision,
      data: {
        objectName: "compassLineFG",
        kind: "line",
        points: ["F", "G"],
        color: "green",
      },
      evidenceIds: [],
    }));
    const harness = createHarness(
      new Response(DATA_ANSWER, { status: 201 }),
      {
        gateway: { execute },
        getContext: (turnId) => ({
          turnId,
          phase: "constructing",
          revision: 2,
        }),
      },
      undefined,
      undefined,
      "typed_live",
      undefined,
      undefined,
      "geogebra_tutor",
      context,
    );

    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          reasoning: { effort: "low" },
          output_modalities: ["text"],
          tools: GEOGEBRA_ASSIST_TOOL_DEFINITIONS,
          tool_choice: "auto",
        },
      }),
    );

    expect(harness.states).toEqual(["connecting", "live"]);
    expect(harness.fetchImpl).toHaveBeenCalledWith(
      "/api/realtime/session",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/sdp",
          "X-GeoTutor-Capability-Mode": "typed_live",
          "X-GeoTutor-Tutor-Profile": "geogebra_tutor",
        },
      }),
    );
    expect(harness.session.requestTextTurn("Trace la droite verte par F et G")).toBe(
      true,
    );
    harness.peer.channel.message(
      JSON.stringify(responseCreated("text-turn-1", "response-geogebra-1")),
    );
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "response-geogebra-1",
          status: "completed",
          metadata: { geotutor_turn_id: "text-turn-1" },
          output: [
            {
              type: "function_call",
              status: "completed",
              name: "draw_geogebra_line",
              call_id: "draw-line-1",
              arguments: '{"pointA":"F","pointB":"G","color":"green"}',
            },
          ],
        },
      }),
    );

    await vi.waitFor(() => expect(harness.toolLoops).toHaveLength(1));
    expect(execute).toHaveBeenCalledTimes(1);
    const sent = harness.peer.channel.send.mock.calls.map(([value]) =>
      JSON.parse(value),
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "conversation.item.create",
        item: expect.objectContaining({
          type: "function_call_output",
          call_id: "draw-line-1",
          output: expect.stringContaining("compassLineFG"),
        }),
      }),
    );
    expect(
      sent.filter(
        (event) =>
          event.type === "response.create" &&
          event.response?.metadata?.geotutor_turn_id === "text-turn-1",
      ),
    ).toHaveLength(2);
  });

  it.each([
    ["live_voice", ANSWER],
    ["typed_live", DATA_ANSWER],
  ] as const)(
    "verifies the negotiated investigation palette in %s mode",
    async (transportMode, answer) => {
      const exerciseContext = {
        language: "fr" as const,
        subject: "mathematics" as const,
        title: "Varignon",
        statement: "Explorer le quadrilatère des milieux.",
        tasks: ["Construire les milieux.", "Explorer trois configurations."],
        concepts: ["milieu", "parallélogramme"],
      };
      const harness = createHarness(
        new Response(answer, { status: 201 }),
        undefined,
        undefined,
        undefined,
        transportMode,
        undefined,
        undefined,
        "geogebra_tutor",
        exerciseContext,
        undefined,
        "v2",
      );

      await harness.session.start();
      harness.peer.channel.open();
      harness.peer.channel.message(
        JSON.stringify({
          type: "session.created",
          session: {
            model: "gpt-realtime-2.1",
            reasoning: { effort: "low" },
            ...(transportMode === "typed_live"
              ? { output_modalities: ["text"] }
              : {
                  audio: {
                    input: {
                      turn_detection: {
                        type: "server_vad",
                        create_response: false,
                        interrupt_response: true,
                      },
                    },
                    output: { voice: "cedar" },
                  },
                }),
            tools: GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS,
            tool_choice: "auto",
          },
        }),
      );

      expect(harness.states).toEqual(["connecting", "live"]);
      expect(harness.fetchImpl).toHaveBeenCalledWith(
        "/api/realtime/session",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/sdp",
            "X-GeoTutor-Capability-Mode": transportMode,
            "X-GeoTutor-Tutor-Profile": "geogebra_tutor",
            "X-GeoTutor-Geometry-Harness": "v2",
          },
        }),
      );
      expect(harness.sessionSummaries).toEqual([
        transportMode === "typed_live"
          ? {
              model: "gpt-realtime-2.1",
              reasoningEffort: "low",
              outputModalities: ["text"],
              tools: "geometry_investigation_v1",
            }
          : {
              model: "gpt-realtime-2.1",
              voice: "cedar",
              reasoningEffort: "low",
              turnDetection: "server_vad",
              createResponse: false,
              interruptResponse: true,
              tools: "geometry_investigation_v1",
            },
      ]);
    },
  );

  it("publishes a bounded GeoGebra snapshot and later delta without requesting a response", async () => {
    const context = {
      language: "fr" as const,
      subject: "mathematics" as const,
      title: "Exercice 1",
      statement: "Placer E, F et G.",
      tasks: ["Placer E, F et G."],
      concepts: ["point"],
    };
    const initial: GeoGebraWorldStateV1 = {
      schemaVersion: "geogebra_world.v1",
      revision: 0,
      objectCount: 0,
      truncated: false,
      objects: [],
      verifiedTaskIndexes: [],
      change: { type: "initial" },
    };
    const harness = createHarness(
      new Response(DATA_ANSWER, { status: 201 }),
      { gateway: { execute: vi.fn() }, getContext: () => undefined },
      undefined,
      undefined,
      "typed_live",
      undefined,
      undefined,
      "geogebra_tutor",
      context,
      initial,
    );

    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          reasoning: { effort: "low" },
          output_modalities: ["text"],
          tools: GEOGEBRA_ASSIST_TOOL_DEFINITIONS,
          tool_choice: "auto",
        },
      }),
    );

    harness.session.publishGeoGebraWorldState({
      ...initial,
      revision: 1,
      objectCount: 1,
      objects: [{ name: "E", type: "point", command: "E = (0,0)", x: 0, y: 0 }],
      verifiedTaskIndexes: [0],
      change: { type: "add", target: "E" },
    });

    const sent = harness.peer.channel.send.mock.calls.map(([value]) => JSON.parse(value));
    const observations = sent.filter(
      (event) =>
        event.type === "conversation.item.create" &&
        event.item?.id?.startsWith("geogebra-world-"),
    );
    expect(observations).toHaveLength(2);
    expect(observations[0].item.content[0].text).toContain('"kind":"snapshot"');
    expect(observations[1].item.content[0].text).toContain('"kind":"delta"');
    expect(observations[1].item.content[0].text).toContain('"verifiedTaskIndexes":[0]');
    expect(sent.some((event) => event.type === "response.create")).toBe(false);
  });

  it("publishes geometry_world.v2 as observation-only snapshot and delta", async () => {
    const harness = createHarness(
      new Response(DATA_ANSWER, { status: 201 }),
      { gateway: { execute: vi.fn() }, getContext: () => undefined },
      undefined,
      undefined,
      "typed_live",
      undefined,
      undefined,
      "geogebra_tutor",
      {
        language: "fr",
        subject: "mathematics",
        title: "Varignon",
        statement: "Construire les milieux.",
        tasks: ["Construire E, F, G et H."],
        concepts: ["milieu"],
      },
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          reasoning: { effort: "low" },
          output_modalities: ["text"],
          tools: GEOGEBRA_ASSIST_TOOL_DEFINITIONS,
          tool_choice: "auto",
        },
      }),
    );
    await vi.waitFor(() => expect(harness.states).toContain("live"));

    const initial = geometryWorldV2(0, "initial", 0);
    const initialPedagogy = GeometryRealtimePedagogyContextV1.parse({
      schemaVersion: "geometry_realtime_pedagogy_context.v1",
      activityId: initial.activityId,
      epoch: initial.epoch,
      revision: initial.revision,
      phase: "constructing",
      activeMissionId: "V1",
      attemptCount: 0,
      explicitHelpRequestCount: 0,
      missingEvidenceIds: ["rel_midpoint_e"],
      capturedConfigurations: [],
      maxHelpLevel: 3,
    });
    expect(
      harness.session.publishGeometryWorldV2(
        initial,
        createGeometryWorldDeltaV2(undefined, initial),
        initialPedagogy,
      ),
    ).toBe(true);
    const moved = geometryWorldV2(1, "drag_end", 2);
    const movedPedagogy = GeometryRealtimePedagogyContextV1.parse({
      ...initialPedagogy,
      revision: moved.revision,
      phase: "exploring",
      activeMissionId: "V3",
      attemptCount: 1,
      missingEvidenceIds: ["learner_capture_V3"],
    });
    expect(
      harness.session.publishGeometryWorldV2(
        moved,
        createGeometryWorldDeltaV2(initial, moved),
        movedPedagogy,
      ),
    ).toBe(true);

    const sent = harness.peer.channel.send.mock.calls.map(([value]) =>
      JSON.parse(value),
    );
    const observations = sent.filter(
      (event) =>
        event.type === "conversation.item.create" &&
        event.item?.id?.startsWith("geometry-world-v2-"),
    );
    expect(observations).toHaveLength(2);
    expect(observations[0].item.content[0].text).toContain('"kind":"snapshot"');
    expect(observations[0].item.content[0].text).toContain('"parents":["A","B"]');
    expect(observations[0].item.content[0].text).toContain(
      '"activeMissionId":"V1"',
    );
    expect(observations[1].item.content[0].text).toContain('"kind":"delta"');
    expect(observations[1].item.content[0].text).toContain('"kind":"drag_end"');
    expect(observations[1].item.content[0].text).toContain(
      '"missingEvidenceIds":["learner_capture_V3"]',
    );
    expect(sent.some((event) => event.type === "response.create")).toBe(false);
  });

  it("uses a pending geometry v2 observation as the confirmed tutor context", async () => {
    const harness = createHarness(
      new Response(DATA_ANSWER, { status: 201 }),
      { gateway: { execute: vi.fn() }, getContext: () => undefined },
      undefined,
      undefined,
      "typed_live",
      undefined,
      undefined,
      "geogebra_tutor",
      undefined,
      undefined,
      "v2",
    );
    const world = geometryWorldV2(0, "initial", 0);
    const pedagogy = GeometryRealtimePedagogyContextV1.parse({
      schemaVersion: "geometry_realtime_pedagogy_context.v1",
      activityId: world.activityId,
      epoch: world.epoch,
      revision: world.revision,
      phase: "constructing",
      activeMissionId: "V1",
      attemptCount: 0,
      explicitHelpRequestCount: 0,
      missingEvidenceIds: ["rel_midpoint_e"],
      capturedConfigurations: [],
      maxHelpLevel: 3,
    });
    expect(
      harness.session.publishGeometryWorldV2(
        world,
        createGeometryWorldDeltaV2(undefined, world),
        pedagogy,
      ),
    ).toBe(false);

    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          reasoning: { effort: "low" },
          output_modalities: ["text"],
          tools: GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS,
          tool_choice: "auto",
        },
      }),
    );
    await vi.waitFor(() => expect(harness.states).toContain("live"));
    expect(harness.failures).toEqual([]);
    const sent = harness.peer.channel.send.mock.calls.map(([value]) =>
      JSON.parse(value),
    );
    expect(
      sent.some(
        (event) =>
          event.type === "conversation.item.create" &&
          event.item?.id?.startsWith("geometry-world-v2-"),
      ),
    ).toBe(true);
    expect(
      sent.some((event) => event.item?.id === "confirmed-exercise-context-v1"),
    ).toBe(false);
  });

  it("does not become live until session.created matches the server profile", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();

    expect(harness.states).toEqual(["connecting"]);

    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "unexpected-model",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "cedar" },
          },
          reasoning: { effort: "low" },
        },
      }),
    );

    expect(harness.states).toEqual(["connecting", "failed"]);
    expect(harness.failures).toEqual([
      expect.objectContaining({ code: "unexpected_session_configuration" }),
    ]);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
  });

  it("reasserts create_response false and waits for a strictly matching session.updated", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();

    harness.peer.channel.message(
      JSON.stringify({
        ...sessionProfileEvent("session.created"),
        session: {
          ...sessionProfileEvent("session.created").session,
          audio: {
            ...sessionProfileEvent("session.created").session.audio,
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: true,
                interrupt_response: true,
              },
            },
          },
        },
      }),
    );

    expect(harness.states).toEqual(["connecting"]);
    expect(harness.peer.channel.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.peer.channel.send.mock.calls[0]![0])).toMatchObject({
      type: "session.update",
      session: {
        type: "realtime",
        reasoning: { effort: "low" },
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              create_response: false,
              interrupt_response: true,
            },
          },
        },
      },
    });

    harness.peer.channel.message(
      JSON.stringify(sessionProfileEvent("session.updated")),
    );
    expect(harness.states).toEqual(["connecting", "live"]);
    expect(harness.sessionSummaries).toEqual([
      {
        model: "gpt-realtime-2.1",
        voice: "cedar",
        reasoningEffort: "low",
        turnDetection: "server_vad",
        createResponse: false,
        interruptResponse: true,
      },
    ]);
  });

  it("fails closed when the reasserted session remains auto-responsive", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();
    const mismatched = {
      ...sessionProfileEvent("session.created"),
      session: {
        ...sessionProfileEvent("session.created").session,
        audio: {
          ...sessionProfileEvent("session.created").session.audio,
          input: {
            turn_detection: {
              type: "server_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    };
    harness.peer.channel.message(JSON.stringify(mismatched));
    harness.peer.channel.message(
      JSON.stringify({ ...mismatched, type: "session.updated" }),
    );

    expect(harness.states).toEqual(["connecting", "failed"]);
    expect(harness.failures).toEqual([
      expect.objectContaining({ code: "unexpected_session_configuration" }),
    ]);
  });

  it("verifies the locked VAD profile from session.updated", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();

    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.updated")));

    expect(harness.states).toEqual(["connecting", "live"]);
    expect(harness.events).toEqual([{ type: "session.updated" }]);
    expect(harness.sessionSummaries).toEqual([
      {
        model: "gpt-realtime-2.1",
        voice: "cedar",
        reasoningEffort: "low",
        turnDetection: "server_vad",
        createResponse: false,
        interruptResponse: true,
      },
    ]);
  });

  it("routes one response.create per committed voice turn through oai-events", async () => {
    const fixture = proactiveFixture();
    fixture.runtime.dispatch({
      type: "directive_invalidated",
      directiveId: fixture.directive.directiveId,
      ...pedagogyAnchor(fixture.state),
    });
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      undefined,
      fixture.runtime,
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "cedar" },
          },
          reasoning: { effort: "low" },
        },
      }),
    );

    harness.peer.channel.message(
      JSON.stringify({
        type: "input_audio_buffer.speech_started",
        event_id: "speech-started-explicit",
        item_id: "item-turn-1",
      }),
    );
    harness.peer.channel.message(
      JSON.stringify({
        type: "input_audio_buffer.speech_stopped",
        event_id: "speech-stopped-explicit",
        item_id: "item-turn-1",
      }),
    );
    const committed = JSON.stringify({
      type: "input_audio_buffer.committed",
      event_id: "committed-explicit",
      item_id: "item-turn-1",
    });
    harness.peer.channel.message(committed);
    harness.peer.channel.message(committed);

    expect(harness.peer.channel.send).toHaveBeenCalledTimes(1);
    expect(harness.peer.channel.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "response.create",
        event_id: "voice-event-1",
        response: {
          metadata: {
            geotutor_turn_id: "item-turn-1",
            geotutor_response_owner: "explicit:item-turn-1",
            geotutor_epoch: "3",
            geotutor_revision: "1",
            geotutor_snapshot_hash: "hash-1",
            geotutor_speech_event_id: "speech-stopped-explicit",
          },
        },
      }),
    );
    expect(harness.voiceTurns).toEqual([
      { turnId: "item-turn-1", state: "speaking" },
      { turnId: "item-turn-1", state: "committed" },
      { turnId: "item-turn-1", state: "requested" },
    ]);
  });

  it("runs the proactive item-ack-response path through the shared data channel", async () => {
    const fixture = proactiveFixture();
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      undefined,
      fixture.runtime,
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.updated")));

    expect(
      harness.session.requestProactive(PROACTIVE_SPEAK, fixture.directive),
    ).toBe("item_sent");
    let sent = harness.peer.channel.send.mock.calls.map(([event]) =>
      JSON.parse(event),
    );
    expect(sent.map(({ type }) => type)).toEqual([
      "conversation.item.create",
    ]);
    expect(sent[0]).toMatchObject({
      event_id: expect.any(String),
      item: {
        id: expect.any(String),
        content: [
          {
            type: "input_text",
            text: expect.stringContaining('"directiveId":"directive-webrtc"'),
          },
        ],
      },
    });

    harness.peer.channel.message(
      JSON.stringify({
        type: "conversation.item.created",
        item: { id: sent[0].item.id },
      }),
    );
    sent = harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event));
    expect(sent.map(({ type }) => type)).toEqual([
      "conversation.item.create",
      "response.create",
    ]);
    const metadata = sent[1].response.metadata;
    expect(metadata).toMatchObject({
      geotutor_response_owner: "proactive:directive-webrtc",
      geotutor_directive_id: "directive-webrtc",
      geotutor_response_event_id: sent[1].event_id,
    });

    harness.peer.channel.message(
      JSON.stringify({
        type: "response.created",
        response: { id: "response-proactive", metadata },
      }),
    );
    expect(fixture.state.activeResponse).toEqual({
      responseId: "response-proactive",
      directiveId: "directive-webrtc",
    });
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "response-proactive",
          status: "completed",
          metadata,
        },
      }),
    );

    expect(fixture.state.activeResponse).toBeNull();
    expect(
      sent.filter(({ type }) => type === "response.create"),
    ).toHaveLength(1);
  });

  it("routes a text-only invariance OOB response before voice ownership filters", async () => {
    const fixture = invarianceSummaryFixture();
    const renderSummary = vi.fn();
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      undefined,
      undefined,
      {
        getCurrentContext: () => fixture.context,
        renderSummary,
      },
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.updated")));

    const pending = harness.session.requestInvarianceSummary(
      fixture.result,
      fixture.directive,
    );
    const sent = harness.peer.channel.send.mock.calls.map(([event]) =>
      JSON.parse(event),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "response.create",
      event_id: "invariance-summary-1",
      response: {
        conversation: "none",
        output_modalities: ["text"],
        tools: [],
        metadata: {
          kind: "geotutor_invariance_summary_v1",
          runId: fixture.result.runId,
          revision: String(fixture.result.revision),
        },
      },
    });
    const metadata = sent[0].response.metadata;
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.created",
        response: { id: "response-invariance-oob", metadata },
      }),
    );
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "response-invariance-oob",
          status: "completed",
          conversation_id: null,
          output_modalities: ["text"],
          metadata,
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                { type: "output_text", text: "Five positions support the conjecture." },
              ],
            },
          ],
        },
      }),
    );

    expect(await pending).toMatchObject({
      status: "rendered",
      render: {
        source: "realtime",
        responseId: "response-invariance-oob",
        text: "Five positions support the conjecture.",
      },
    });
    expect(renderSummary).toHaveBeenCalledOnce();
    expect(
      harness.peer.channel.send.mock.calls
        .map(([event]) => JSON.parse(event))
        .filter(({ type }) => type === "response.cancel"),
    ).toEqual([]);
    expect(harness.audio.play).not.toHaveBeenCalled();
    expect(harness.timeline).not.toContain("Ignored unowned response.done");
    expect(harness.timeline).not.toContain(
      "Rejected unowned response response-invariance-oob",
    );
  });

  it("cancels a pending invariance OOB response and clears audio on global reset", async () => {
    const fixture = invarianceSummaryFixture();
    const renderSummary = vi.fn();
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      undefined,
      undefined,
      {
        getCurrentContext: () => fixture.context,
        renderSummary,
      },
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify(sessionProfileEvent("session.updated")),
    );
    const pending = harness.session.requestInvarianceSummary(
      fixture.result,
      fixture.directive,
    );
    const createdEvent = JSON.parse(
      harness.peer.channel.send.mock.calls[0][0],
    ) as { response: { metadata: Record<string, string> } };
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.created",
        response: {
          id: "response-invariance-reset",
          metadata: createdEvent.response.metadata,
        },
      }),
    );

    expect(harness.session.cancelForActivity("reset")).toBe(true);
    expect(await pending).toMatchObject({
      status: "ignored",
      reason: "cancelled",
    });
    expect(renderSummary).not.toHaveBeenCalled();
    expect(
      harness.peer.channel.send.mock.calls.map(([serialized]) =>
        JSON.parse(serialized),
      ),
    ).toEqual([
      expect.objectContaining({ type: "response.create" }),
      expect.objectContaining({
        type: "response.cancel",
        response_id: "response-invariance-reset",
      }),
      expect.objectContaining({ type: "output_audio_buffer.clear" }),
    ]);

    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "response-invariance-reset",
          status: "completed",
          conversation_id: null,
          output_modalities: ["text"],
          metadata: createdEvent.response.metadata,
          output: [],
        },
      }),
    );
    expect(renderSummary).not.toHaveBeenCalled();
    expect(harness.timeline).toContain("Ignored late response.done");
  });

  it("executes a completed tool batch, publishes its output, then continues once", async () => {
    const handlers: ToolHandlers = {
      read_construction: vi.fn(() => ({ data: { revision: 4 }, evidenceIds: ["snapshot-r4"] })),
      initialize_exercise: vi.fn(() => ({ data: {} })),
      check_relation: vi.fn(() => ({ data: {} })),
      highlight_objects: vi.fn(() => ({ data: {} })),
    };
    const harness = createHarness(new Response(ANSWER, { status: 201 }), {
      gateway: new ToolGateway(handlers),
      getContext: (turnId) => ({ turnId, phase: "constructing", revision: 4 }),
    });
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "cedar" },
          },
          reasoning: { effort: "low" },
        },
      }),
    );
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-tools" }),
    );
    harness.peer.channel.message(
      JSON.stringify(responseCreated("turn-tools", "resp-tools")),
    );
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "resp-tools",
          status: "completed",
          metadata: { geotutor_turn_id: "turn-tools" },
          output: [
            {
              type: "function_call",
              status: "completed",
              name: "read_construction",
              call_id: "call-read",
              arguments: '{"revision":4}',
            },
          ],
        },
      }),
    );

    await vi.waitFor(() => expect(harness.toolLoops).toHaveLength(1));
    expect(harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event))).toEqual([
      responseRequest("turn-tools"),
      expect.objectContaining({
        type: "conversation.item.create",
        item: expect.objectContaining({
          type: "function_call_output",
          call_id: "call-read",
          output: expect.stringContaining("snapshot-r4"),
        }),
      }),
      responseRequest("turn-tools", "voice-event-2"),
    ]);
    expect(handlers.read_construction).toHaveBeenCalledTimes(1);
    expect(harness.voiceTurns.at(-1)).toEqual({ turnId: "turn-tools", state: "requested" });
  });

  it("transfers reducer ownership from a tool response to its continuation", async () => {
    const fixture = proactiveFixture();
    fixture.runtime.dispatch({
      type: "directive_invalidated",
      directiveId: fixture.directive.directiveId,
      ...pedagogyAnchor(fixture.state),
    });
    const handlers: ToolHandlers = {
      read_construction: vi.fn(() => ({
        data: { revision: 1 },
        evidenceIds: ["snapshot-r1"],
      })),
      initialize_exercise: vi.fn(() => ({ data: {} })),
      check_relation: vi.fn(() => ({ data: {} })),
      highlight_objects: vi.fn(() => ({ data: {} })),
    };
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      {
        gateway: new ToolGateway(handlers),
        getContext: (turnId) => ({
          turnId,
          phase: "constructing",
          revision: fixture.state.revision,
        }),
      },
      fixture.runtime,
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.updated")));
    harness.peer.channel.message(
      JSON.stringify({
        type: "input_audio_buffer.speech_started",
        event_id: "speech-started-tools",
        item_id: "turn-tools-anchored",
      }),
    );
    harness.peer.channel.message(
      JSON.stringify({
        type: "input_audio_buffer.speech_stopped",
        event_id: "speech-stopped-tools",
        item_id: "turn-tools-anchored",
      }),
    );
    harness.peer.channel.message(
      JSON.stringify({
        type: "input_audio_buffer.committed",
        event_id: "committed-tools",
        item_id: "turn-tools-anchored",
      }),
    );
    const initialRequest = JSON.parse(
      harness.peer.channel.send.mock.calls[0][0],
    );
    const metadata = initialRequest.response.metadata;
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.created",
        response: { id: "response-tools-first", metadata },
      }),
    );
    expect(fixture.state.activeResponse?.responseId).toBe("response-tools-first");

    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "response-tools-first",
          status: "completed",
          metadata,
          output: [
            {
              type: "function_call",
              status: "completed",
              name: "read_construction",
              call_id: "call-tools-anchored",
              arguments: '{"revision":1}',
            },
          ],
        },
      }),
    );
    await vi.waitFor(() => expect(harness.toolLoops).toHaveLength(1));
    expect(fixture.state.activeResponse).toBeNull();
    const sent = harness.peer.channel.send.mock.calls.map(([event]) =>
      JSON.parse(event),
    );
    const continuation = sent.at(-1);
    expect(continuation).toMatchObject({
      type: "response.create",
      response: { metadata },
    });

    harness.peer.channel.message(
      JSON.stringify({
        type: "response.created",
        response: { id: "response-tools-final", metadata },
      }),
    );
    expect(fixture.state.activeResponse?.responseId).toBe("response-tools-final");
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "response-tools-final",
          status: "completed",
          metadata,
          output: [],
        },
      }),
    );

    expect(fixture.state.activeResponse).toBeNull();
    expect(
      fixture.state.rejectedTransitions.filter(
        ({ reason }) =>
          reason === "active_response_exists" || reason === "response_mismatch",
      ),
    ).toEqual([]);
  });

  it("cancels then clears once on barge-in, ignores late deltas and resumes later audio", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "cedar" },
          },
          reasoning: { effort: "low" },
        },
      }),
    );
    harness.peer.ontrack?.({
      track: {} as MediaStreamTrack,
      streams: [{} as MediaStream],
    } as unknown as RTCTrackEvent);
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-old" }),
    );
    harness.peer.channel.message(
      JSON.stringify(responseCreated("turn-old", "resp-old")),
    );

    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.speech_started", item_id: "turn-new" }),
    );
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.speech_started", item_id: "turn-new" }),
    );

    expect(harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event))).toEqual([
      responseRequest("turn-old"),
      { type: "response.cancel", response_id: "resp-old", event_id: "rtc-event-1" },
      { type: "output_audio_buffer.clear", event_id: "rtc-event-2" },
    ]);
    expect(harness.audio.pause).toHaveBeenCalledTimes(1);
    expect(harness.voiceTurns).toContainEqual({
      turnId: "turn-old",
      state: "cancelled",
      responseId: "resp-old",
    });
    expect(harness.voiceTurns.at(-1)).toEqual({ turnId: "turn-new", state: "speaking" });

    harness.peer.channel.message(
      JSON.stringify({
        type: "response.output_audio.delta",
        response_id: "resp-old",
        delta: "must-not-reach-consumers",
      }),
    );
    expect(harness.events).not.toContainEqual({ type: "response.output_audio.delta" });
    expect(harness.timeline).toContain("Ignored late response.output_audio.delta");

    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-new" }),
    );
    harness.peer.channel.message(
      JSON.stringify(responseCreated("turn-new", "resp-new")),
    );
    expect(harness.audio.play).toHaveBeenCalledTimes(2);
  });

  it("orders Stop cancellation before audio clear and releases resources idempotently", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "cedar" },
          },
          reasoning: { effort: "low" },
        },
      }),
    );
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-stop" }),
    );
    harness.peer.channel.message(
      JSON.stringify(responseCreated("turn-stop", "resp-stop")),
    );

    harness.session.stop();
    harness.session.stop();

    expect(harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event))).toEqual([
      responseRequest("turn-stop"),
      { type: "response.cancel", response_id: "resp-stop", event_id: "rtc-event-1" },
      { type: "output_audio_buffer.clear", event_id: "rtc-event-2" },
    ]);
    expect(harness.peer.channel.close).toHaveBeenCalledTimes(1);
    expect(harness.peer.close).toHaveBeenCalledTimes(1);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.states).toEqual(["connecting", "live", "closed"]);
  });

  it("routes an explicit text prompt through VoiceTurnManager exactly once", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.created")));

    expect(harness.session.requestTextTurn("  Explain the current figure.  ")).toBe(true);
    const sent = harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event));
    expect(sent).toEqual([
      {
        type: "conversation.item.create",
        event_id: "rtc-event-1",
        item: {
          id: "text-turn-1",
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Explain the current figure." }],
        },
      },
      responseRequest("text-turn-1"),
    ]);

    harness.peer.channel.message(
      JSON.stringify({
        type: "conversation.item.created",
        item: { id: "text-turn-1", type: "message", role: "user" },
      }),
    );
    expect(harness.peer.channel.send).toHaveBeenCalledTimes(2);
  });

  it.each(["response.cancel", "output_audio_buffer.clear"])(
    "releases every local resource when sending %s throws during Stop",
    async (failingEventType) => {
      const harness = createHarness();
      await harness.session.start();
      harness.peer.channel.open();
      harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.created")));
      harness.peer.channel.message(
        JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-stop-send" }),
      );
      harness.peer.channel.message(
        JSON.stringify(responseCreated("turn-stop-send", "resp-stop-send")),
      );
      harness.peer.channel.send.mockImplementation((serialized: string) => {
        if (JSON.parse(serialized).type === failingEventType) {
          throw new Error(`send failed for ${failingEventType}`);
        }
      });

      expect(() => harness.session.stop()).not.toThrow();

      const attemptedControlEvents = harness.peer.channel.send.mock.calls
        .map(([serialized]) => JSON.parse(serialized).type)
        .filter((type) =>
          ["response.cancel", "output_audio_buffer.clear"].includes(type),
        );
      expect(attemptedControlEvents).toEqual([
        "response.cancel",
        "output_audio_buffer.clear",
      ]);
      expect(harness.peer.channel.close).toHaveBeenCalledTimes(1);
      expect(harness.peer.close).toHaveBeenCalledTimes(1);
      expect(harness.track.stop).toHaveBeenCalledTimes(1);
      expect(harness.audio.pause).toHaveBeenCalled();
      expect(harness.audio.srcObject).toBeNull();
      expect(harness.onRemoteAudio).toHaveBeenLastCalledWith(false);
      expect(harness.states).toEqual(["connecting", "live", "closed"]);

      const eventCountAfterStop = harness.events.length;
      harness.peer.channel.message(
        JSON.stringify({
          type: "response.output_audio.delta",
          response_id: "resp-stop-send",
          delta: "late-audio",
        }),
      );
      expect(harness.events).toHaveLength(eventCountAfterStop);

      expect(() => harness.session.stop()).not.toThrow();
      expect(harness.peer.channel.close).toHaveBeenCalledTimes(1);
      expect(harness.peer.close).toHaveBeenCalledTimes(1);
      expect(harness.track.stop).toHaveBeenCalledTimes(1);
    },
  );

  it("stops idempotently when the data channel is already closed", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.created")));
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-closed" }),
    );
    harness.peer.channel.readyState = "closed";

    expect(() => harness.session.stop()).not.toThrow();
    expect(() => harness.session.stop()).not.toThrow();

    expect(harness.peer.channel.close).not.toHaveBeenCalled();
    expect(harness.peer.close).toHaveBeenCalledTimes(1);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.states).toEqual(["connecting", "live", "closed"]);
  });

  it("cancels a pending response before response.created and rejects its late identity", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "cedar" },
          },
          reasoning: { effort: "low" },
        },
      }),
    );
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-old" }),
    );

    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.speech_started", item_id: "turn-new" }),
    );
    expect(harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event))).toEqual([
      responseRequest("turn-old"),
      { type: "response.cancel", event_id: "rtc-event-1" },
      { type: "output_audio_buffer.clear", event_id: "rtc-event-2" },
    ]);
    expect(harness.voiceTurns).toContainEqual({ turnId: "turn-old", state: "cancelled" });
    expect(harness.voiceTurns.at(-1)).toEqual({ turnId: "turn-new", state: "speaking" });

    harness.peer.channel.message(
      JSON.stringify(responseCreated("turn-old", "resp-late")),
    );
    expect(harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event)).slice(-2)).toEqual([
      { type: "response.cancel", response_id: "resp-late", event_id: "rtc-event-3" },
      { type: "output_audio_buffer.clear", event_id: "rtc-event-4" },
    ]);
    expect(harness.events).not.toContainEqual({ type: "response.created" });
    expect(harness.timeline).toContain("Rejected unowned response resp-late");

    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-new" }),
    );
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "resp-stale-without-created",
          status: "completed",
          metadata: { geotutor_turn_id: "turn-old" },
          output: [
            {
              type: "function_call",
              status: "completed",
              name: "read_construction",
              call_id: "must-not-run",
              arguments: "{}",
            },
          ],
        },
      }),
    );
    expect(harness.timeline).toContain("Ignored unowned response.done");
    expect(harness.voiceTurns.at(-1)).toEqual({ turnId: "turn-new", state: "requested" });
  });

  it("cancels a tooling turn and drops its late gateway result on barge-in", async () => {
    let toolSignal: AbortSignal | undefined;
    const gateway = {
      execute: vi.fn(
        (_call, context: { signal?: AbortSignal }) =>
          new Promise<Awaited<ReturnType<ToolGateway["execute"]>>>((resolve) => {
            toolSignal = context.signal;
            context.signal?.addEventListener(
              "abort",
              () =>
                resolve({
                  ok: false,
                  callId: "call-late",
                  revision: 4,
                  error: { code: "cancelled", message: "cancelled" },
                  evidenceIds: [],
                }),
              { once: true },
            );
          }),
      ),
    } as unknown as ToolGateway;
    const harness = createHarness(new Response(ANSWER, { status: 201 }), {
      gateway,
      getContext: (turnId) => ({ turnId, phase: "constructing", revision: 4 }),
    });
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "cedar" },
          },
          reasoning: { effort: "low" },
        },
      }),
    );
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-tools" }),
    );
    harness.peer.channel.message(
      JSON.stringify(responseCreated("turn-tools", "resp-tools")),
    );
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.done",
        response: {
          id: "resp-tools",
          status: "completed",
          metadata: { geotutor_turn_id: "turn-tools" },
          output: [
            {
              type: "function_call",
              status: "completed",
              name: "read_construction",
              call_id: "call-late",
              arguments: '{"revision":4}',
            },
          ],
        },
      }),
    );
    await vi.waitFor(() => expect(gateway.execute).toHaveBeenCalledTimes(1));

    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.speech_started", item_id: "turn-new" }),
    );
    expect(toolSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(harness.toolLoops).toEqual([]));

    expect(harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event))).toEqual([
      responseRequest("turn-tools"),
      { type: "response.cancel", event_id: "rtc-event-1" },
      { type: "output_audio_buffer.clear", event_id: "rtc-event-2" },
    ]);
    expect(harness.voiceTurns).toContainEqual({
      turnId: "turn-tools",
      state: "cancelled",
      responseId: "resp-tools",
    });
    expect(harness.toolLoops).toEqual([]);
  });

  it("invalidates a queued intervention on drag before any response or audio starts", async () => {
    const fixture = proactiveFixture();
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      undefined,
      fixture.runtime,
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.updated")));

    expect(harness.session.cancelForActivity("student_drag")).toBe(true);
    expect(harness.session.cancelForActivity("student_drag")).toBe(false);
    expect(fixture.state.pendingIntervention).toBeNull();
    expect(fixture.state.activeResponse).toBeNull();
    expect(harness.peer.channel.send).not.toHaveBeenCalled();
    expect(harness.audio.play).not.toHaveBeenCalled();
  });

  it("invalidates a queued intervention when student speech starts", async () => {
    const fixture = proactiveFixture();
    const cancelLocalEffects = vi.fn(() => false);
    fixture.runtime.cancelLocalEffects = cancelLocalEffects;
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      undefined,
      fixture.runtime,
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.updated")));

    harness.peer.channel.message(
      JSON.stringify({
        type: "input_audio_buffer.speech_started",
        event_id: "speech-pending",
        item_id: "student-turn",
      }),
    );

    expect(cancelLocalEffects).toHaveBeenCalledWith("student_speech");
    expect(fixture.state.pendingIntervention).toBeNull();
    expect(fixture.state.interaction.studentIsSpeaking).toBe(true);
    expect(harness.peer.channel.send).not.toHaveBeenCalled();
  });

  it("gives student speech authority over an active action until speech stops", async () => {
    const fixture = proactiveFixture();
    const arbiter = new OperationArbiter();
    const action = arbiter.begin({
      kind: "student_action",
      epoch: fixture.state.epoch,
      revision: fixture.state.revision,
    });
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      undefined,
      fixture.runtime,
      undefined,
      "live_voice",
      arbiter,
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(
      JSON.stringify(sessionProfileEvent("session.updated")),
    );

    harness.peer.channel.message(
      JSON.stringify({
        type: "input_audio_buffer.speech_started",
        item_id: "student-authority",
      }),
    );
    expect(action.token.abort.aborted).toBe(true);
    expect(arbiter.snapshot().pending.map(({ kind }) => kind)).toEqual([
      "student_speech",
    ]);
    expect(fixture.state.interaction.studentIsSpeaking).toBe(true);

    harness.peer.channel.message(
      JSON.stringify({
        type: "input_audio_buffer.speech_stopped",
        item_id: "student-authority",
      }),
    );
    expect(fixture.state.interaction.studentIsSpeaking).toBe(false);
    expect(arbiter.hasPending()).toBe(false);
    expect(arbiter.snapshot().trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "student_action",
          event: "preempted",
          reason: "preempted_by_student_speech",
        }),
        expect.objectContaining({
          kind: "student_speech",
          event: "completed",
        }),
      ]),
    );
  });

  it("rejects a proactive response created after its anchored revision changed", async () => {
    const fixture = proactiveFixture();
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      undefined,
      fixture.runtime,
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.updated")));
    expect(harness.session.requestProactive(PROACTIVE_SPEAK, fixture.directive)).toBe("item_sent");
    let sent = harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event));
    harness.peer.channel.message(
      JSON.stringify({
        type: "conversation.item.created",
        item: { id: sent[0].item.id },
      }),
    );
    sent = harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event));
    const metadata = sent[1].response.metadata;
    const newer = proactiveActionEvent(fixture.state);
    fixture.runtime.dispatch({ ...newer, actionId: "action-2" });

    harness.peer.channel.message(
      JSON.stringify({
        type: "response.created",
        response: { id: "response-stale", metadata },
      }),
    );

    expect(fixture.state.revision).toBe(2);
    expect(fixture.state.activeResponse).toBeNull();
    expect(harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event)).slice(-2)).toEqual([
      expect.objectContaining({ type: "response.cancel", response_id: "response-stale" }),
      expect.objectContaining({ type: "output_audio_buffer.clear" }),
    ]);
    expect(harness.events).not.toContainEqual({ type: "response.created" });
    const cancellationEvents = harness.peer.channel.send.mock.calls
      .map(([event]) => JSON.parse(event))
      .filter(({ type }) =>
        type === "response.cancel" || type === "output_audio_buffer.clear"
      );
    expect(cancellationEvents).toHaveLength(2);
  });

  it("marks a cancelled proactive identity so its late audio delta is ignored", async () => {
    const fixture = proactiveFixture();
    const harness = createHarness(
      new Response(ANSWER, { status: 201 }),
      undefined,
      fixture.runtime,
    );
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.updated")));
    expect(harness.session.requestProactive(PROACTIVE_SPEAK, fixture.directive)).toBe("item_sent");
    let sent = harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event));
    harness.peer.channel.message(
      JSON.stringify({
        type: "conversation.item.created",
        item: { id: sent[0].item.id },
      }),
    );
    sent = harness.peer.channel.send.mock.calls.map(([event]) => JSON.parse(event));
    const metadata = sent[1].response.metadata;
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.created",
        response: { id: "response-proactive-cancel", metadata },
      }),
    );

    expect(harness.session.cancelForActivity("student_drag")).toBe(true);
    harness.peer.channel.message(
      JSON.stringify({
        type: "response.output_audio.delta",
        response_id: "response-proactive-cancel",
        delta: "late-audio",
      }),
    );

    expect(harness.events).not.toContainEqual({
      type: "response.output_audio.delta",
    });
    expect(harness.timeline).toContain(
      "Ignored late response.output_audio.delta",
    );
  });

  it("cuts local audio and blocks new sends when output clear throws until ack", async () => {
    const harness = createHarness();
    await harness.session.start();
    harness.peer.channel.open();
    harness.peer.channel.message(JSON.stringify(sessionProfileEvent("session.updated")));
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-clear" }),
    );
    harness.peer.channel.message(
      JSON.stringify(responseCreated("turn-clear", "response-clear")),
    );
    harness.peer.channel.send.mockImplementation((serialized: string) => {
      const event = JSON.parse(serialized) as { type: string };
      if (event.type === "output_audio_buffer.clear") {
        throw new Error("data channel write failed");
      }
    });

    expect(harness.session.cancelForActivity("student_drag")).toBe(false);
    expect(harness.session.isSendBlocked()).toBe(true);
    expect(harness.audio.pause).toHaveBeenCalledTimes(1);
    const callsAfterFailure = harness.peer.channel.send.mock.calls.length;
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-blocked" }),
    );
    expect(harness.peer.channel.send).toHaveBeenCalledTimes(callsAfterFailure);
    expect(harness.timeline).toContain(
      "Blocked response.create until Realtime is coherent",
    );

    harness.peer.channel.message(
      JSON.stringify({ type: "output_audio_buffer.cleared" }),
    );
    expect(harness.session.isSendBlocked()).toBe(false);
    harness.peer.channel.message(
      JSON.stringify({ type: "input_audio_buffer.committed", item_id: "turn-recovered" }),
    );
    expect(
      harness.peer.channel.send.mock.calls
        .map(([event]) => JSON.parse(event))
        .filter(({ type }) => type === "response.create"),
    ).toHaveLength(2);
  });

  it("releases acquired resources when the SDP route fails", async () => {
    const harness = createHarness(
      Response.json(
        {
          error: {
            domain: "realtime_session",
            code: "realtime_unconfigured",
            retryable: false,
            userMessage: "Realtime is not configured on this server.",
            correlationId: "realtime_session_test",
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
    harness.peer.channel.message(
      JSON.stringify({
        type: "session.created",
        session: {
          model: "gpt-realtime-2.1",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: "cedar" },
          },
          reasoning: { effort: "low" },
        },
      }),
    );

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

function invarianceSummaryFixture(): {
  result: InvarianceRunCompleted;
  directive: InvarianceGeneralizationDirective;
  context: InvarianceVerbalizationContext;
} {
  const plan = deriveExercisePlanV1({
    schemaVersion: "exercise_extraction.v1",
    outcome: "ready",
    language: "en",
    instruction: "Construct the perpendicular bisector of AB.",
    pointLabels: ["A", "B"],
    segmentEndpoints: ["A", "B"],
    requestedConstruction: "perpendicular_bisector",
    learningObjective: "perpendicular_bisector_equidistance",
    ambiguityCode: null,
    clarificationQuestion: null,
    unsupportedReason: null,
  });
  const revision = 5;
  let state = createInitialPedagogyState(plan, { epoch: 3 });
  const facts: VerifiedFact[] = (
    ["perpendicular", "passes_midpoint"] as const
  ).map((relationKey) => ({
    relationKey,
    status: "verified",
    evidenceId: `evidence-${revision}-${relationKey}`,
  }));
  state = pedagogyReducer(state, {
    type: "validated_action_committed",
    epoch: state.epoch,
    exerciseId: state.exerciseId,
    stepId: state.stepId,
    actionId: "action-invariance",
    revision,
    snapshotHash: "hash-invariance",
    facts,
    evidence: facts.map((fact) => ({
      id: fact.evidenceId,
      relation: fact.relationKey,
      pass: true,
      observed: 0,
      tolerance: INVARIANCE_DISTANCE_TOLERANCE,
      revision,
      objects:
        fact.relationKey === "perpendicular"
          ? ["d", "AB"]
          : ["d", "A", "B"],
      snapshotHash: "hash-invariance",
    })),
    meaningfulDelta: {
      isMeaningful: true,
      constructionChanged: true,
      factsChanged: true,
      changedStudentObjects: ["d"],
      previousFactSignature: "",
      currentFactSignature:
        "passes_midpoint:verified|perpendicular:verified",
      missingRelationKeys: [],
      reason: "construction_and_facts_changed",
    },
  });
  state = pedagogyReducer(state, {
    type: "policy_evaluated",
    decision: "SPEAK",
    sourceActionId: "action-invariance",
    sourceRequestId: null,
    ...pedagogyAnchor(state),
  });
  const samples = INVARIANCE_SAMPLE_PARAMETERS.map((parameter, index) => ({
    id: `invariance-webrtc-${index}`,
    index: index as 0 | 1 | 2 | 3 | 4,
    parameter,
    coords: [parameter, 0] as const,
    pa: index + 2,
    pb: index + 2,
    delta: 0,
    tolerance: INVARIANCE_DISTANCE_TOLERANCE,
    toleranceVersion: INVARIANCE_DISTANCE_TOLERANCE_VERSION,
    positionVersion: INVARIANCE_POSITION_VERSION,
    pass: true,
    revision,
  })) as unknown as InvarianceRunCompleted["samples"];
  const result: InvarianceRunCompleted = {
    status: "completed",
    runId: "run-webrtc",
    revision,
    inputEvidenceIds: [
      `evidence-${revision}-perpendicular`,
      `evidence-${revision}-passes_midpoint`,
    ],
    samples,
    pass: true,
    evidenceIds: samples.map(({ id }) => id) as unknown as InvarianceRunCompleted["evidenceIds"],
  };
  const context: InvarianceVerbalizationContext = {
    state,
    currentRunId: result.runId,
    currentRevision: result.revision,
    inputEvidenceIds: result.inputEvidenceIds as readonly [string, string],
    evidenceIds: result.evidenceIds,
  };
  const directive: InvarianceGeneralizationDirective = {
    schemaVersion: INVARIANCE_GENERALIZATION_DIRECTIVE_VERSION,
    directiveId: "directive-invariance-webrtc",
    kind: "completion",
    epoch: state.epoch,
    exerciseId: state.exerciseId,
    stepId: state.stepId,
    baseRevision: revision,
    snapshotHash: state.studentSnapshotHash,
    sourceActionId: "action-invariance",
    sourceRunId: result.runId,
    inputEvidenceIds: result.inputEvidenceIds as readonly [string, string],
    evidenceIds: result.evidenceIds,
    helpLevel: 1,
    goal: INVARIANCE_GENERALIZATION_GOAL,
    allowedTools: [],
    status: "draft",
  };
  return { result, directive, context };
}

function proactiveFixture(): {
  runtime: RealtimePedagogyRuntime;
  directive: InterventionDirective;
  readonly state: PedagogyState;
} {
  const plan = deriveExercisePlanV1({
    schemaVersion: "exercise_extraction.v1",
    outcome: "ready",
    language: "en",
    instruction: "Construct the perpendicular bisector of AB.",
    pointLabels: ["A", "B"],
    segmentEndpoints: ["A", "B"],
    requestedConstruction: "perpendicular_bisector",
    learningObjective: "perpendicular_bisector_equidistance",
    ambiguityCode: null,
    clarificationQuestion: null,
    unsupportedReason: null,
  });
  let state = createInitialPedagogyState(plan, { epoch: 3 });
  state = pedagogyReducer(state, proactiveActionEvent(state));
  const draft =
    PROACTIVE_SPEAK.type === "speak"
      ? PROACTIVE_SPEAK.directiveDraft
      : unreachablePolicyFixture();
  const materialized = materializeDirective(
    state,
    draft,
    () => "directive-webrtc",
  );
  if (!materialized) throw new Error("Directive fixture failed.");
  const queued = queueDirective(materialized);
  if (!queued.ok) throw new Error(queued.reason);
  const directive = queued.directive;
  state = pedagogyReducer(state, {
    type: "directive_queued",
    intervention: toPendingIntervention(directive),
    ...pedagogyAnchor(state),
  });
  return {
    get state() {
      return state;
    },
    directive,
    runtime: {
      getState: () => state,
      dispatch: (event) => {
        state = pedagogyReducer(state, event);
        return state;
      },
    },
  };
}

function proactiveActionEvent(
  state: PedagogyState,
): Extract<PedagogyEvent, { type: "validated_action_committed" }> {
  const revision = state.revision + 1;
  const snapshotHash = `hash-${revision}`;
  const facts: VerifiedFact[] = [
    {
      relationKey: "perpendicular",
      status: "verified",
      evidenceId: `evidence-${revision}-perpendicular`,
    },
    {
      relationKey: "passes_midpoint",
      status: "missing",
      evidenceId: `evidence-${revision}-passes_midpoint`,
    },
  ];
  const previousFactSignature = createFactSignature(state.verifiedFacts);
  const currentFactSignature = createFactSignature(facts);
  return {
    type: "validated_action_committed",
    epoch: state.epoch,
    exerciseId: state.exerciseId,
    stepId: state.stepId,
    actionId: "action-1",
    revision,
    snapshotHash,
    facts,
    evidence: facts.map((fact) => ({
      id: fact.evidenceId,
      relation: fact.relationKey,
      pass: fact.status === "verified",
      observed: fact.status === "verified" ? 0 : 1,
      tolerance: 0.000001,
      revision,
      objects: ["d", "AB"],
      snapshotHash,
    })),
    meaningfulDelta: {
      isMeaningful: true,
      constructionChanged: true,
      factsChanged: previousFactSignature !== currentFactSignature,
      changedStudentObjects: ["d"],
      previousFactSignature,
      currentFactSignature,
      missingRelationKeys: deriveMissingRelationKeys(facts),
      reason: "construction_and_facts_changed",
    },
  };
}

function pedagogyAnchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

function unreachablePolicyFixture(): never {
  throw new Error("Unreachable policy fixture.");
}

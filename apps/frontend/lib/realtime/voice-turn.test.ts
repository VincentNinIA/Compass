import { describe, expect, it, vi } from "vitest";

import { VoiceTurnManager, type VoiceTurn } from "./voice-turn";

function harness(sendResult = true) {
  const sent: unknown[] = [];
  const turns: VoiceTurn[] = [];
  const send = vi.fn((event: unknown) => {
    sent.push(event);
    return sendResult;
  });
  const manager = new VoiceTurnManager({ send, onTurn: (turn) => turns.push(turn) });
  return { manager, send, sent, turns };
}

function request(turnId: string, eventId = "voice-event-1") {
  return {
    type: "response.create",
    event_id: eventId,
    response: { metadata: { geotutor_turn_id: turnId } },
  };
}

function created(turnId: string, responseId: string) {
  return {
    type: "response.created",
    response: {
      id: responseId,
      metadata: { geotutor_turn_id: turnId },
    },
  };
}

describe("VoiceTurnManager", () => {
  it("anchors the explicit request to speech_stopped and verifies echoed metadata", () => {
    const sent: unknown[] = [];
    const turns: VoiceTurn[] = [];
    const manager = new VoiceTurnManager({
      send: (event) => {
        sent.push(event);
        return true;
      },
      onTurn: (turn) => turns.push(turn),
      createExplicitRequest: (turnId, speechEventId) =>
        speechEventId
          ? {
              turnId,
              epoch: 4,
              revision: 7,
              snapshotHash: "hash-r7",
              speechEventId,
            }
          : undefined,
    });
    manager.handle({
      type: "input_audio_buffer.speech_started",
      event_id: "speech-started-1",
      item_id: "turn-anchored",
    });
    manager.handle({
      type: "input_audio_buffer.speech_stopped",
      event_id: "speech-stopped-1",
      item_id: "turn-anchored",
    });
    manager.handle({
      type: "input_audio_buffer.committed",
      event_id: "committed-1",
      item_id: "turn-anchored",
    });

    const metadata = {
      geotutor_turn_id: "turn-anchored",
      geotutor_response_owner: "explicit:turn-anchored",
      geotutor_epoch: "4",
      geotutor_revision: "7",
      geotutor_snapshot_hash: "hash-r7",
      geotutor_speech_event_id: "speech-stopped-1",
    };
    expect(sent).toEqual([
      {
        type: "response.create",
        event_id: "voice-event-1",
        response: { metadata },
      },
    ]);

    manager.handle({
      type: "response.created",
      response: {
        id: "response-wrong",
        metadata: { ...metadata, geotutor_revision: "6" },
      },
    });
    expect(manager.currentResponseId()).toBeUndefined();
    manager.handle({
      type: "response.created",
      response: { id: "response-right", metadata },
    });
    expect(manager.currentResponseId()).toBe("response-right");
    expect(turns.at(-1)).toEqual({
      turnId: "turn-anchored",
      state: "responding",
      responseId: "response-right",
    });
  });

  it("fails closed when an anchored explicit turn has no speech_stopped event id", () => {
    const send = vi.fn(() => true);
    const manager = new VoiceTurnManager({
      send,
      onTurn: vi.fn(),
      createExplicitRequest: (turnId, speechEventId) =>
        speechEventId
          ? {
              turnId,
              epoch: 1,
              revision: 1,
              snapshotHash: "hash-1",
              speechEventId,
            }
          : undefined,
    });

    manager.handle({
      type: "input_audio_buffer.committed",
      item_id: "turn-without-stop",
    });

    expect(send).not.toHaveBeenCalled();
    expect(manager.snapshot()).toEqual([
      { turnId: "turn-without-stop", state: "failed" },
    ]);
  });

  it("emits exactly one response.create for duplicated and reordered turn events", () => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle({ type: "input_audio_buffer.speech_started", item_id: "turn-1" });
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle({ type: "conversation.item.created", item_id: "turn-1" });
    expect(test.sent).toEqual([request("turn-1")]);
    expect(test.manager.snapshot()).toEqual([{ turnId: "turn-1", state: "requested" }]);
  });

  it("never infers a voice turn from an added or created user item", () => {
    const test = harness();
    const event = {
      type: "conversation.item.added",
      item: { id: "text-turn", type: "message", role: "user" },
    };
    test.manager.handle(event);
    test.manager.handle(event);
    test.manager.handle({ ...event, type: "conversation.item.created" });
    expect(test.sent).toEqual([]);
    expect(test.manager.snapshot()).toEqual([]);
  });

  it("accepts text only through the explicit text-turn API", () => {
    const test = harness();

    expect(test.manager.requestTextTurn("text-turn", "text-event-1")).toBe(true);
    test.manager.handle({
      type: "conversation.item.created",
      item: { id: "text-turn", type: "message", role: "user" },
    });
    expect(test.manager.requestTextTurn("text-turn", "text-event-2")).toBe(false);

    expect(test.sent).toEqual([request("text-turn")]);
    expect(test.manager.snapshot()).toEqual([
      { turnId: "text-turn", state: "requested" },
    ]);

    const rejected = harness();
    expect(
      rejected.manager.requestTextTurn(
        "rejected-text-turn",
        "text-event-3",
        () => false,
      ),
    ).toBe(false);
    expect(rejected.sent).toEqual([]);
    expect(rejected.manager.snapshot()).toEqual([
      { turnId: "rejected-text-turn", state: "failed" },
    ]);
  });

  it("drops a stale anchored coach turn queued behind the active response", () => {
    const sent: unknown[] = [];
    const turns: VoiceTurn[] = [];
    let currentRevision = 1;
    const manager = new VoiceTurnManager({
      send: (event) => {
        sent.push(event);
        return true;
      },
      onTurn: (turn) => turns.push(turn),
      isRequestCurrent: (candidate) =>
        candidate.activityId === "varignon_fr_v1" &&
        candidate.revision === currentRevision,
    });
    manager.handle({
      type: "input_audio_buffer.committed",
      item_id: "learner-turn",
    });
    manager.handle(created("learner-turn", "learner-response"));

    expect(
      manager.requestTextTurn(
        "coach-r1",
        "coach-event-r1",
        () => true,
        {
          activityId: "varignon_fr_v1",
          epoch: 1,
          revision: 1,
          snapshotHash: "world-hash-1",
        },
      ),
    ).toBe(true);
    currentRevision = 2;
    manager.handle({
      type: "response.done",
      response: {
        id: "learner-response",
        status: "completed",
        metadata: { geotutor_turn_id: "learner-turn" },
      },
    });

    expect(sent).toEqual([request("learner-turn")]);
    expect(turns).toContainEqual({ turnId: "coach-r1", state: "cancelled" });

    expect(
      manager.requestTextTurn(
        "coach-r2",
        "coach-event-r2",
        () => true,
        {
          activityId: "varignon_fr_v1",
          epoch: 1,
          revision: 2,
          snapshotHash: "world-hash-2",
        },
      ),
    ).toBe(true);
    expect(sent.at(-1)).toEqual({
      type: "response.create",
      event_id: "voice-event-2",
      response: {
        metadata: {
          geotutor_turn_id: "coach-r2",
          geotutor_response_owner: "explicit:coach-r2",
          geotutor_activity_id: "varignon_fr_v1",
          geotutor_epoch: "1",
          geotutor_revision: "2",
          geotutor_snapshot_hash: "world-hash-2",
          geotutor_speech_event_id: "coach-event-r2",
        },
      },
    });
  });

  it("locks a second committed turn until the active response is terminal", () => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle(created("turn-1", "resp-1"));
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-2" });
    expect(test.send).toHaveBeenCalledTimes(1);
    test.manager.handle({ type: "response.done", response: { id: "other", status: "completed", metadata: { geotutor_turn_id: "turn-1" } } });
    expect(test.send).toHaveBeenCalledTimes(1);
    test.manager.handle({ type: "response.done", response: { id: "resp-1", status: "completed", metadata: { geotutor_turn_id: "turn-1" } } });
    expect(test.send).toHaveBeenCalledTimes(2);
    expect(test.manager.snapshot()).toEqual([
      { turnId: "turn-1", state: "completed", responseId: "resp-1" },
      { turnId: "turn-2", state: "requested" },
    ]);
  });

  it("keeps a function-call response in the same turn until continuation", () => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle(created("turn-1", "resp-tools"));
    test.manager.handle({
      type: "response.done",
      response: {
        id: "resp-tools",
        status: "completed",
        metadata: { geotutor_turn_id: "turn-1" },
        output: [{ type: "function_call", status: "completed" }],
      },
    });
    expect(test.manager.snapshot()).toEqual([
      { turnId: "turn-1", state: "tooling", responseId: "resp-tools" },
    ]);
    expect(test.manager.continueAfterTools()).toBe(true);
    expect(test.sent).toEqual([
      request("turn-1"),
      request("turn-1", "voice-event-2"),
    ]);
    expect(test.manager.snapshot()).toEqual([{ turnId: "turn-1", state: "requested" }]);
  });

  it("does not attach a response whose turn metadata is stale", () => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-new" });

    test.manager.handle(created("turn-old", "resp-old"));
    test.manager.handle({
      type: "response.done",
      response: {
        id: "resp-old",
        status: "completed",
        metadata: { geotutor_turn_id: "turn-old" },
      },
    });

    expect(test.manager.currentResponseId()).toBeUndefined();
    expect(test.manager.snapshot()).toEqual([
      { turnId: "turn-new", state: "requested" },
    ]);
  });

  it("fails the tooling turn if its centralized continuation cannot be sent", () => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle(created("turn-1", "resp-tools"));
    test.manager.handle({
      type: "response.done",
      response: {
        id: "resp-tools",
        status: "completed",
        metadata: { geotutor_turn_id: "turn-1" },
        output: [{ type: "function_call", status: "completed" }],
      },
    });
    test.send.mockReturnValueOnce(false);

    expect(test.manager.continueAfterTools()).toBe(false);
    expect(test.manager.currentTurnId()).toBeUndefined();
    expect(test.manager.snapshot()).toEqual([
      { turnId: "turn-1", state: "failed", responseId: "resp-tools" },
    ]);
  });

  it.each(["cancelled", "failed", "incomplete"])("handles terminal status %s", (status) => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle({ type: "response.done", response: { id: "resp-1", status, metadata: { geotutor_turn_id: "turn-1" } } });
    expect(test.manager.snapshot()[0]?.state).toBe(status === "cancelled" ? "cancelled" : "failed");
  });

  it.each(["failed", "incomplete"])(
    "never enters tooling for a %s response containing a function call",
    (status) => {
      const test = harness();
      test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
      test.manager.handle(created("turn-1", "resp-1"));
      test.manager.handle({
        type: "response.done",
        response: {
          id: "resp-1",
          status,
          metadata: { geotutor_turn_id: "turn-1" },
          output: [{ type: "function_call", status: "completed" }],
        },
      });

      expect(test.manager.snapshot()).toEqual([
        { turnId: "turn-1", state: "failed", responseId: "resp-1" },
      ]);
      expect(test.manager.currentTurnId()).toBeUndefined();
    },
  );

  it("starts the queued turn after a failed function-call response", () => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle(created("turn-1", "resp-1"));
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-2" });
    test.manager.handle({
      type: "response.done",
      response: {
        id: "resp-1",
        status: "failed",
        metadata: { geotutor_turn_id: "turn-1" },
        output: [{ type: "function_call", status: "completed" }],
      },
    });

    expect(test.sent).toEqual([
      request("turn-1"),
      request("turn-2", "voice-event-2"),
    ]);
    expect(test.manager.snapshot()).toEqual([
      { turnId: "turn-1", state: "failed", responseId: "resp-1" },
      { turnId: "turn-2", state: "requested" },
    ]);
  });

  it("does not request for silence or malformed commits and fails closed channels", () => {
    const test = harness(false);
    test.manager.handle({ type: "input_audio_buffer.speech_started", item_id: "silence" });
    test.manager.handle({ type: "input_audio_buffer.speech_stopped", item_id: "silence" });
    test.manager.handle({ type: "input_audio_buffer.committed" });
    expect(test.send).not.toHaveBeenCalled();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(test.manager.snapshot()).toContainEqual({ turnId: "turn-1", state: "failed" });
  });

  it("cancels every non-terminal turn on close", () => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-2" });
    test.manager.close();
    expect(test.manager.snapshot()).toEqual([
      { turnId: "turn-1", state: "cancelled" },
      { turnId: "turn-2", state: "cancelled" },
    ]);
  });

  it("cancels the active and queued work without requesting another response", () => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle(created("turn-1", "resp-1"));
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-2" });

    test.manager.cancelOpen();

    expect(test.sent).toEqual([request("turn-1")]);
    expect(test.manager.currentTurnId()).toBeUndefined();
    expect(test.manager.snapshot()).toEqual([
      { turnId: "turn-1", state: "cancelled", responseId: "resp-1" },
      { turnId: "turn-2", state: "cancelled" },
    ]);
  });

  it("terminalizes a tooling turn explicitly when the loop cannot continue", () => {
    const test = harness();
    test.manager.handle({ type: "input_audio_buffer.committed", item_id: "turn-1" });
    test.manager.handle(created("turn-1", "resp-tools"));
    test.manager.handle({
      type: "response.done",
      response: {
        id: "resp-tools",
        status: "completed",
        metadata: { geotutor_turn_id: "turn-1" },
        output: [{ type: "function_call", status: "completed" }],
      },
    });

    expect(test.manager.failAfterTools()).toBe(true);
    expect(test.manager.currentTurnId()).toBeUndefined();
    expect(test.manager.snapshot()).toEqual([
      { turnId: "turn-1", state: "failed", responseId: "resp-tools" },
    ]);
  });
});

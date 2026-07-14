import { describe, expect, it, vi } from "vitest";

import { ToolGateway, type GatewayContext, type ToolHandlers } from "@/lib/tools/gateway";
import { RealtimeToolLoop } from "./tool-loop";
import { EvidenceLog } from "@/lib/pedagogy/evidence-log";

function harness(options: { timeoutMs?: number; gateway?: ToolGateway } = {}) {
  const handlers: ToolHandlers = {
    read_construction: vi.fn(({ revision }) => ({ data: { revision }, evidenceIds: [`snapshot-r${revision}`] })),
    initialize_exercise: vi.fn(() => ({ data: {} })),
    check_relation: vi.fn(({ relation }) => ({ data: { relation, pass: true }, evidenceIds: [`evidence-${relation}`] })),
    highlight_objects: vi.fn(() => ({ data: {} })),
  };
  const sent: unknown[] = [];
  const continuations = vi.fn(() => true);
  const failures = vi.fn();
  const context: GatewayContext = { turnId: "turn-1", phase: "constructing", revision: 4 };
  const loop = new RealtimeToolLoop({
    gateway: options.gateway ?? new ToolGateway(handlers),
    getContext: (turnId) => ({ ...context, turnId }),
    send: (event) => { sent.push(event); return true; },
    onContinuation: continuations,
    onFailure: failures,
    timeoutMs: options.timeoutMs,
  });
  return { loop, handlers, sent, continuations, failures };
}

function done(responseId = "resp-1") {
  return {
    type: "response.done",
    response: {
      id: responseId,
      status: "completed",
      output: [
        { type: "function_call", status: "completed", name: "read_construction", call_id: "call-1", arguments: '{"revision":4}' },
        { type: "function_call", status: "completed", name: "check_relation", call_id: "call-2", arguments: '{"relation":"perpendicular","objects":["d","AB"],"revision":4}' },
      ],
    },
  };
}

describe("RealtimeToolLoop", () => {
  it("publishes two correlated outputs before one continuation", async () => {
    const test = harness();
    const result = await test.loop.handle(done(), "turn-1");
    expect(result).toEqual({ responseId: "resp-1", callIds: ["call-1", "call-2"], outputCount: 2, continued: true });
    expect(test.sent).toHaveLength(2);
    expect(test.sent[0]).toEqual(expect.objectContaining({ type: "conversation.item.create", item: expect.objectContaining({ call_id: "call-1" }) }));
    expect(test.sent[1]).toEqual(expect.objectContaining({ type: "conversation.item.create", item: expect.objectContaining({ call_id: "call-2" }) }));
    expect(test.continuations).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(test.sent)).toContain("snapshot-r4");
    expect(JSON.stringify(test.sent)).toContain("evidence-perpendicular");
  });

  it("logs the real epoch and directive chain without tool arguments", async () => {
    const handlers: ToolHandlers = {
      read_construction: vi.fn(({ revision }) => ({
        data: { revision },
        evidenceIds: ["evidence-tool-result"],
      })),
      initialize_exercise: vi.fn(() => ({ data: {} })),
      check_relation: vi.fn(() => ({ data: {} })),
      highlight_objects: vi.fn(() => ({ data: {} })),
    };
    const log = new EvidenceLog({ runId: "run-tool", now: () => 10 });
    const loop = new RealtimeToolLoop({
      gateway: new ToolGateway(handlers),
      getContext: (turnId) => ({
        turnId,
        phase: "constructing",
        epoch: 7,
        revision: 4,
        directive: {
          directiveId: "directive-tool",
          sourceActionId: "action-tool",
          evidenceIds: ["evidence-anchor"],
          authorize: () => true,
        },
      }),
      send: () => true,
      onContinuation: () => true,
      onFailure: vi.fn(),
      evidenceLog: log,
    });
    const event = done("response-tool");
    event.response.output = [event.response.output[0]];

    await loop.handle(event, "turn-tool");

    expect(log.export()).toEqual([
      expect.objectContaining({
        eventType: "tool_call",
        epoch: 7,
        revision: 4,
        actionId: "action-tool",
        directiveId: "directive-tool",
        responseId: "response-tool",
        callId: "call-1",
        evidenceIds: ["evidence-anchor"],
      }),
      expect.objectContaining({
        eventType: "tool_result",
        epoch: 7,
        evidenceIds: ["evidence-tool-result"],
      }),
    ]);
    expect(JSON.stringify(log.export())).not.toContain('{"revision":4}');
  });

  it("deduplicates a replayed response and call batch", async () => {
    const test = harness();
    await test.loop.handle(done(), "turn-1");
    expect(await test.loop.handle(done(), "turn-1")).toBeUndefined();
    expect(test.handlers.read_construction).toHaveBeenCalledTimes(1);
    expect(test.sent).toHaveLength(2);
  });

  it.each(["cancelled", "failed", "incomplete"])("ignores a %s response", async (status) => {
    const test = harness();
    const event = done();
    event.response.status = status;
    expect(await test.loop.handle(event, "turn-1")).toBeUndefined();
    expect(test.sent).toEqual([]);
  });

  it("sends a timeout output and continues so the turn can terminate", async () => {
    const gateway = { execute: vi.fn(() => new Promise(() => undefined)) } as unknown as ToolGateway;
    const test = harness({ gateway, timeoutMs: 5 });
    const event = done();
    event.response.output = [event.response.output[0]];
    const result = await test.loop.handle(event, "turn-1");
    expect(result).toEqual(expect.objectContaining({ outputCount: 1, continued: true }));
    expect(test.sent).toHaveLength(1);
    expect(JSON.stringify(test.sent[0])).toContain("timed out safely");
    expect(test.continuations).toHaveBeenCalledTimes(1);
    expect(test.failures).not.toHaveBeenCalled();
  });

  it("turns a rejected gateway promise into an output and continuation", async () => {
    const gateway = {
      execute: vi.fn(() => Promise.reject(new Error("private failure"))),
    } as unknown as ToolGateway;
    const test = harness({ gateway });
    const event = done();
    event.response.output = [event.response.output[0]];

    expect(await test.loop.handle(event, "turn-1")).toEqual(
      expect.objectContaining({ outputCount: 1, continued: true }),
    );
    expect(JSON.stringify(test.sent)).toContain("Tool execution failed safely");
  });

  it("fails the tooling state if an output cannot be published", async () => {
    const handlers: ToolHandlers = {
      read_construction: vi.fn(({ revision }) => ({ data: { revision } })),
      initialize_exercise: vi.fn(() => ({ data: {} })),
      check_relation: vi.fn(() => ({ data: {} })),
      highlight_objects: vi.fn(() => ({ data: {} })),
    };
    const failures = vi.fn();
    const loop = new RealtimeToolLoop({
      gateway: new ToolGateway(handlers),
      getContext: (turnId) => ({ turnId, phase: "constructing", revision: 4 }),
      send: () => false,
      onContinuation: () => true,
      onFailure: failures,
    });
    const event = done();
    event.response.output = [event.response.output[0]];

    expect(await loop.handle(event, "turn-1")).toEqual(
      expect.objectContaining({ outputCount: 0, continued: false }),
    );
    expect(failures).toHaveBeenCalledTimes(1);
  });

  it("drops late gateway results after cancellation", async () => {
    let release!: (value: never) => void;
    const pending = new Promise<never>((resolve) => { release = resolve; });
    const gateway = { execute: vi.fn(() => pending) } as unknown as ToolGateway;
    const test = harness({ gateway, timeoutMs: 1_000 });
    const event = done();
    event.response.output = [event.response.output[0]];
    const handling = test.loop.handle(event, "turn-1");
    test.loop.cancel();
    release({ ok: true, callId: "call-1", revision: 4, data: {}, evidenceIds: [] } as never);
    expect(await handling).toBeUndefined();
    expect(test.sent).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { REALTIME_TOOL_DEFINITIONS, TOOL_NAMES, type ToolArguments } from "./contracts";
import { ToolGateway, type GatewayContext, type ToolHandlers } from "./gateway";

function handlers(): ToolHandlers {
  return {
    read_construction: vi.fn((arguments_: ToolArguments["read_construction"]) => ({
      data: { revision: arguments_.revision },
      evidenceIds: [`snapshot-r${arguments_.revision}`],
    })),
    initialize_exercise: vi.fn(() => ({ data: { initialized: true } })),
    check_relation: vi.fn(() => ({ data: { pass: true }, evidenceIds: ["evidence-1"] })),
    highlight_objects: vi.fn(() => ({ data: { highlighted: true } })),
  };
}

const constructing: GatewayContext = { turnId: "turn-1", phase: "constructing", revision: 4 };

describe("Realtime tool contracts", () => {
  it("declares exactly four strict functions with closed required schemas", () => {
    expect(REALTIME_TOOL_DEFINITIONS.map(({ name }) => name)).toEqual(TOOL_NAMES);
    for (const definition of REALTIME_TOOL_DEFINITIONS) {
      expect(definition.parameters.additionalProperties).toBe(false);
      expect([...definition.parameters.required].sort()).toEqual(
        Object.keys(definition.parameters.properties).sort(),
      );
    }
  });
});

describe("ToolGateway", () => {
  it.each([
    ["read_construction", { revision: 4 }, "constructing"],
    ["initialize_exercise", { planId: "confirmed-plan", expectedRevision: 4 }, "exercise_confirmed"],
    ["check_relation", { relation: "perpendicular", objects: ["d", "AB"], revision: 4 }, "constructing"],
    ["highlight_objects", { names: ["A", "B"], style: "hint", ttlMs: 500, revision: 4 }, "constructing"],
  ] as const)("allows the strict %s contract", async (name, arguments_, phase) => {
    const gateway = new ToolGateway(handlers());
    const result = await gateway.execute(
      { callId: `call-${name}`, name, arguments: JSON.stringify(arguments_) },
      { ...constructing, phase },
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ["execute_any_geogebra_command", "{}", "unknown_tool"],
    ["read_construction", "not-json", "invalid_arguments"],
    ["read_construction", '{"revision":4,"extra":true}', "invalid_arguments"],
    ["highlight_objects", '{"names":["A"],"style":"hint","ttlMs":99999,"revision":4}', "invalid_arguments"],
  ])("denies %s before execution", async (name, arguments_, code) => {
    const testHandlers = handlers();
    const gateway = new ToolGateway(testHandlers);
    const result = await gateway.execute(
      { callId: `call-${code}`, name, arguments: arguments_ },
      constructing,
    );
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) }));
    expect(Object.values(testHandlers).every((handler) => !vi.mocked(handler).mock.calls.length)).toBe(true);
  });

  it("rejects stale revisions and invalid phases without mutation", async () => {
    const testHandlers = handlers();
    const gateway = new ToolGateway(testHandlers);
    const stale = await gateway.execute(
      { callId: "stale", name: "check_relation", arguments: '{"relation":"perpendicular","objects":["d","AB"],"revision":3}' },
      constructing,
    );
    const phase = await gateway.execute(
      { callId: "phase", name: "initialize_exercise", arguments: '{"planId":"p1","expectedRevision":4}' },
      constructing,
    );
    expect(stale).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "stale_revision" }) }));
    expect(phase).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "invalid_phase" }) }));
    expect(testHandlers.initialize_exercise).not.toHaveBeenCalled();
    expect(testHandlers.check_relation).not.toHaveBeenCalled();
  });

  it("executes concurrent duplicate call_ids once and returns the same result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const testHandlers = handlers();
    testHandlers.read_construction = vi.fn(async () => {
      await gate;
      return { data: { revision: 4 }, evidenceIds: ["snapshot-r4"] };
    });
    const gateway = new ToolGateway(testHandlers);
    const call = { callId: "same-call", name: "read_construction", arguments: '{"revision":4}' };
    const first = gateway.execute(call, constructing);
    const duplicate = gateway.execute({ ...call, name: "highlight_objects", arguments: "{}" }, constructing);
    release();
    expect(await duplicate).toEqual(await first);
    expect(testHandlers.read_construction).toHaveBeenCalledTimes(1);
    expect(testHandlers.highlight_objects).not.toHaveBeenCalled();
  });

  it("enforces call and mutation budgets per turn", async () => {
    const gateway = new ToolGateway(handlers(), { maxCallsPerTurn: 2, maxMutationsPerTurn: 1 });
    const highlight = (callId: string, turnId: string) =>
      gateway.execute(
        { callId, name: "highlight_objects", arguments: '{"names":["A"],"style":"focus","ttlMs":100,"revision":4}' },
        { ...constructing, turnId },
      );
    expect((await highlight("h1", "turn-1")).ok).toBe(true);
    expect(await highlight("h2", "turn-1")).toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "budget_exceeded" }) }),
    );
    expect((await highlight("h3", "turn-2")).ok).toBe(true);
  });

  it("fails safely when a handler throws and preserves an empty evidence list", async () => {
    const testHandlers = handlers();
    testHandlers.check_relation = vi.fn(() => { throw new Error("sensitive details"); });
    const gateway = new ToolGateway(testHandlers);
    const result = await gateway.execute(
      { callId: "throws", name: "check_relation", arguments: '{"relation":"perpendicular","objects":["d","AB"],"revision":4}' },
      constructing,
    );
    expect(result).toEqual({
      ok: false,
      callId: "throws",
      revision: 4,
      error: { code: "execution_failed", message: "Tool execution failed safely." },
      evidenceIds: [],
    });
  });

  it("rejects bounded fuzzed JSON without reaching a handler", async () => {
    const testHandlers = handlers();
    const gateway = new ToolGateway(testHandlers);
    const corpus = Array.from({ length: 250 }, (_, index) =>
      index % 2 ? `{\"revision\":4,\"x${index}\":true}` : `[${index}]`,
    );
    for (const [index, arguments_] of corpus.entries()) {
      const result = await gateway.execute(
        { callId: `fuzz-${index}`, name: "read_construction", arguments: arguments_ },
        constructing,
      );
      expect(result.ok).toBe(false);
    }
    expect(testHandlers.read_construction).not.toHaveBeenCalled();
  });
});

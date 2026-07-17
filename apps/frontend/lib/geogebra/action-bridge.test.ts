import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompletedActionBridge, normalizeAffectedNames } from "./action-bridge";
import { GeoGebraAdapter } from "./adapter";
import { SceneRegistry } from "./scene";
import type { ConstructionSnapshot, GeoGebraApi, GeoGebraAppletParameters } from "@/types/geogebra";

async function readyAdapter() {
  let parameters: GeoGebraAppletParameters | undefined;
  let clientListener: ((event: { type: string; target?: unknown; argument?: unknown }) => void) | undefined;
  const objectListeners: Partial<Record<"add" | "remove" | "update", (name: string) => void>> = {};
  const api: GeoGebraApi = {
    evalCommand: vi.fn(() => true), exists: vi.fn(() => true), isDefined: vi.fn(() => true),
    getCommandString: vi.fn(() => ""), getObjectType: vi.fn(() => "line"),
    setCoordSystem: vi.fn(), setLabelVisible: vi.fn(),
    registerClientListener: vi.fn((listener) => { clientListener = listener; }),
    unregisterClientListener: vi.fn(),
    registerAddListener: vi.fn((listener) => { objectListeners.add = listener; }),
    unregisterAddListener: vi.fn(),
    registerRemoveListener: vi.fn((listener) => { objectListeners.remove = listener; }),
    unregisterRemoveListener: vi.fn(),
    registerUpdateListener: vi.fn((listener) => { objectListeners.update = listener; }),
    unregisterUpdateListener: vi.fn(),
  };
  const adapter = new GeoGebraAdapter({
    loadScript: async () => undefined,
    createApplet(next) { parameters = next; return { inject: vi.fn(), removeExistingApplet: vi.fn(), setHTML5Codebase: vi.fn() }; },
  });
  const loading = adapter.load("target");
  await vi.waitFor(() => expect(parameters).toBeDefined());
  parameters?.appletOnLoad(api);
  await loading;
  return {
    adapter,
    api,
    emit: (event: { type: string; target?: unknown; argument?: unknown }) => clientListener?.(event),
    emitObject: (kind: "add" | "remove" | "update", name: string) => objectListeners[kind]?.(name),
  };
}

function completeSnapshot(revision: number, hash: string): ConstructionSnapshot {
  return { revision, hash, complete: true, objects: [] };
}

describe("CompletedActionBridge", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces update bursts and dragEnd into one stable action", async () => {
    const harness = await readyAdapter();
    const capture = vi
      .fn()
      .mockReturnValueOnce({ ok: true, value: completeSnapshot(1, "h1") })
      .mockReturnValue({ ok: true, value: completeSnapshot(1, "h1") });
    const onAction = vi.fn();
    const registry = new SceneRegistry();
    registry.register("P", "student", "point");
    const bridge = new CompletedActionBridge(
      harness.adapter,
      registry,
      { capture } as never,
      onAction,
    );
    bridge.start();
    for (let index = 0; index < 30; index += 1) {
      harness.emit({ type: "update", target: "P" });
    }
    harness.emit({ type: "dragEnd" });
    await vi.advanceTimersByTimeAsync(50);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({
      id: "construction-action-1", kind: "drag", affectedNames: ["P"], studentAffectedNames: ["P"], revision: 1, snapshotHash: "h1",
    });
  });

  it("emits one student drag start and end around movingGeos before completion", async () => {
    const harness = await readyAdapter();
    const registry = new SceneRegistry();
    registry.register("P", "student", "point");
    const onAction = vi.fn();
    const onActivity = vi.fn();
    const bridge = new CompletedActionBridge(
      harness.adapter,
      registry,
      {
        capture: () => ({ ok: true, value: completeSnapshot(2, "drag-hash") }),
      } as never,
      onAction,
      onActivity,
    );
    bridge.start();

    harness.emit({ type: "movingGeos", argument: "P" });
    harness.emit({ type: "movingGeos", argument: "P" });
    harness.emit({ type: "dragEnd", argument: "P" });

    expect(onActivity.mock.calls.map(([activity]) => activity)).toEqual([
      { type: "student_drag_started", affectedNames: ["P"] },
      { type: "student_drag_ended", affectedNames: ["P"] },
    ]);
    expect(onAction).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("bounds an unstable action at 500 ms without emitting", async () => {
    const harness = await readyAdapter();
    let revision = 0;
    const capture = vi.fn(() => ({ ok: true, value: completeSnapshot(++revision, `h${revision}`) }));
    const onAction = vi.fn();
    const bridge = new CompletedActionBridge(harness.adapter, new SceneRegistry(), { capture } as never, onAction);
    bridge.start();
    harness.emit({ type: "movedGeos", argument: '["A","B"]' });
    await vi.advanceTimersByTimeAsync(550);
    expect(onAction).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(11);
  });

  it("requires complete matching snapshots to be consecutive", async () => {
    const harness = await readyAdapter();
    const capture = vi
      .fn()
      .mockReturnValueOnce({ ok: true, value: completeSnapshot(1, "h1") })
      .mockReturnValueOnce({
        ok: false,
        error: { code: "incomplete", message: "transient read" },
        value: { ...completeSnapshot(1, "partial"), complete: false },
      })
      .mockReturnValue({ ok: true, value: completeSnapshot(1, "h1") });
    const onAction = vi.fn();
    const bridge = new CompletedActionBridge(
      harness.adapter,
      new SceneRegistry(),
      { capture } as never,
      onAction,
    );
    bridge.start();
    harness.emit({ type: "movedGeos", argument: "P" });

    await vi.advanceTimersByTimeAsync(100);
    expect(onAction).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(4);
  });

  it("does not emit an empty update after listener reconciliation", async () => {
    const harness = await readyAdapter();
    const onAction = vi.fn();
    const bridge = new CompletedActionBridge(
      harness.adapter,
      new SceneRegistry(),
      { capture: () => ({ ok: true, value: completeSnapshot(1, "h") }) } as never,
      onAction,
    );
    bridge.start();
    harness.emitObject("update", "");
    await vi.advanceTimersByTimeAsync(50);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("assigns student ownership on add and unregisters on stop", async () => {
    const harness = await readyAdapter();
    const registry = new SceneRegistry();
    const bridge = new CompletedActionBridge(
      harness.adapter,
      registry,
      { capture: () => ({ ok: true, value: completeSnapshot(1, "h") }) } as never,
      vi.fn(),
    );
    bridge.start();
    harness.emitObject("add", "line1");
    expect(registry.get("line1")).toEqual({ name: "line1", owner: "student", kind: "line" });
    bridge.stop();
    expect(harness.api.unregisterClientListener).toHaveBeenCalledTimes(1);
    expect(harness.api.unregisterAddListener).toHaveBeenCalledTimes(1);
  });

  it("preserves a pre-registered hint owner and never reports it as student work", async () => {
    const harness = await readyAdapter();
    const registry = new SceneRegistry();
    registry.register("gtHint_demo_M", "hint", "point");
    const onAction = vi.fn();
    const bridge = new CompletedActionBridge(
      harness.adapter,
      registry,
      { capture: () => ({ ok: true, value: completeSnapshot(1, "hint-hash") }) } as never,
      onAction,
    );
    bridge.start();
    harness.emitObject("add", "gtHint_demo_M");
    await vi.advanceTimersByTimeAsync(50);

    expect(registry.get("gtHint_demo_M")).toEqual({
      name: "gtHint_demo_M",
      owner: "hint",
      kind: "point",
    });
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        affectedNames: ["gtHint_demo_M"],
        studentAffectedNames: [],
      }),
    );
  });

  it("preserves student ownership in a stabilized remove action", async () => {
    const harness = await readyAdapter();
    const registry = new SceneRegistry();
    registry.register("candidate", "student", "line");
    const onAction = vi.fn();
    const bridge = new CompletedActionBridge(
      harness.adapter,
      registry,
      { capture: () => ({ ok: true, value: completeSnapshot(3, "without-candidate") }) } as never,
      onAction,
    );
    bridge.start();
    harness.emitObject("remove", "candidate");
    await vi.advanceTimersByTimeAsync(50);

    expect(registry.get("candidate")).toBeUndefined();
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "remove",
        affectedNames: ["candidate"],
        studentAffectedNames: ["candidate"],
        revision: 3,
      }),
    );
  });
});

describe("normalizeAffectedNames", () => {
  it.each([
    ["A,B", ["A", "B"]],
    [["B", "A"], ["A", "B"]],
    ['["B","A"]', ["A", "B"]],
    ['{"labels":["B","A"]}', ["A", "B"]],
  ])("normalizes %j", (argument, expected) => {
    expect(normalizeAffectedNames(undefined, argument)).toEqual(expected);
  });

  it("ignores an unknown serialized shape", () => {
    expect(normalizeAffectedNames(undefined, "{not-json}")).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { CompletedActionBridge } from "./action-bridge";
import { GeoGebraAdapter } from "./adapter";
import { CheckpointService, SET_BASE64_TIMEOUT_MS } from "./checkpoint";
import { SceneRegistry } from "./scene";
import { SnapshotService } from "./snapshot";
import type { GeoGebraApi, GeoGebraAppletParameters } from "@/types/geogebra";

const initialCommands = () => new Map([
  ["A", "(-2,0)"], ["B", "(2,0)"], ["AB", "Segment[A,B]"],
]);

type RestoreBehavior = "valid" | "corrupt" | "rogue" | "silent";

async function harness(restoreBehavior: RestoreBehavior = "valid") {
  let parameters: GeoGebraAppletParameters | undefined;
  let commands = initialCommands();
  const listeners = { client: new Set<unknown>(), add: new Set<unknown>(), remove: new Set<unknown>(), update: new Set<unknown>() };
  const api: GeoGebraApi = {
    evalCommand: vi.fn((command) => {
      const name = command.split("=")[0].trim();
      commands.set(name, name === "AB" ? "Segment[A,B]" : command.split("=").slice(1).join("=").trim());
      return true;
    }),
    exists: vi.fn((name) => commands.has(name)), isDefined: vi.fn((name) => commands.has(name)),
    deleteObject: vi.fn((name) => { commands.delete(name); }), getAllObjectNames: vi.fn(() => [...commands.keys()]),
    getCommandString: vi.fn((name) => commands.get(name) ?? ""), getObjectType: vi.fn(() => "line"),
    getBase64: vi.fn((callback) => callback("initial-state")),
    setBase64: vi.fn((_base64, callback) => {
      if (restoreBehavior === "silent") return;
      commands =
        restoreBehavior === "corrupt"
          ? new Map([["broken", "(9,9)"]])
          : initialCommands();
      if (restoreBehavior === "rogue") commands.set("rogue", "(9,9)");
      callback?.();
    }),
    setCoordSystem: vi.fn(), setFixed: vi.fn(), setLabelVisible: vi.fn(),
    registerClientListener: vi.fn((listener) => listeners.client.add(listener)), unregisterClientListener: vi.fn((listener) => listeners.client.delete(listener)),
    registerAddListener: vi.fn((listener) => listeners.add.add(listener)), unregisterAddListener: vi.fn((listener) => listeners.add.delete(listener)),
    registerRemoveListener: vi.fn((listener) => listeners.remove.add(listener)), unregisterRemoveListener: vi.fn((listener) => listeners.remove.delete(listener)),
    registerUpdateListener: vi.fn((listener) => listeners.update.add(listener)), unregisterUpdateListener: vi.fn((listener) => listeners.update.delete(listener)),
  };
  const adapter = new GeoGebraAdapter({
    loadScript: async () => undefined,
    createApplet(next) { parameters = next; return { inject: vi.fn(), removeExistingApplet: vi.fn(), setHTML5Codebase: vi.fn() }; },
  });
  const loading = adapter.load("target"); await vi.waitFor(() => expect(parameters).toBeDefined()); parameters?.appletOnLoad(api); await loading;
  const registry = new SceneRegistry();
  registry.replace([{ name: "A", owner: "system", kind: "point" }, { name: "AB", owner: "system", kind: "segment" }, { name: "B", owner: "system", kind: "point" }]);
  const snapshots = new SnapshotService(adapter, registry);
  const onAction = vi.fn();
  const bridge = new CompletedActionBridge(adapter, registry, snapshots, onAction); bridge.start();
  const service = new CheckpointService(adapter, registry, snapshots, bridge);
  await service.captureInitial();
  return { adapter, api, bridge, commands: () => commands, onAction, registry, service, snapshots };
}

describe("CheckpointService", () => {
  it("restores the initial hash and exactly one of each listener", async () => {
    const h = await harness();
    h.commands().set("studentLine", "Line[A,B]"); h.registry.register("studentLine", "student", "line");
    const before = h.snapshots.capture();
    const result = await h.service.reset();
    expect(result).toMatchObject({ ok: true, value: { recovered: false, listenerCount: 4 } });
    expect(result.ok && result.value.snapshot.hash).toBe(h.service.current?.initialHash);
    expect(before.value.hash).not.toBe(result.ok && result.value.snapshot.hash);
    expect(h.registry.list().map(({ name }) => name)).toEqual(["A", "AB", "B"]);
  });

  it("deduplicates concurrent resets", async () => {
    const h = await harness();
    const first = h.service.reset(); const second = h.service.reset();
    expect(first).toBe(second);
    await first;
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending stabilized action during reset", async () => {
    const h = await harness();
    vi.useFakeTimers();
    h.bridge.handle({ type: "update", target: "A" });
    await h.service.reset();
    await vi.advanceTimersByTimeAsync(600);
    expect(h.onAction).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("rebuilds canonical A/B/AB when restored hash diverges", async () => {
    const h = await harness("corrupt");
    const result = await h.service.reset();
    if (!result.ok) throw new Error(result.error.message);
    expect(result).toMatchObject({ ok: true, value: { recovered: true, listenerCount: 4 } });
    expect(h.commands().has("broken")).toBe(false);
    expect([...h.commands().keys()].sort()).toEqual(["A", "AB", "B"]);
  });

  it("rejects an unregistered rogue object after Base64 restore", async () => {
    const h = await harness("rogue");
    const result = await h.service.reset();
    expect(result).toMatchObject({
      ok: true,
      value: { recovered: true, listenerCount: 4 },
    });
    expect(h.commands().has("rogue")).toBe(false);
    expect([...h.commands().keys()].sort()).toEqual(["A", "AB", "B"]);
  });

  it("times out a missing setBase64 callback and recovers canonically", async () => {
    const h = await harness("silent");
    h.commands().set("studentLine", "Line[A,B]");
    h.registry.register("studentLine", "student", "line");
    vi.useFakeTimers();
    const reset = h.service.reset();
    await vi.advanceTimersByTimeAsync(SET_BASE64_TIMEOUT_MS);
    const result = await reset;
    expect(result).toMatchObject({
      ok: true,
      value: { recovered: true, listenerCount: 4 },
    });
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect([...h.commands().keys()].sort()).toEqual(["A", "AB", "B"]);
    vi.useRealTimers();
  });
});

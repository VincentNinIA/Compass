import { describe, expect, it, vi } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import { CompletedActionBridge } from "./action-bridge";
import { GeoGebraAdapter } from "./adapter";
import { CheckpointService, SET_BASE64_TIMEOUT_MS } from "./checkpoint";
import { SceneRegistry } from "./scene";
import { SnapshotService } from "./snapshot";
import type { GeoGebraApi, GeoGebraAppletParameters } from "@/types/geogebra";
import { OperationArbiter } from "@/lib/operations/arbiter";

const initialCommands = () => new Map([
  ["A", "(-2,0)"], ["B", "(2,0)"], ["AB", "Segment[A,B]"],
]);

type RestoreBehavior = "valid" | "corrupt" | "rogue" | "silent";

const PLAN = deriveExercisePlanV1({
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

async function harness(
  restoreBehavior: RestoreBehavior = "valid",
  captureInitial = true,
) {
  let parameters: GeoGebraAppletParameters | undefined;
  let commands = initialCommands();
  let restoreCallCount = 0;
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
    getBase64: vi.fn((callback) =>
      callback(JSON.stringify([...commands.entries()])),
    ),
    setBase64: vi.fn((base64, callback) => {
      restoreCallCount += 1;
      if (restoreCallCount === 1 && restoreBehavior === "silent") return;
      commands =
        restoreCallCount === 1 && restoreBehavior === "corrupt"
          ? new Map([["broken", "(9,9)"]])
          : new Map(JSON.parse(base64) as [string, string][]);
      if (restoreCallCount === 1 && restoreBehavior === "rogue") {
        commands.set("rogue", "(9,9)");
      }
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
  if (captureInitial) await service.captureInitial();
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
    expect(h.api.setBase64).toHaveBeenCalledTimes(2);
    expect([...h.commands().keys()].sort()).toEqual(["A", "AB", "B"]);
    vi.useRealTimers();
  });

  it("advances epoch before cancellation and waits for every effect before Base64", async () => {
    const h = await harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const initialEpoch = h.adapter.epoch;
    const reset = h.service.reset({
      reason: "user_request",
      cancelEffects: async ({ epoch, reason }) => {
        expect(epoch).toBe(initialEpoch + 1);
        expect(reason).toBe("user_request");
        expect(h.api.setBase64).not.toHaveBeenCalled();
        await gate;
        return ["invariance_c01_c03", "realtime_responses_audio_tools"];
      },
    });
    expect(h.adapter.epoch).toBe(initialEpoch + 1);
    expect(h.api.setBase64).not.toHaveBeenCalled();
    release();
    const result = await reset;
    expect(result).toMatchObject({
      ok: true,
      value: {
        epoch: initialEpoch + 1,
        restoration: "checkpoint",
        cancelledScopes: [
          "invariance_c01_c03",
          "realtime_responses_audio_tools",
        ],
      },
    });
  });

  it("performs no mutation after a reset watchdog expires during checkpoint acknowledgement", async () => {
    const h = await harness();
    vi.useFakeTimers();
    const arbiter = new OperationArbiter({ watchdogMs: 5 });
    const lease = arbiter.begin({
      kind: "reset",
      epoch: h.adapter.epoch + 1,
      revision: 0,
    });
    vi.mocked(h.api.setBase64!).mockImplementation((base64, callback) => {
      const restored = new Map(JSON.parse(base64) as [string, string][]);
      h.commands().clear();
      for (const [name, command] of restored) h.commands().set(name, command);
      setTimeout(() => callback?.(), 10);
    });
    const reset = h.service.reset({
      guardMutation: () =>
        lease.commit("geogebra_mutation", undefined, () => true) === true,
    });
    await vi.advanceTimersByTimeAsync(6);
    expect(arbiter.snapshot().pending).toEqual([]);
    await vi.advanceTimersByTimeAsync(4);
    const result = await reset;

    expect(result).toMatchObject({
      ok: false,
      error: { code: "cancellation_failed", state: "fatal", retryable: true },
    });
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.api.deleteObject).not.toHaveBeenCalled();
    expect(h.api.evalCommand).not.toHaveBeenCalled();
    expect(
      arbiter.snapshot().trace.some(
        (entry) =>
          entry.kind === "reset" &&
          entry.event === "quarantined" &&
          entry.reason === "watchdog_timeout",
      ),
    ).toBe(true);
    vi.useRealTimers();
  });

  it("rebuilds only confirmed A/B/AB when the checkpoint is absent and promotes it", async () => {
    const h = await harness("valid", false);
    const result = await h.service.reset({ recoveryPlan: PLAN });
    expect(result).toMatchObject({
      ok: true,
      value: {
        recovered: true,
        restoration: "canonical_fixture",
        checkpointPromoted: true,
        inventory: ["A", "AB", "B"],
        listenerCount: 4,
      },
    });
    expect(h.registry.list()).toEqual([
      { name: "A", owner: "exercise", kind: "point" },
      { name: "AB", owner: "exercise", kind: "segment" },
      { name: "B", owner: "exercise", kind: "point" },
    ]);
    expect(h.service.current?.initialHash).toBe(
      result.ok ? result.value.afterHash : undefined,
    );

    const second = await h.service.reset({ recoveryPlan: PLAN });
    expect(second).toMatchObject({
      ok: true,
      value: { recovered: false, restoration: "checkpoint" },
    });
  });

  it("publishes a retryable fatal state and succeeds on retry after reconstruction recovers", async () => {
    const h = await harness("valid", false);
    vi.mocked(h.api.evalCommand).mockReturnValue(false);
    const failed = await h.service.reset({ recoveryPlan: PLAN });
    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: "recovery_failed",
        state: "fatal",
        retryable: true,
        reason: "user_request",
      },
    });
    expect(h.service.current).toBeUndefined();

    vi.mocked(h.api.evalCommand).mockImplementation((command) => {
      const name = command.split("=")[0].trim();
      h.commands().set(
        name,
        name === "AB"
          ? "Segment[A,B]"
          : command.split("=").slice(1).join("=").trim(),
      );
      return true;
    });
    const retried = await h.service.reset({
      reason: "recovery_retry",
      recoveryPlan: PLAN,
    });
    expect(retried).toMatchObject({
      ok: true,
      value: {
        reason: "recovery_retry",
        recovered: true,
        checkpointPromoted: true,
        listenerCount: 4,
      },
    });
  });

  it("fails closed without a confirmed plan when no checkpoint exists", async () => {
    const h = await harness("valid", false);
    const result = await h.service.reset();
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "recovery_failed",
        state: "fatal",
        retryable: true,
      },
    });
    expect(h.api.evalCommand).not.toHaveBeenCalled();
  });
});

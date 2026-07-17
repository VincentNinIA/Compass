import { describe, expect, it, vi } from "vitest";

import { SceneRegistry } from "@/lib/geogebra/scene";
import type { GeoGebraApi } from "@/types/geogebra";

import { GeometryCheckpointControllerV1 } from "./checkpoint-v2";
import { readGeometryWorldV2 } from "./world";

describe("GeometryCheckpointControllerV1", () => {
  it("captures only after two stable worlds and anchors Base64, inventory and ownership", async () => {
    const fixture = checkpointFixture();
    const result = await fixture.controller.capture({
      id: "checkpoint_convex",
      createdAt: 1_000,
    });
    expect(result).toMatchObject({
      ok: true,
      checkpoint: {
        id: "checkpoint_convex",
        activityId: "varignon_fr_v1",
        epoch: 1,
        revision: 2,
        inventory: ["A", "B"],
        listenerCount: 4,
      },
    });
    if (result.ok) {
      expect(result.checkpoint.base64).toContain('"A"');
      expect(result.checkpoint.registry).toEqual([
        { name: "A", owner: "scaffold", kind: "point" },
        { name: "B", owner: "student", kind: "point" },
      ]);
    }
  });

  it("keeps mixed-case GeoGebra labels in one canonical inventory order", async () => {
    const fixture = checkpointFixture();
    fixture.add("F", 1, 1);
    fixture.registry.register("F", "student", "point");
    fixture.add("f", 2, 2);
    fixture.registry.register("f", "student", "point");

    const result = await fixture.controller.capture({
      id: "checkpoint_mixed_case",
      createdAt: 1_000,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("rejects a changing world without calling getBase64", async () => {
    const fixture = checkpointFixture();
    let read = 0;
    fixture.world = () => fixture.makeWorld(read++ === 0 ? 2 : 3);
    const result = await fixture.controller.capture({
      id: "checkpoint_unstable",
      createdAt: 1_000,
    });
    expect(result).toMatchObject({ ok: false, code: "snapshot_unstable" });
    expect(fixture.getBase64).not.toHaveBeenCalled();
  });

  it("fails atomically when the GeoGebra callback times out", async () => {
    const fixture = checkpointFixture({ callbackMode: "never" });
    const result = await fixture.controller.capture({
      id: "checkpoint_timeout",
      createdAt: 1_000,
    });
    expect(result).toMatchObject({ ok: false, code: "checkpoint_unavailable" });
  });

  it("restores exact hash, inventory, ownership and listener count", async () => {
    const fixture = checkpointFixture();
    const captured = await fixture.controller.capture({
      id: "checkpoint_restore",
      createdAt: 1_000,
    });
    if (!captured.ok) throw new Error(captured.message);
    fixture.move("A", 42, 24);
    fixture.add("X", 7, 8);
    fixture.registry.register("X", "assistant", "point");

    const restored = await fixture.controller.restore(captured.checkpoint, {
      activityId: "varignon_fr_v1",
      epoch: 2,
      revision: 3,
    });
    expect(restored).toMatchObject({
      ok: true,
      world: { snapshotHash: captured.checkpoint.snapshotHash },
      listenerCountBefore: 4,
      listenerCountAfter: 4,
    });
    expect(fixture.names()).toEqual(["A", "B"]);
    expect(fixture.registry.list()).toEqual(captured.checkpoint.registry);
    expect(fixture.suspend).toHaveBeenCalledTimes(1);
    expect(fixture.resume).toHaveBeenCalledTimes(1);
  });

  it("rejects a restore when listeners do not reconcile", async () => {
    const fixture = checkpointFixture({ resumedListeners: 3 });
    const captured = await fixture.controller.capture({
      id: "checkpoint_listeners",
      createdAt: 1_000,
    });
    if (!captured.ok) throw new Error(captured.message);
    const restored = await fixture.controller.restore(captured.checkpoint, {
      activityId: "varignon_fr_v1",
      epoch: 2,
      revision: 3,
    });
    expect(restored).toMatchObject({
      ok: false,
      code: "restore_failed",
      listenerCountAfter: 3,
    });
  });

  it("cancels before the atomic write when an interaction reaches the restore barrier", async () => {
    let releaseBarrier: (() => void) | undefined;
    const statuses: boolean[] = [];
    const fixture = checkpointFixture({
      onRestoreStatus: (restoring) => statuses.push(restoring),
      waitForRestoreBarrier: () =>
        new Promise<void>((resolve) => {
          releaseBarrier = resolve;
        }),
    });
    const captured = await fixture.controller.capture({
      id: "checkpoint_barrier_cancel",
      createdAt: 1_000,
    });
    if (!captured.ok) throw new Error(captured.message);
    fixture.move("A", 42, 24);
    const abort = new AbortController();

    const pending = fixture.controller.restore(captured.checkpoint, {
      activityId: "varignon_fr_v1",
      epoch: 2,
      revision: 3,
      signal: abort.signal,
    });
    await vi.waitFor(() => expect(releaseBarrier).toBeTypeOf("function"));
    abort.abort("preserve_learner_world");
    releaseBarrier?.();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: "cancelled",
    });
    expect(fixture.point("A")).toEqual([42, 24]);
    expect(statuses).toEqual([true, false]);
  });

  it("finishes an atomic write safely when cancellation arrives inside setBase64", async () => {
    const fixture = checkpointFixture({ deferRestoreCallback: true });
    const captured = await fixture.controller.capture({
      id: "checkpoint_atomic_restore",
      createdAt: 1_000,
    });
    if (!captured.ok) throw new Error(captured.message);
    fixture.move("A", 42, 24);
    const abort = new AbortController();

    const pending = fixture.controller.restore(captured.checkpoint, {
      activityId: "varignon_fr_v1",
      epoch: 2,
      revision: 3,
      signal: abort.signal,
    });
    await vi.waitFor(() => expect(fixture.restoreWritePending()).toBe(true));
    abort.abort("preserve_learner_world");
    fixture.releaseRestore();

    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(fixture.point("A")).toEqual([-2, 0]);
  });
});

type ObjectState = {
  type: string;
  command: string;
  x: number;
  y: number;
  color: string;
  visible: boolean;
};

function checkpointFixture(
  options: {
    callbackMode?: "sync" | "never";
    resumedListeners?: number;
    deferRestoreCallback?: boolean;
    onRestoreStatus?: (restoring: boolean) => void;
    waitForRestoreBarrier?: () => Promise<void>;
  } = {},
) {
  const objects = new Map<string, ObjectState>([
    ["A", pointState("A", -2, 0)],
    ["B", pointState("B", 2, 0)],
  ]);
  const registry = new SceneRegistry();
  registry.register("A", "scaffold", "point");
  registry.register("B", "student", "point");
  const getBase64 = vi.fn((callback: (base64: string) => void) => {
    if (options.callbackMode !== "never") callback(serialize(objects));
  });
  let releaseSetBase64: (() => void) | undefined;
  const api: GeoGebraApi = {
    deleteObject: (name) => {
      objects.delete(name);
    },
    evalCommand: () => true,
    exists: (name) => objects.has(name),
    getAllObjectNames: () => [...objects.keys()],
    getBase64,
    getColor: (name) => objects.get(name)?.color ?? "#000000",
    getCommandString: (name) => objects.get(name)?.command ?? "",
    getObjectType: (name) => objects.get(name)?.type ?? "unknown",
    getVisible: (name) => objects.get(name)?.visible ?? false,
    getXcoord: (name) => objects.get(name)?.x ?? Number.NaN,
    getYcoord: (name) => objects.get(name)?.y ?? Number.NaN,
    isDefined: (name) => objects.has(name),
    setBase64: (base64, callback) => {
      objects.clear();
      for (const [name, state] of JSON.parse(base64) as Array<
        [string, ObjectState]
      >) {
        objects.set(name, state);
      }
      if (options.deferRestoreCallback) {
        releaseSetBase64 = () => callback?.();
      } else {
        callback?.();
      }
    },
    setCoordSystem: vi.fn(),
    setLabelVisible: vi.fn(),
  };
  let worldReader = () => makeWorld(api, registry, 2);
  const resume = vi.fn(() => options.resumedListeners ?? 4);
  const suspend = vi.fn(() => ({ listenerCountBefore: 4, resume }));
  const controller = new GeometryCheckpointControllerV1({
    api,
    registry,
    getWorld: () => worldReader(),
    getListenerCount: () => 4,
    suspendListeners: suspend,
    reconcileListeners: () => true,
    onRestoreStatus: options.onRestoreStatus,
    waitForRestoreBarrier: options.waitForRestoreBarrier,
    setTimeout: (callback) => {
      if (!options.deferRestoreCallback) callback();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: vi.fn(),
  });
  return {
    controller,
    registry,
    getBase64,
    suspend,
    resume,
    makeWorld: (revision: number) => makeWorld(api, registry, revision),
    set world(reader: () => ReturnType<typeof makeWorld>) {
      worldReader = reader;
    },
    names: () => [...objects.keys()].sort(),
    point(name: string) {
      const state = objects.get(name);
      return state ? [state.x, state.y] : undefined;
    },
    restoreWritePending: () => Boolean(releaseSetBase64),
    releaseRestore() {
      const release = releaseSetBase64;
      releaseSetBase64 = undefined;
      release?.();
    },
    move(name: string, x: number, y: number) {
      const state = objects.get(name);
      if (state) {
        state.x = x;
        state.y = y;
        state.command = `${name}=(${x},${y})`;
      }
    },
    add(name: string, x: number, y: number) {
      objects.set(name, pointState(name, x, y));
    },
  };
}

function makeWorld(api: GeoGebraApi, registry: SceneRegistry, revision: number) {
  return readGeometryWorldV2(api, {
    activityId: "varignon_fr_v1",
    epoch: 1,
    revision,
    registry,
    change: {
      kind: "initial",
      objectNames: [],
      terminal: true,
      actor: "system",
      occurredAt: 1,
    },
  });
}

function pointState(name: string, x: number, y: number): ObjectState {
  return {
    type: "point",
    command: `${name}=(${x},${y})`,
    x,
    y,
    color: "#000000",
    visible: true,
  };
}

function serialize(objects: Map<string, ObjectState>) {
  return JSON.stringify([...objects.entries()]);
}

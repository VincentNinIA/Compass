import { describe, expect, it, vi } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import { CompletedActionBridge } from "./action-bridge";
import { GeoGebraAdapter } from "./adapter";
import { CheckpointService } from "./checkpoint";
import { ExerciseInitializationService } from "./exercise-initialization";
import { initializeMinimalScene, SceneRegistry } from "./scene";
import { SnapshotService } from "./snapshot";
import type { GeoGebraApi, GeoGebraAppletParameters } from "@/types/geogebra";

const READY_EXTRACTION = {
  schemaVersion: "exercise_extraction.v1",
  outcome: "ready",
  language: "en",
  instruction: "Construct the perpendicular bisector of segment AB.",
  pointLabels: ["A", "B"],
  segmentEndpoints: ["A", "B"],
  requestedConstruction: "perpendicular_bisector",
  learningObjective: "perpendicular_bisector_equidistance",
  ambiguityCode: null,
  clarificationQuestion: null,
  unsupportedReason: null,
} as const;

const CONFIRMATION: ExerciseConfirmedV1 = {
  confirmationId: "confirmation-1",
  confirmedAt: 123,
  plan: deriveExercisePlanV1(READY_EXTRACTION),
};

type HarnessOptions = {
  failLabel?: "A" | "B" | "AB";
  failPostcondition?: boolean;
  corruptRestore?: boolean;
  empty?: boolean;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function harness(options: HarnessOptions = {}) {
  let parameters: GeoGebraAppletParameters | undefined;
  let commands = new Map<string, string>();
  let coordinates = new Map<string, [number, number]>();
  let exercisePhase = options.empty === true;
  const listeners = {
    client: new Set<unknown>(),
    add: new Set<(name: string) => void>(),
    remove: new Set<(name: string) => void>(),
    update: new Set<(name: string) => void>(),
  };

  const api: GeoGebraApi = {
    evalCommand: vi.fn((command) => {
      const label = command.split("=")[0].trim();
      if (
        options.failLabel === label &&
        exercisePhase &&
        command.includes(label === "AB" ? "Segment" : "3")
      ) {
        return false;
      }
      if (label === "AB") {
        commands.set(label, "Segment[A,B]");
      } else {
        const match = command.match(/\((-?\d+),\s*(-?\d+)\)/);
        if (!match) return false;
        coordinates.set(label, [Number(match[1]), Number(match[2])]);
        commands.set(label, "");
      }
      for (const listener of listeners.add) listener(label);
      return true;
    }),
    exists: vi.fn((name) => commands.has(name)),
    isDefined: vi.fn((name) => commands.has(name)),
    deleteObject: vi.fn((name) => {
      commands.delete(name);
      coordinates.delete(name);
    }),
    newConstruction: vi.fn(() => {
      commands.clear();
      coordinates.clear();
      exercisePhase = true;
    }),
    getAllObjectNames: vi.fn(() => [...commands.keys()]),
    getObjectNumber: vi.fn(() => commands.size),
    getObjectName: vi.fn((index) => [...commands.keys()][index] ?? ""),
    getCommandString: vi.fn((name) => commands.get(name) ?? ""),
    getObjectType: vi.fn((name) => (name === "AB" ? "segment" : "point")),
    getXcoord: vi.fn((name) => {
      const value = coordinates.get(name)?.[0] ?? 0;
      return options.failPostcondition && value === -3 ? -2.5 : value;
    }),
    getYcoord: vi.fn((name) => coordinates.get(name)?.[1] ?? 0),
    getBase64: vi.fn((callback) => {
      callback(
        JSON.stringify({
          commands: [...commands],
          coordinates: [...coordinates],
        }),
      );
    }),
    setBase64: vi.fn((base64, callback) => {
      if (options.corruptRestore) {
        commands = new Map([["broken", ""]]);
        coordinates = new Map([["broken", [9, 9]]]);
      } else {
        const parsed = JSON.parse(base64) as {
          commands: [string, string][];
          coordinates: [string, [number, number]][];
        };
        commands = new Map(parsed.commands);
        coordinates = new Map(parsed.coordinates);
      }
      callback?.();
    }),
    setCoordSystem: vi.fn(),
    setFixed: vi.fn(),
    setLabelVisible: vi.fn(),
    registerClientListener: vi.fn((listener) => listeners.client.add(listener)),
    unregisterClientListener: vi.fn((listener) => listeners.client.delete(listener)),
    registerAddListener: vi.fn((listener) => listeners.add.add(listener)),
    unregisterAddListener: vi.fn((listener) => listeners.add.delete(listener)),
    registerRemoveListener: vi.fn((listener) => listeners.remove.add(listener)),
    unregisterRemoveListener: vi.fn((listener) => listeners.remove.delete(listener)),
    registerUpdateListener: vi.fn((listener) => listeners.update.add(listener)),
    unregisterUpdateListener: vi.fn((listener) => listeners.update.delete(listener)),
  };

  const adapter = new GeoGebraAdapter({
    loadScript: async () => undefined,
    createApplet(next) {
      parameters = next;
      return {
        inject: vi.fn(),
        removeExistingApplet: vi.fn(),
        setHTML5Codebase: vi.fn(),
      };
    },
  });
  const loading = adapter.load("target");
  await vi.waitFor(() => expect(parameters).toBeDefined());
  parameters?.appletOnLoad(api);
  await loading;

  const registry = new SceneRegistry();
  if (!options.empty) {
    const initialized = initializeMinimalScene(adapter, registry);
    if (!initialized.ok) throw new Error(initialized.error.message);
  }
  const snapshots = new SnapshotService(adapter, registry);
  const onAction = vi.fn();
  const bridge = new CompletedActionBridge(
    adapter,
    registry,
    snapshots,
    onAction,
  );
  const started = bridge.start();
  if (!started.ok) throw new Error(started.error.message);
  const checkpoints = new CheckpointService(adapter, registry, snapshots, bridge);
  const baseline = await checkpoints.captureInitial();
  if (!baseline.ok) throw new Error(baseline.error.message);
  const service = new ExerciseInitializationService(
    adapter,
    registry,
    snapshots,
    bridge,
    checkpoints,
  );
  return {
    adapter,
    api,
    bridge,
    checkpoints,
    commands: () => commands,
    coordinates: () => coordinates,
    listeners,
    onAction,
    registry,
    service,
    snapshots,
    initialHash: baseline.value.snapshot.hash,
  };
}

describe("ExerciseInitializationService", () => {
  it("creates exactly A(-3,0), B(3,0), AB as exercise givens and no target", async () => {
    const h = await harness();
    const result = await h.service.initialize(CONFIRMATION);

    expect(result).toMatchObject({
      status: "initialized",
      planId: "demo-perpendicular-bisector-01",
      created: ["A", "B", "AB"],
    });
    expect([...h.commands().keys()].sort()).toEqual(["A", "AB", "B"]);
    expect(h.coordinates().get("A")).toEqual([-3, 0]);
    expect(h.coordinates().get("B")).toEqual([3, 0]);
    expect(h.registry.list()).toEqual([
      { name: "A", owner: "exercise", kind: "point" },
      { name: "AB", owner: "exercise", kind: "segment" },
      { name: "B", owner: "exercise", kind: "point" },
    ]);
    expect(h.commands().has("perpendicular_bisector_of_AB")).toBe(false);
    expect(h.service.lastTrace).toEqual([
      "validated",
      "preflight_passed",
      "checkpoint_captured",
      "bridge_stopped",
      "bootstrap_cleared",
      "givens_created",
      "postconditions_verified",
      "listeners_reconciled",
      "reset_checkpoint_promoted",
    ]);
  });

  it.each(["A", "B", "AB"] as const)(
    "restores the exact prior hash when creation of %s fails",
    async (label) => {
      const h = await harness({ failLabel: label });
      const result = await h.service.initialize(CONFIRMATION);
      const after = h.snapshots.capture();

      expect(result).toEqual({
        status: "failed",
        code: `create_${label.toLowerCase()}_failed`,
        rolledBack: true,
      });
      expect(after.ok && after.value.hash).toBe(h.initialHash);
      expect(h.registry.list().every(({ owner }) => owner === "system")).toBe(true);
      expect([...h.commands().keys()].sort()).toEqual(["A", "AB", "B"]);
    },
  );

  it("rolls back a failed postcondition to the exact hash", async () => {
    const h = await harness({ failPostcondition: true });
    const result = await h.service.initialize(CONFIRMATION);
    const after = h.snapshots.capture();

    expect(result).toEqual({
      status: "failed",
      code: "postcondition_failed",
      rolledBack: true,
    });
    expect(after.ok && after.value.hash).toBe(h.initialHash);
  });

  it("serializes concurrent confirmation and makes the second call idempotent", async () => {
    const h = await harness();
    const [first, second] = await Promise.all([
      h.service.initialize(CONFIRMATION),
      h.service.initialize(CONFIRMATION),
    ]);

    expect(first.status).toBe("initialized");
    expect(second).toEqual({
      status: "already_initialized",
      snapshotHash:
        first.status === "initialized" ? first.snapshotHash : "unreachable",
    });
    expect(h.api.evalCommand).toHaveBeenCalledTimes(6);
    expect(h.api.newConstruction).toHaveBeenCalledTimes(1);
  });

  it("refuses student work without clear or delete", async () => {
    const h = await harness();
    h.commands().set("studentLine", "Line[A,B]");
    h.registry.register("studentLine", "student", "line");
    vi.mocked(h.api.newConstruction!).mockClear();
    vi.mocked(h.api.deleteObject!).mockClear();

    const result = await h.service.initialize(CONFIRMATION);

    expect(result).toEqual({
      status: "failed",
      code: "canvas_not_empty",
      rolledBack: false,
    });
    expect(h.api.newConstruction).not.toHaveBeenCalled();
    expect(h.api.deleteObject).not.toHaveBeenCalled();
    expect(h.commands().has("studentLine")).toBe(true);
  });

  it("refuses a rogue object and an altered bootstrap before checkpoint", async () => {
    const rogue = await harness();
    rogue.commands().set("rogue", "");
    expect(await rogue.service.initialize(CONFIRMATION)).toMatchObject({
      status: "failed",
      code: "canvas_not_empty",
    });

    const altered = await harness();
    altered.coordinates().set("A", [-1, 0]);
    expect(await altered.service.initialize(CONFIRMATION)).toEqual({
      status: "failed",
      code: "bootstrap_not_verifiable",
      rolledBack: false,
    });
  });

  it("does not duplicate listeners or publish initialization as student work", async () => {
    const h = await harness();
    await h.service.initialize(CONFIRMATION);

    expect(h.adapter.listenerCount).toBe(4);
    expect(h.listeners.client.size).toBe(1);
    expect(h.listeners.add.size).toBe(1);
    expect(h.listeners.remove.size).toBe(1);
    expect(h.listeners.update.size).toBe(1);
    expect(h.onAction).not.toHaveBeenCalled();
  });

  it("promotes the exercise checkpoint so reset restores owners and givens exactly", async () => {
    const h = await harness();
    const initialized = await h.service.initialize(CONFIRMATION);
    if (initialized.status !== "initialized") {
      throw new Error(
        initialized.status === "failed" ? initialized.code : "unexpected idempotence",
      );
    }
    h.commands().set("studentLine", "Line[A,B]");
    h.registry.register("studentLine", "student", "line");

    const reset = await h.service.recover();

    expect(reset.ok && reset.value.snapshot.hash).toBe(initialized.snapshotHash);
    expect(h.registry.list()).toEqual([
      { name: "A", owner: "exercise", kind: "point" },
      { name: "AB", owner: "exercise", kind: "segment" },
      { name: "B", owner: "exercise", kind: "point" },
    ]);
    expect(h.coordinates().get("A")).toEqual([-3, 0]);
    expect(h.coordinates().get("B")).toEqual([3, 0]);
  });

  it("queues recovery until a suspended initialization has committed", async () => {
    const h = await harness();
    const captured = await h.checkpoints.captureCheckpoint();
    const captureGate = deferred<typeof captured>();
    const events: string[] = [];
    vi.spyOn(h.checkpoints, "captureCheckpoint").mockReturnValueOnce(
      captureGate.promise,
    );
    const setCurrent = h.checkpoints.setCurrent.bind(h.checkpoints);
    vi.spyOn(h.checkpoints, "setCurrent").mockImplementation((checkpoint) => {
      events.push("initialization_committed");
      setCurrent(checkpoint);
    });
    const reset = h.checkpoints.reset.bind(h.checkpoints);
    const resetSpy = vi
      .spyOn(h.checkpoints, "reset")
      .mockImplementation(() => {
        events.push("reset_started");
        return reset();
      });

    const initialization = h.service.initialize(CONFIRMATION);
    await vi.waitFor(() =>
      expect(h.checkpoints.captureCheckpoint).toHaveBeenCalledTimes(1),
    );
    const recovery = h.service.recover();

    expect(resetSpy).not.toHaveBeenCalled();
    captureGate.resolve(captured);
    expect((await initialization).status).toBe("initialized");
    expect((await recovery).ok).toBe(true);
    expect(events).toEqual(["initialization_committed", "reset_started"]);
  });

  it("queues recovery until a suspended rollback has finished", async () => {
    const h = await harness({ failLabel: "B" });
    const restoreGate = deferred<void>();
    const events: string[] = [];
    const restoreExact = h.checkpoints.restoreExact.bind(h.checkpoints);
    const restoreSpy = vi
      .spyOn(h.checkpoints, "restoreExact")
      .mockImplementation(async (checkpoint) => {
        events.push("rollback_started");
        await restoreGate.promise;
        const result = await restoreExact(checkpoint);
        events.push("rollback_finished");
        return result;
      });
    const reset = h.checkpoints.reset.bind(h.checkpoints);
    const resetSpy = vi
      .spyOn(h.checkpoints, "reset")
      .mockImplementation(() => {
        events.push("reset_started");
        return reset();
      });

    const initialization = h.service.initialize(CONFIRMATION);
    await vi.waitFor(() => expect(restoreSpy).toHaveBeenCalledTimes(1));
    const recovery = h.service.recover();

    expect(resetSpy).not.toHaveBeenCalled();
    restoreGate.resolve();
    expect(await initialization).toEqual({
      status: "failed",
      code: "create_b_failed",
      rolledBack: true,
    });
    expect((await recovery).ok).toBe(true);
    expect(events).toEqual([
      "rollback_started",
      "rollback_finished",
      "reset_started",
    ]);
  });

  it("freezes subsequent writes when exact rollback cannot be verified", async () => {
    const h = await harness({ failLabel: "B", corruptRestore: true });
    expect(await h.service.initialize(CONFIRMATION)).toEqual({
      status: "failed",
      code: "recovery_required",
      rolledBack: false,
    });
    const evalCalls = vi.mocked(h.api.evalCommand).mock.calls.length;
    expect(
      await h.service.initialize({ ...CONFIRMATION, confirmationId: "confirmation-2" }),
    ).toEqual({
      status: "failed",
      code: "recovery_required",
      rolledBack: false,
    });
    expect(h.api.evalCommand).toHaveBeenCalledTimes(evalCalls);
  });

  it("allows the reset service to recover the frozen boundary before a retry", async () => {
    const options: HarnessOptions = { failLabel: "B", corruptRestore: true };
    const h = await harness(options);
    expect(await h.service.initialize(CONFIRMATION)).toMatchObject({
      status: "failed",
      code: "recovery_required",
    });

    options.failLabel = undefined;
    options.corruptRestore = false;
    const recovery = await h.service.recover();
    expect(recovery.ok).toBe(true);
    expect(
      await h.service.initialize({
        ...CONFIRMATION,
        confirmationId: "confirmation-after-recovery",
      }),
    ).toMatchObject({ status: "initialized" });
  });

  it("supports a genuinely empty canvas", async () => {
    const h = await harness({ empty: true });
    const result = await h.service.initialize(CONFIRMATION);
    expect(result.status).toBe("initialized");
    expect([...h.commands().keys()].sort()).toEqual(["A", "AB", "B"]);
  });

  it("rejects a tampered confirmation before any checkpoint or mutation", async () => {
    const h = await harness();
    vi.mocked(h.api.getBase64!).mockClear();
    const tampered = {
      ...CONFIRMATION,
      plan: { ...CONFIRMATION.plan, exerciseId: "tampered" },
    } as unknown as ExerciseConfirmedV1;

    expect(await h.service.initialize(tampered)).toEqual({
      status: "failed",
      code: "invalid_confirmation",
      rolledBack: false,
    });
    expect(h.api.getBase64).not.toHaveBeenCalled();
  });
});

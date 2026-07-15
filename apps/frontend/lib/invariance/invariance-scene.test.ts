import { describe, expect, it, vi } from "vitest";

import { CompletedActionBridge } from "@/lib/geogebra/action-bridge";
import { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import { CheckpointService } from "@/lib/geogebra/checkpoint";
import { SceneRegistry } from "@/lib/geogebra/scene";
import { SnapshotService } from "@/lib/geogebra/snapshot";
import { createStudentConstructionFingerprint } from "@/lib/pedagogy/meaningful-delta";
import type {
  BisectorValidation,
  GeoGebraApi,
  GeoGebraAppletParameters,
  SceneObject,
} from "@/types/geogebra";
import type { InvarianceSceneRequest } from "./contracts";
import type {
  InvarianceSampleRequest,
  RunInvarianceTestInput,
} from "./contracts";
import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_POSITION_VERSION,
} from "./contracts";
import {
  INVARIANCE_HELPER_PREFIX,
  InvarianceSceneError,
  InvarianceSceneService,
} from "./invariance-scene";
import { RunInvarianceTestOperation } from "./run-invariance-test";

const BASELINE_OBJECTS: SceneObject[] = [
  { name: "A", owner: "exercise", kind: "point" },
  { name: "AB", owner: "exercise", kind: "segment" },
  { name: "B", owner: "exercise", kind: "point" },
  { name: "studentLine", owner: "student", kind: "line" },
];

type HarnessOptions = {
  failDirectHelperDelete?: boolean;
};

async function harness(options: HarnessOptions = {}) {
  let parameters: GeoGebraAppletParameters | undefined;
  let commands = new Map<string, string>([
    ["A", "(-3,0)"],
    ["B", "(3,0)"],
    ["AB", "Segment(A,B)"],
    ["studentLine", "PerpendicularLine((0,0),AB)"],
  ]);
  let fallbackStarted = false;
  const listeners = {
    client: new Set<unknown>(),
    add: new Set<(name: string) => void>(),
    remove: new Set<(name: string) => void>(),
    update: new Set<(name: string) => void>(),
  };
  const api: GeoGebraApi = {
    evalCommand: vi.fn((command) => {
      const [rawName, ...expression] = command.split("=");
      const name = rawName.trim();
      commands.set(name, expression.join("=").trim());
      for (const listener of listeners.add) listener(name);
      return true;
    }),
    exists: vi.fn((name) => commands.has(name)),
    isDefined: vi.fn((name) => commands.has(name)),
    deleteObject: vi.fn((name) => {
      if (
        options.failDirectHelperDelete &&
        !fallbackStarted &&
        name.startsWith(INVARIANCE_HELPER_PREFIX)
      ) {
        return;
      }
      commands.delete(name);
      for (const listener of listeners.remove) listener(name);
    }),
    getAllObjectNames: vi.fn(() => [...commands.keys()]),
    getObjectNumber: vi.fn(() => commands.size),
    getObjectName: vi.fn((index) => [...commands.keys()][index] ?? ""),
    getCommandString: vi.fn((name) => commands.get(name) ?? ""),
    getObjectType: vi.fn((name) =>
      name === "A" || name === "B" || name.endsWith("_P")
        ? "point"
        : name === "AB"
          ? "segment"
          : "line",
    ),
    getBase64: vi.fn((callback) =>
      callback(JSON.stringify([...commands.entries()])),
    ),
    setBase64: vi.fn((base64, callback) => {
      fallbackStarted = true;
      commands = new Map(JSON.parse(base64) as [string, string][]);
      callback?.();
    }),
    setCoordSystem: vi.fn(),
    setFixed: vi.fn(),
    setLabelVisible: vi.fn(),
    registerClientListener: vi.fn((listener) => listeners.client.add(listener)),
    unregisterClientListener: vi.fn((listener) =>
      listeners.client.delete(listener),
    ),
    registerAddListener: vi.fn((listener) => listeners.add.add(listener)),
    unregisterAddListener: vi.fn((listener) => listeners.add.delete(listener)),
    registerRemoveListener: vi.fn((listener) => listeners.remove.add(listener)),
    unregisterRemoveListener: vi.fn((listener) =>
      listeners.remove.delete(listener),
    ),
    registerUpdateListener: vi.fn((listener) => listeners.update.add(listener)),
    unregisterUpdateListener: vi.fn((listener) =>
      listeners.update.delete(listener),
    ),
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
  registry.replace(BASELINE_OBJECTS.map((object) => ({ ...object })));
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
  const checkpoints = new CheckpointService(
    adapter,
    registry,
    snapshots,
    bridge,
  );
  const service = new InvarianceSceneService(
    adapter,
    registry,
    snapshots,
    checkpoints,
    bridge,
  );
  return {
    adapter,
    api,
    bridge,
    commands: () => commands,
    listeners,
    onAction,
    registry,
    service,
    snapshots,
  };
}

function request(
  runId: string,
  signal: AbortSignal = new AbortController().signal,
): InvarianceSceneRequest {
  return Object.freeze({
    runId,
    candidateLine: "studentLine",
    revision: 7,
    inputEvidenceIds: Object.freeze([
      "evidence-r7-perpendicular",
      "evidence-r7-passes_midpoint",
    ] as const),
    signal,
    isAuthorityCurrent: () => !signal.aborted,
  });
}

function expectListenersRestored(h: Awaited<ReturnType<typeof harness>>) {
  expect(h.adapter.listenerCount).toBe(4);
  expect(h.listeners.client.size).toBe(1);
  expect(h.listeners.add.size).toBe(1);
  expect(h.listeners.remove.size).toBe(1);
  expect(h.listeners.update.size).toBe(1);
}

async function exactState(h: Awaited<ReturnType<typeof harness>>) {
  const snapshot = h.snapshots.capture();
  if (!snapshot.ok) throw new Error(snapshot.error.message);
  const student = createStudentConstructionFingerprint(snapshot.value);
  if (!student) throw new Error("Student fingerprint unavailable.");
  return {
    hash: snapshot.value.hash,
    studentHash: student.hash,
    registry: h.registry.list(),
    names: [...h.commands().keys()].sort(),
  };
}

describe("T5-C02 temporary invariance scene", () => {
  it("uses namespaced temporary ownership and cleans exactly on success", async () => {
    const h = await harness();
    const before = await exactState(h);

    const result = await h.service.run(request("run-success"), (scene) => {
      expect(scene.namespace).toBe("gtInv_run_success_");
      expect(scene.namespace.startsWith("_")).toBe(false);
      expect(h.adapter.listenerCount).toBe(0);
      const point = scene.createHelper("P", "Point(studentLine)", "point");
      const distance = scene.createHelper("PA", `Distance(${point}, A)`, "number");
      expect(point).toBe("gtInv_run_success_P");
      expect(distance).toBe("gtInv_run_success_PA");
      expect(h.registry.get(point)?.owner).toBe("temporary");
      expect(h.registry.get(distance)?.owner).toBe("temporary");
      return "five-samples-delegated";
    });

    expect(result).toBe("five-samples-delegated");
    expect(await exactState(h)).toEqual(before);
    expect(h.api.setBase64).not.toHaveBeenCalled();
    expect(h.onAction).not.toHaveBeenCalled();
    expectListenersRestored(h);
    expect(h.service.lastReport).toEqual({
      runId: "run-success",
      namespace: "gtInv_run_success_",
      status: "completed",
      restoration: "cleanup",
      restored: true,
      helpers: ["gtInv_run_success_P", "gtInv_run_success_PA"],
      beforeHash: before.hash,
      afterHash: before.hash,
      studentHashBefore: before.studentHash,
      studentHashAfter: before.studentHash,
      listenerCountBefore: 4,
      listenerCountAfter: 4,
    });
    expect(Object.isFrozen(h.service.lastReport)).toBe(true);
    expect(Object.isFrozen(h.service.lastReport?.helpers)).toBe(true);
  });

  it("restores through Base64 after a callback exception", async () => {
    const h = await harness();
    const before = await exactState(h);
    const failure = new Error("sample failed");

    await expect(
      h.service.run(request("run-throw"), (scene) => {
        scene.createHelper("P", "Point(studentLine)", "point");
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await exactState(h)).toEqual(before);
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.service.lastReport).toMatchObject({
      status: "failed",
      restoration: "checkpoint",
      restored: true,
      beforeHash: before.hash,
      afterHash: before.hash,
      studentHashBefore: before.studentHash,
      studentHashAfter: before.studentHash,
    });
    expectListenersRestored(h);
  });

  it("restores through Base64 when the active run is cancelled", async () => {
    const h = await harness();
    const before = await exactState(h);
    const controller = new AbortController();

    await expect(
      h.service.run(request("run-cancel", controller.signal), (scene) => {
        scene.createHelper("P", "Point(studentLine)", "point");
        controller.abort();
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(await exactState(h)).toEqual(before);
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.service.lastReport).toMatchObject({
      status: "cancelled",
      restoration: "checkpoint",
      restored: true,
    });
    expectListenersRestored(h);
  });

  it("preserves a colliding student object and fails without deleting it", async () => {
    const h = await harness();
    h.commands().set("gtInv_run_collision_P", "(7,7)");
    h.registry.register("gtInv_run_collision_P", "student", "point");
    const before = await exactState(h);

    await expect(
      h.service.run(request("run-collision"), (scene) => {
        scene.createHelper("P", "Point(studentLine)", "point");
      }),
    ).rejects.toMatchObject({
      name: "InvarianceSceneError",
      code: "label_collision",
    });

    expect(await exactState(h)).toEqual(before);
    expect(h.registry.get("gtInv_run_collision_P")?.owner).toBe("student");
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.api.deleteObject).not.toHaveBeenCalledWith(
      "gtInv_run_collision_P",
    );
    expect(h.service.lastReport).toMatchObject({
      status: "failed",
      restoration: "checkpoint",
      restored: true,
      helpers: [],
    });
    expectListenersRestored(h);
  });

  it("falls back when direct helper deletion is incomplete", async () => {
    const h = await harness({ failDirectHelperDelete: true });
    const before = await exactState(h);

    await expect(
      h.service.run(request("run-fallback"), (scene) => {
        scene.createHelper("P", "Point(studentLine)", "point");
      }),
    ).rejects.toEqual(new InvarianceSceneError("cleanup_failed"));

    expect(await exactState(h)).toEqual(before);
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.service.lastReport).toMatchObject({
      status: "failed",
      restoration: "checkpoint",
      restored: true,
      helpers: ["gtInv_run_fallback_P"],
    });
    expectListenersRestored(h);
  });

  it("strictly detects student work mutation and restores its hash and ownership", async () => {
    const h = await harness();
    const before = await exactState(h);

    await expect(
      h.service.run(request("run-student-guard"), () => {
        h.commands().set("studentLine", "Line(A,B)");
      }),
    ).rejects.toMatchObject({
      name: "InvarianceSceneError",
      code: "cleanup_failed",
    });

    expect(await exactState(h)).toEqual(before);
    expect(h.registry.get("studentLine")?.owner).toBe("student");
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.service.lastReport).toMatchObject({
      status: "failed",
      restoration: "checkpoint",
      restored: true,
      studentHashBefore: before.studentHash,
      studentHashAfter: before.studentHash,
    });
    expectListenersRestored(h);
  });

  it("is the single closed scene delegate around all five C01 samples", async () => {
    const h = await harness();
    const before = await exactState(h);
    const validation: BisectorValidation = {
      candidate: "studentLine",
      revision: 7,
      score: 2,
      evidence: [
        {
          id: "evidence-r7-perpendicular",
          relation: "perpendicular",
          pass: true,
          observed: 1,
          tolerance: 0,
          revision: 7,
          objects: ["studentLine", "AB"],
        },
        {
          id: "evidence-r7-passes_midpoint",
          relation: "passes_midpoint",
          pass: true,
          observed: 0,
          tolerance: 1e-6,
          revision: 7,
          objects: ["studentLine", "A", "B"],
        },
      ],
    };
    const operation = new RunInvarianceTestOperation({
      createRunId: () => "delegate-run",
      getCurrentValidation: () => validation,
      runInTemporaryScene: (sceneRequest, execute) =>
        h.service.run(sceneRequest, execute),
      sample: (sampleRequest: InvarianceSampleRequest) => {
        if (sampleRequest.index === 0) {
          sampleRequest.scene.createHelper(
            "P",
            "Point(studentLine)",
            "point",
          );
        }
        return {
          id: `sample-${sampleRequest.index}`,
          index: sampleRequest.index,
          parameter: sampleRequest.parameter,
          coords: [0, sampleRequest.parameter],
          pa: 3,
          pb: 3,
          delta: 0,
          tolerance: INVARIANCE_DISTANCE_TOLERANCE,
          toleranceVersion: INVARIANCE_DISTANCE_TOLERANCE_VERSION,
          positionVersion: INVARIANCE_POSITION_VERSION,
          pass: true,
          revision: sampleRequest.revision,
        };
      },
    });
    const input: RunInvarianceTestInput = {
      candidateLine: "studentLine",
      revision: 7,
      evidenceIds: [
        "evidence-r7-perpendicular",
        "evidence-r7-passes_midpoint",
      ],
    };

    await expect(operation.start(input).result).resolves.toMatchObject({
      status: "completed",
      pass: true,
      samples: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }],
    });
    expect(await exactState(h)).toEqual(before);
    expect(h.service.lastReport).toMatchObject({
      runId: "delegate-run",
      namespace: "gtInv_delegate_run_",
      status: "completed",
      restoration: "cleanup",
      helpers: ["gtInv_delegate_run_P"],
    });
    expect(h.api.setBase64).not.toHaveBeenCalled();
    expectListenersRestored(h);
  });
});

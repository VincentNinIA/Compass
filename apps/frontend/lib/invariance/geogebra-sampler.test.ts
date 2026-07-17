import { describe, expect, it, vi } from "vitest";

import { CompletedActionBridge } from "@/lib/geogebra/action-bridge";
import { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import { CheckpointService } from "@/lib/geogebra/checkpoint";
import { SceneRegistry } from "@/lib/geogebra/scene";
import { SnapshotService } from "@/lib/geogebra/snapshot";
import type {
  BisectorValidation,
  GeoGebraApi,
  GeoGebraAppletParameters,
  SceneObject,
} from "@/types/geogebra";
import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_POSITION_VERSION,
  INVARIANCE_SAMPLE_PARAMETERS,
  type RunInvarianceTestInput,
} from "./contracts";
import {
  GeoGebraInvarianceSampler,
  INVARIANCE_MAX_STABILITY_READS,
  INVARIANCE_STABILITY_VERSION,
} from "./geogebra-sampler";
import { InvarianceSceneService } from "./invariance-scene";
import { RunInvarianceTestOperation } from "./run-invariance-test";

const REVISION = 11;
const CANDIDATE = "candidateLine";
const INPUT_EVIDENCE_IDS = Object.freeze([
  "evidence-r11-perpendicular",
  "evidence-r11-passes_midpoint",
] as const);
const INPUT: RunInvarianceTestInput = Object.freeze({
  candidateLine: CANDIDATE,
  revision: REVISION,
  evidenceIds: INPUT_EVIDENCE_IDS,
});
const BASELINE_OBJECTS: SceneObject[] = [
  { name: "A", owner: "exercise", kind: "point" },
  { name: "AB", owner: "exercise", kind: "segment" },
  { name: "B", owner: "exercise", kind: "point" },
  { name: CANDIDATE, owner: "student", kind: "line" },
];

type HarnessOptions = Readonly<{
  lineX?: number;
  forceNaN?: boolean;
  forceOffLine?: boolean;
  forceUnstable?: boolean;
  fixedDistances?: readonly [number, number];
  maxStabilityReads?: number;
  onWait?(count: number): Promise<void> | void;
}>;

type NumberDefinition = Readonly<{
  point: string;
  target: "A" | "B" | "candidate";
}>;

async function harness(options: HarnessOptions = {}) {
  const lineX = options.lineX ?? 0;
  let parameters: GeoGebraAppletParameters | undefined;
  let commands = new Map<string, string>([
    ["A", "(-3,0)"],
    ["B", "(3,0)"],
    ["AB", "Segment(A,B)"],
    [CANDIDATE, `PerpendicularLine((${lineX},0),AB)`],
  ]);
  let points = new Map<string, readonly [number, number]>([
    ["A", [-3, 0]],
    ["B", [3, 0]],
  ]);
  let vectors = new Map<string, readonly [number, number]>();
  let pointPaths = new Map<string, string>();
  let numbers = new Map<string, NumberDefinition>();
  let unstableRead = 0;
  let unstableOffset = 0;
  let waitCount = 0;
  const listeners = {
    client: new Set<unknown>(),
    add: new Set<(name: string) => void>(),
    remove: new Set<(name: string) => void>(),
    update: new Set<(name: string) => void>(),
  };
  const setCoords = vi.fn((name: string, x: number, y: number) => {
    const path = pointPaths.get(name);
    points.set(name, [
      path === CANDIDATE
        ? lineX + (options.forceOffLine ? 0.25 : 0)
        : x,
      y,
    ]);
    for (const listener of listeners.update) listener(name);
  });
  const api: GeoGebraApi = {
    evalCommand: vi.fn((command) => {
      const separator = command.indexOf("=");
      const name = command.slice(0, separator).trim();
      const expression = command.slice(separator + 1).trim();
      commands.set(name, expression);
      const pointMatch = expression.match(/^Point\(candidateLine\)$/);
      const originMatch = expression.match(
        /^ClosestPoint\(candidateLine,\s*Midpoint\(A,\s*B\)\)$/,
      );
      const directionMatch = expression.match(/^UnitVector\(candidateLine\)$/);
      const distanceMatch = expression.match(
        /^Distance\(([^,]+),\s*(A|B|candidateLine)\)$/,
      );
      if (pointMatch) {
        points.set(name, [lineX, 0]);
        pointPaths.set(name, CANDIDATE);
      } else if (originMatch) {
        points.set(name, [lineX, 0]);
      } else if (directionMatch) {
        vectors.set(name, [0, 1]);
      } else if (distanceMatch) {
        numbers.set(name, {
          point: distanceMatch[1],
          target:
            distanceMatch[2] === CANDIDATE
              ? "candidate"
              : distanceMatch[2] as "A" | "B",
        });
      }
      for (const listener of listeners.add) listener(name);
      return Boolean(pointMatch || originMatch || directionMatch || distanceMatch);
    }),
    exists: vi.fn((name) => commands.has(name)),
    isDefined: vi.fn((name) => commands.has(name)),
    deleteObject: vi.fn((name) => {
      commands.delete(name);
      points.delete(name);
      vectors.delete(name);
      pointPaths.delete(name);
      numbers.delete(name);
      for (const listener of listeners.remove) listener(name);
    }),
    getAllObjectNames: vi.fn(() => [...commands.keys()]),
    getObjectNumber: vi.fn(() => commands.size),
    getObjectName: vi.fn((index) => [...commands.keys()][index] ?? ""),
    getCommandString: vi.fn((name) => commands.get(name) ?? ""),
    getObjectType: vi.fn((name) => {
      if (points.has(name)) return "point";
      if (vectors.has(name)) return "vector";
      if (numbers.has(name)) return "numeric";
      if (name === "AB") return "segment";
      return "line";
    }),
    getXcoord: vi.fn((name) => {
      if (options.forceUnstable && name.endsWith("_P")) {
        unstableRead += 1;
        unstableOffset = unstableRead % 2 === 0 ? 0.01 : -0.01;
      } else {
        unstableOffset = 0;
      }
      return points.get(name)?.[0] ?? vectors.get(name)?.[0] ?? Number.NaN;
    }),
    getYcoord: vi.fn((name) =>
      (points.get(name)?.[1] ?? vectors.get(name)?.[1] ?? Number.NaN) +
      (options.forceUnstable && name.endsWith("_P") ? unstableOffset : 0),
    ),
    getValue: vi.fn((name) => {
      const definition = numbers.get(name);
      if (!definition) return Number.NaN;
      if (options.forceNaN && definition.target === "A") return Number.NaN;
      if (options.fixedDistances) {
        if (name.endsWith("_PA")) return options.fixedDistances[0];
        if (name.endsWith("_PB")) return options.fixedDistances[1];
      }
      const point = points.get(definition.point);
      if (!point) return Number.NaN;
      if (definition.target === "candidate") return Math.abs(point[0] - lineX);
      const target = points.get(definition.target);
      if (!target) return Number.NaN;
      return Math.hypot(point[0] - target[0], point[1] - target[1]);
    }),
    setCoords,
    getBase64: vi.fn((callback) =>
      callback(JSON.stringify([...commands.entries()])),
    ),
    setBase64: vi.fn((base64, callback) => {
      commands = new Map(JSON.parse(base64) as [string, string][]);
      points = new Map([
        ["A", [-3, 0]],
        ["B", [3, 0]],
      ]);
      pointPaths = new Map();
      vectors = new Map();
      numbers = new Map();
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
  const bridge = new CompletedActionBridge(
    adapter,
    registry,
    snapshots,
    vi.fn(),
  );
  const started = bridge.start();
  if (!started.ok) throw new Error(started.error.message);
  const scene = new InvarianceSceneService(
    adapter,
    registry,
    snapshots,
    new CheckpointService(adapter, registry, snapshots, bridge),
    bridge,
  );
  const sampler = new GeoGebraInvarianceSampler(adapter, {
    maxStabilityReads: options.maxStabilityReads,
    waitForNextRead: async () => {
      waitCount += 1;
      await options.onWait?.(waitCount);
    },
  });
  let currentValidation = validation();
  const operation = new RunInvarianceTestOperation({
    createRunId: () => "t5-c03-run",
    getCurrentValidation: () => currentValidation,
    runInTemporaryScene: (request, execute) => scene.run(request, execute),
    sample: (request) => sampler.sample(request),
  });
  return {
    adapter,
    api,
    commands: () => commands,
    get waitCount() {
      return waitCount;
    },
    operation,
    registry,
    scene,
    setCoords,
    setValidation(value: BisectorValidation) {
      currentValidation = value;
    },
  };
}

function validation(
  overrides: Partial<BisectorValidation> = {},
): BisectorValidation {
  return {
    candidate: CANDIDATE,
    revision: REVISION,
    score: 2,
    evidence: [
      {
        id: INPUT_EVIDENCE_IDS[0],
        relation: "perpendicular",
        pass: true,
        observed: 1,
        tolerance: 0,
        revision: REVISION,
        objects: [CANDIDATE, "AB"],
      },
      {
        id: INPUT_EVIDENCE_IDS[1],
        relation: "passes_midpoint",
        pass: true,
        observed: 0,
        tolerance: 1e-6,
        revision: REVISION,
        objects: [CANDIDATE, "A", "B"],
      },
    ],
    ...overrides,
  };
}

describe("T5-C03 GeoGebra invariance sampling", () => {
  it("integrates C01 order and C02 cleanup into five complete correlated samples", async () => {
    const h = await harness();

    const result = await h.operation.start(INPUT).result;

    expect(result).toMatchObject({ status: "completed", pass: true });
    expect(result.samples).toHaveLength(5);
    expect(result.samples.map(({ parameter }) => parameter)).toEqual(
      INVARIANCE_SAMPLE_PARAMETERS,
    );
    expect(result.samples.map(({ coords }) => coords)).toEqual([
      [0, -6],
      [0, -3],
      [0, 0],
      [0, 3],
      [0, 6],
    ]);
    expect(result.samples.every(({ delta, pass }) => delta === 0 && pass)).toBe(
      true,
    );
    expect(
      result.samples.every(
        ({ tolerance, toleranceVersion }) =>
          tolerance === INVARIANCE_DISTANCE_TOLERANCE &&
          toleranceVersion === INVARIANCE_DISTANCE_TOLERANCE_VERSION,
      ),
    ).toBe(true);
    expect(new Set(result.evidenceIds).size).toBe(5);
    expect(h.setCoords.mock.calls).toEqual([
      ["gtInv_t5_c03_run_P", 0, -6],
      ["gtInv_t5_c03_run_P", 0, -3],
      ["gtInv_t5_c03_run_P", 0, 0],
      ["gtInv_t5_c03_run_P", 0, 3],
      ["gtInv_t5_c03_run_P", 0, 6],
    ]);
    expect([...h.commands().keys()].sort()).toEqual(
      ["A", "AB", "B", CANDIDATE].sort(),
    );
    expect(h.registry.list()).toEqual(BASELINE_OBJECTS);
    expect(h.api.setBase64).not.toHaveBeenCalled();
    expect(h.scene.lastReport).toMatchObject({
      status: "completed",
      restoration: "cleanup",
      restored: true,
      helpers: [
        "gtInv_t5_c03_run_P",
        "gtInv_t5_c03_run_PA",
        "gtInv_t5_c03_run_PB",
        "gtInv_t5_c03_run_PCandidate",
        "gtInv_t5_c03_run_Origin",
        "gtInv_t5_c03_run_Direction",
        "gtInv_t5_c03_run_Scale",
      ],
    });
    expect(INVARIANCE_STABILITY_VERSION).toBe("two-consecutive-reads-v1");
    expect(INVARIANCE_MAX_STABILITY_READS).toBe(8);
    expect(result.samples.every(({ positionVersion }) =>
      positionVersion === INVARIANCE_POSITION_VERSION)).toBe(true);
  });

  it.each([
    [INVARIANCE_DISTANCE_TOLERANCE, true],
    [INVARIANCE_DISTANCE_TOLERANCE + Number.EPSILON, false],
  ] as const)(
    "applies the absolute tolerance boundary %s deterministically",
    async (pb, expectedPass) => {
      const h = await harness({ fixedDistances: [0, pb] });

      const result = await h.operation.start(INPUT).result;

      expect(result).toMatchObject({
        status: "completed",
        pass: expectedPass,
      });
      expect(result.samples).toHaveLength(5);
      expect(
        result.samples.every(
          ({ delta, pass }) => delta === pb && pass === expectedPass,
        ),
      ).toBe(true);
    },
  );

  it("completes safely with 0/5 when the candidate is not a perpendicular bisector", async () => {
    const h = await harness({ lineX: 1 });

    const result = await h.operation.start(INPUT).result;

    expect(result).toMatchObject({ status: "completed", pass: false });
    expect(result.samples).toHaveLength(5);
    expect(result.samples.every(({ pass }) => !pass)).toBe(true);
    expect(h.api.setBase64).not.toHaveBeenCalled();
    expect([...h.commands().keys()].sort()).toEqual(
      ["A", "AB", "B", CANDIDATE].sort(),
    );
  });

  it("fails all-or-nothing on NaN and restores the C02 checkpoint", async () => {
    const h = await harness({ forceNaN: true });

    const result = await h.operation.start(INPUT).result;

    expect(result).toMatchObject({
      status: "failed",
      pass: false,
      samples: [],
      evidenceIds: [],
      error: { code: "sample_execution_failed" },
    });
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.scene.lastReport).toMatchObject({
      status: "failed",
      restoration: "checkpoint",
      restored: true,
    });
  });

  it("fails all-or-nothing when P is moved off candidateLine", async () => {
    const h = await harness({ forceOffLine: true });

    const result = await h.operation.start(INPUT).result;

    expect(result).toMatchObject({
      status: "failed",
      samples: [],
      evidenceIds: [],
      error: { code: "sample_execution_failed" },
    });
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.scene.lastReport).toMatchObject({ restored: true });
  });

  it("bounds stability reads and restores after an unstable applet", async () => {
    const h = await harness({ forceUnstable: true, maxStabilityReads: 4 });

    const result = await h.operation.start(INPUT).result;

    expect(result).toMatchObject({
      status: "failed",
      samples: [],
      evidenceIds: [],
      error: { code: "sample_execution_failed" },
    });
    expect(h.waitCount).toBe(3);
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
  });

  it("fails safe when authority becomes stale during stabilization", async () => {
    let expireAuthority: () => void = () => undefined;
    const h = await harness({
      onWait: () => expireAuthority(),
    });
    expireAuthority = () => h.setValidation(validation({ revision: REVISION + 1 }));

    const result = await h.operation.start(INPUT).result;

    expect(result).toMatchObject({
      status: "failed",
      samples: [],
      evidenceIds: [],
      error: { code: "sample_execution_failed" },
    });
    expect(h.setCoords).toHaveBeenCalledTimes(1);
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.scene.lastReport).toMatchObject({ restored: true });
  });

  it("cancels during stabilization without publishing a partial sample", async () => {
    let releaseWait: (() => void) | undefined;
    const h = await harness({
      onWait: () => new Promise<void>((resolve) => {
        releaseWait = resolve;
      }),
    });
    const handle = h.operation.start(INPUT);
    await vi.waitFor(() => expect(releaseWait).toBeDefined());

    expect(handle.cancel("student_drag")).toBe(true);
    releaseWait?.();

    await expect(handle.result).resolves.toMatchObject({
      status: "cancelled",
      reason: "student_drag",
      samples: [],
      evidenceIds: [],
      pass: false,
    });
    expect(h.api.setBase64).toHaveBeenCalledTimes(1);
    expect(h.scene.lastReport).toMatchObject({
      status: "cancelled",
      restoration: "checkpoint",
      restored: true,
    });
  });
});

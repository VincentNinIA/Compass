import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import { SceneRegistry } from "@/lib/geogebra/scene";
import type { SnapshotService } from "@/lib/geogebra/snapshot";
import type { PerpendicularBisectorValidator } from "@/lib/geogebra/validator";
import type { GeoGebraApi } from "@/types/geogebra";
import { ToolGateway, type GatewayContext } from "./gateway";
import { createCoreToolHandlers } from "./handlers";
import { HighlightManager } from "./highlight";
import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";

const CONFIRMED_PLAN_ID = "demo-perpendicular-bisector-01";
const CONFIRMED_PLAN = deriveExercisePlanV1({
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

function fixture(options: { confirmed?: boolean; rejectLabel?: string } = {}) {
  const registry = new SceneRegistry();
  const commands = new Map<string, string>();
  const colors = new Map<string, string>();
  const deleted: string[] = [];
  const api: GeoGebraApi = {
    evalCommand: vi.fn((command) => {
      const label = command.split("=")[0].trim();
      if (label === options.rejectLabel) return false;
      commands.set(label, command.split("=").slice(1).join("=").trim());
      colors.set(label, "#112233");
      return true;
    }),
    exists: (label) => commands.has(label),
    isDefined: (label) => commands.has(label),
    getCommandString: (label) => commands.get(label) ?? "",
    getColor: (label) => colors.get(label) ?? "#112233",
    setColor: vi.fn((label, red, green, blue) => {
      colors.set(label, `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`);
    }),
    deleteObject: (label) => {
      deleted.push(label);
      commands.delete(label);
      colors.delete(label);
    },
    setCoordSystem: vi.fn(),
    setFixed: vi.fn(),
    setLabelVisible: vi.fn(),
  };
  const adapter = {
    withApi<T>(operation: (value: GeoGebraApi) => T) {
      return { ok: true as const, value: operation(api) };
    },
  } as GeoGebraAdapter;
  const snapshot = {
    revision: 4,
    hash: "fnv1a32:12345678",
    complete: true,
    objects: [
      { name: "A", owner: "system", kind: "point", command: "(-2,0)" },
      { name: "AB", owner: "system", kind: "segment", command: "Segment(A,B)" },
      { name: "B", owner: "system", kind: "point", command: "(2,0)" },
      { name: "d", owner: "student", kind: "line", command: "PerpendicularLine(A,AB)" },
    ],
  } as const;
  const snapshots = { capture: vi.fn(() => ({ ok: true, value: snapshot })) } as unknown as SnapshotService;
  const validator = {
    validate: vi.fn((revision: number, candidate: string) => ({
      ok: true,
      value: {
        candidate,
        revision,
        score: 2,
        evidence: [
          { id: `evidence-r${revision}-perpendicular`, relation: "perpendicular", pass: true, observed: 1, tolerance: 0, revision, objects: [candidate, "AB"] },
          { id: `evidence-r${revision}-passes_midpoint`, relation: "passes_midpoint", pass: true, observed: 0, tolerance: 1e-6, revision, objects: [candidate, "A", "B"] },
        ],
      },
    })),
  } as unknown as PerpendicularBisectorValidator;
  const highlights = new HighlightManager(adapter, registry);
  const confirmation = {
    confirmationId: "confirmation-1",
    confirmedAt: 1,
    plan: CONFIRMED_PLAN,
  } satisfies ExerciseConfirmedV1;
  const initializeExercise = vi.fn(async () =>
    options.rejectLabel
      ? { status: "failed" as const, code: "creation_failed", rolledBack: true }
      : {
          status: "initialized" as const,
          planId: CONFIRMED_PLAN_ID,
          snapshotHash: "fnv1a32:exercise",
          created: ["A", "B", "AB"] as ["A", "B", "AB"],
        },
  );
  const handlers = createCoreToolHandlers({
    adapter,
    registry,
    snapshots,
    validator,
    getConfirmedExercise: (planId) =>
      options.confirmed && planId === CONFIRMED_PLAN_ID ? confirmation : undefined,
    initializeExercise,
    highlights,
  });
  return { registry, commands, colors, deleted, api, adapter, snapshots, validator, highlights, handlers, initializeExercise };
}

const constructing: GatewayContext = { turnId: "turn-1", phase: "constructing", revision: 4 };

function seedConstruction(test: ReturnType<typeof fixture>) {
  for (const object of [
    { name: "A", owner: "system" as const, kind: "point" as const },
    { name: "B", owner: "system" as const, kind: "point" as const },
    { name: "AB", owner: "system" as const, kind: "segment" as const },
    { name: "d", owner: "student" as const, kind: "line" as const },
  ]) {
    test.registry.register(object.name, object.owner, object.kind);
    test.commands.set(object.name, object.name);
    test.colors.set(object.name, "#112233");
  }
}

describe("core tool handlers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads a canonical snapshot with a correlated evidence ID", async () => {
    const test = fixture();
    seedConstruction(test);
    const gateway = new ToolGateway(test.handlers);
    const result = await gateway.execute(
      { callId: "read-1", name: "read_construction", arguments: '{"revision":4}' },
      constructing,
    );
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      revision: 4,
      evidenceIds: ["snapshot-r4-fnv1a32:12345678"],
    }));
  });

  it.each(["perpendicular", "passes_midpoint"] as const)(
    "returns only the deterministic %s evidence",
    async (relation) => {
      const test = fixture();
      seedConstruction(test);
      const gateway = new ToolGateway(test.handlers);
      const result = await gateway.execute(
        {
          callId: `check-${relation}`,
          name: "check_relation",
          arguments: JSON.stringify({ relation, objects: relation === "perpendicular" ? ["d", "AB"] : ["d", "A", "B"], revision: 4 }),
        },
        constructing,
      );
      expect(result).toEqual(expect.objectContaining({
        ok: true,
        evidenceIds: [`evidence-r4-${relation}`],
        data: expect.objectContaining({ relation, pass: true, revision: 4 }),
      }));
    },
  );

  it("initializes only a confirmed plan and creates no solution object", async () => {
    const denied = fixture();
    const deniedGateway = new ToolGateway(denied.handlers);
    expect(await deniedGateway.execute(
      { callId: "init-denied", name: "initialize_exercise", arguments: `{"planId":"${CONFIRMED_PLAN_ID}","expectedRevision":4}` },
      { ...constructing, phase: "exercise_confirmed" },
    )).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "plan_unconfirmed" }) }));
    expect(denied.api.evalCommand).not.toHaveBeenCalled();

    const allowed = fixture({ confirmed: true });
    const allowedGateway = new ToolGateway(allowed.handlers);
    const result = await allowedGateway.execute(
      { callId: "init-ok", name: "initialize_exercise", arguments: `{"planId":"${CONFIRMED_PLAN_ID}","expectedRevision":4}` },
      { ...constructing, phase: "exercise_confirmed" },
    );
    expect(result.ok).toBe(true);
    expect(allowed.initializeExercise).toHaveBeenCalledTimes(1);
    expect(allowed.api.evalCommand).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        status: "initialized",
        objects: ["A", "B", "AB"],
        snapshotHash: "fnv1a32:exercise",
      }),
    }));
  });

  it("rolls back a partial initialization failure", async () => {
    const test = fixture({ confirmed: true, rejectLabel: "B" });
    const gateway = new ToolGateway(test.handlers);
    const result = await gateway.execute(
      { callId: "init-fail", name: "initialize_exercise", arguments: `{"planId":"${CONFIRMED_PLAN_ID}","expectedRevision":4}` },
      { ...constructing, phase: "exercise_confirmed" },
    );
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "rollback_failed" }) }));
    expect(test.initializeExercise).toHaveBeenCalledTimes(1);
    expect(test.api.evalCommand).not.toHaveBeenCalled();
  });

  it("highlights temporarily, restores color and never changes object inventory", async () => {
    const test = fixture();
    seedConstruction(test);
    const gateway = new ToolGateway(test.handlers);
    const before = [...test.commands.keys()].sort();
    const result = await gateway.execute(
      { callId: "highlight-1", name: "highlight_objects", arguments: '{"names":["A","AB"],"style":"hint","ttlMs":500,"revision":4}' },
      constructing,
    );
    expect(result.ok).toBe(true);
    expect(test.colors.get("A")).toBe("#f59e0b");
    expect([...test.commands.keys()].sort()).toEqual(before);
    await vi.advanceTimersByTimeAsync(500);
    expect(test.colors.get("A")).toBe("#112233");
    expect(test.colors.get("AB")).toBe("#112233");
  });

  it("rejects absent and already highlighted objects without a second mutation", async () => {
    const test = fixture();
    seedConstruction(test);
    const gateway = new ToolGateway(test.handlers, { maxMutationsPerTurn: 3 });
    const missing = await gateway.execute(
      { callId: "missing", name: "highlight_objects", arguments: '{"names":["Z"],"style":"focus","ttlMs":500,"revision":4}' },
      constructing,
    );
    expect(missing).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "object_missing" }) }));
    await gateway.execute(
      { callId: "active-1", name: "highlight_objects", arguments: '{"names":["A"],"style":"focus","ttlMs":500,"revision":4}' },
      constructing,
    );
    const overlapping = await gateway.execute(
      { callId: "active-2", name: "highlight_objects", arguments: '{"names":["A"],"style":"hint","ttlMs":500,"revision":4}' },
      constructing,
    );
    expect(overlapping).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "highlight_active" }) }));
    expect(test.api.setColor).toHaveBeenCalledTimes(1);
  });
});

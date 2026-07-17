import { describe, expect, it, vi } from "vitest";

import { SceneRegistry } from "@/lib/geogebra/scene";
import type { GatewayContext } from "@/lib/tools/gateway";
import type { GeoGebraApi } from "@/types/geogebra";

import { GeometryActionGatewayV1 } from "./action-gateway";
import type { GeometryActionAuthorityV1 } from "./authority";
import { GeometryConsentTokenStoreV1 } from "./consent";
import { GeometryWorldV2, type GeometryWorldObjectV2 } from "./contracts";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

const activityId = VARIGNON_ACTIVITY_FR_V1.id;
const common = { activityId, epoch: 1, revision: 2 } as const;

describe("GeometryActionGatewayV1", () => {
  it("rejects malformed, stale and unauthorized calls before touching the API", async () => {
    const fixture = gatewayFixture();
    const malformed = await fixture.gateway.execute(
      call("activate_geometry_tool", {
        ...common,
        tool: "midpoint",
        command: "Midpoint(A,B)",
      }),
      context(),
    );
    const stale = await fixture.gateway.execute(
      call("inspect_geometry_workspace", {
        ...common,
        revision: 1,
        scope: "all",
        names: [],
      }),
      context(),
    );
    fixture.authority.missionId = "V6";
    const notAllowed = await fixture.gateway.execute(
      call(
        "activate_geometry_tool",
        { ...common, tool: "midpoint" },
        "call-activate-not-allowed",
      ),
      context(),
    );
    expect(malformed).toMatchObject({ ok: false, error: { code: "invalid_arguments" } });
    expect(stale).toMatchObject({ ok: false, error: { code: "stale_revision" } });
    expect(notAllowed).toMatchObject({ ok: false, error: { code: "action_not_allowed" } });
    expect(fixture.apiCalls()).toBe(0);
  });

  it("enforces four reads and two reversible UI actions per turn", async () => {
    const fixture = gatewayFixture();
    for (let index = 0; index < 4; index += 1) {
      expect(
        await fixture.gateway.execute(
          call("inspect_geometry_workspace", {
            ...common,
            scope: "all",
            names: [],
          }, `read-${index}`),
          context("same-turn"),
        ),
      ).toMatchObject({ ok: true });
    }
    expect(
      await fixture.gateway.execute(
        call(
          "inspect_geometry_workspace",
          { ...common, scope: "all", names: [] },
          "read-5",
        ),
        context("same-turn"),
      ),
    ).toMatchObject({ ok: false, error: { code: "budget_exceeded" } });

    expect(
      await fixture.gateway.execute(
        call("activate_geometry_tool", { ...common, tool: "midpoint" }, "ui-1"),
        context("ui-turn"),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await fixture.gateway.execute(
        call("activate_geometry_tool", { ...common, tool: "move" }, "ui-2"),
        context("ui-turn"),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await fixture.gateway.execute(
        call("activate_geometry_tool", { ...common, tool: "segment" }, "ui-3"),
        context("ui-turn"),
      ),
    ).toMatchObject({ ok: false, error: { code: "budget_exceeded" } });
  });

  it("returns bounded inspection and current deterministic evidence only", async () => {
    const fixture = gatewayFixture();
    const inspection = await fixture.gateway.execute(
      call("inspect_geometry_workspace", {
        ...common,
        scope: "selection",
        names: ["A", "B"],
      }),
      context(),
    );
    const relation = await fixture.gateway.execute(
      call("check_geometry_relation", {
        ...common,
        relationId: "rel_midpoint_e",
      }),
      context("relation-turn"),
    );
    expect(inspection).toMatchObject({
      ok: true,
      data: {
        activityId,
        epoch: 1,
        revision: 2,
        selection: ["A", "B"],
      },
    });
    expect((inspection as { data: { objects: unknown[] } }).data.objects).toHaveLength(2);
    expect(relation).toMatchObject({
      ok: true,
      data: {
        relationId: "rel_midpoint_e",
        status: "pass",
        pass: true,
        evidenceId: "rel_midpoint_e",
      },
      evidenceIds: ["rel_midpoint_e"],
    });
  });

  it("classifies the declared ordered polygon with revision-bound evidence", async () => {
    const fixture = gatewayFixture();
    fixture.authority.missionId = "V3";
    fixture.authority.maxLevel = "O0";
    const result = await fixture.gateway.execute(
      call("classify_geometry_configuration", {
        ...common,
        labels: ["A", "B", "C", "D"],
      }),
      context(),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        type: "convex",
        toleranceVersion: "ordered-quadrilateral-v1",
        epoch: 1,
        revision: 2,
        snapshotHash: "world-hash",
        evidenceId: "rel_configuration_convex",
      },
    });
  });

  it("rejects a variation without current consent before any GeoGebra read", async () => {
    const fixture = gatewayFixture();
    authorizeVariation(fixture.authority, "concave");
    const result = await fixture.gateway.execute(
      call("create_geometry_variation", {
        ...common,
        target: "concave",
        movingPoint: "A",
        consentToken: "ggb-consent:missing-token-0000",
      }),
      context(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "consent_required" } });
    expect(fixture.apiCalls()).toBe(0);
  });

  it("applies one deterministic consented variation, hides coordinates and is idempotent", async () => {
    const fixture = gatewayFixture();
    authorizeVariation(fixture.authority, "concave");
    const token = fixture.tokens.issue({
      ...common,
      action: "create_geometry_variation",
      target: "concave",
      movingPoint: "A",
    });
    const variationCall = call(
      "create_geometry_variation",
      { ...common, target: "concave", movingPoint: "A", consentToken: token },
      "variation-once",
    );
    const first = await fixture.gateway.execute(variationCall, context());
    const mutationsAfterFirst = fixture.setCoords.mock.calls.length;
    const repeated = await fixture.gateway.execute(variationCall, context());
    expect(first).toMatchObject({
      ok: true,
      revision: 3,
      data: {
        status: "applied",
        target: "concave",
        configuration: "concave",
        movingPoint: "A",
        coordinateStrategy: "deterministic-grid-v1",
        evidenceCreated: false,
      },
    });
    expect(first).not.toHaveProperty("data.x");
    expect(first).not.toHaveProperty("data.y");
    expect(repeated).toEqual(first);
    expect(fixture.setCoords).toHaveBeenCalledTimes(mutationsAfterFirst);

    const replayWithNewCallId = await fixture.gateway.execute(
      { ...variationCall, callId: "variation-token-reuse" },
      context("second-turn"),
    );
    expect(replayWithNewCallId).toMatchObject({
      ok: false,
      error: { code: "consent_invalid" },
    });
  });

  it("quarantines a learner drag during variation and restores the original point", async () => {
    let generation = 0;
    let assistantMutation = true;
    const fixture = gatewayFixture({
      getInteractionGeneration: () => generation,
      onSetCoords: () => {
        if (assistantMutation) {
          generation += 1;
          assistantMutation = false;
        }
      },
    });
    authorizeVariation(fixture.authority, "crossed");
    const token = fixture.tokens.issue({
      ...common,
      action: "create_geometry_variation",
      target: "crossed",
      movingPoint: "A",
    });
    const before = fixture.point("A");
    const result = await fixture.gateway.execute(
      call("create_geometry_variation", {
        ...common,
        target: "crossed",
        movingPoint: "A",
        consentToken: token,
      }),
      context(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "rejected_stale" } });
    expect(fixture.point("A")).toEqual(before);
    expect(fixture.gateway.isMutationFrozen()).toBe(false);
  });

  it("initializes only the approved scaffold transaction on an empty canvas", async () => {
    const fixture = gatewayFixture({ empty: true });
    Object.assign(fixture.authority, {
      phase: "confirmed",
      actor: "system",
      maxLevel: "O5",
      missionId: undefined,
      epoch: 1,
      revision: 0,
    });
    const result = await fixture.gateway.execute(
      call("initialize_geometry_activity", {
        activityId,
        epoch: 1,
        revision: 0,
        scaffoldVersion: "varignon-scaffold.v1",
      }),
      context("init-turn", 0),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "initialized",
        scaffoldVersion: "varignon-scaffold.v1",
        baseline: { inventory: ["A", "B", "C", "D", "AB", "BC", "CD", "DA"] },
        checkpoint: { version: "geometry-scaffold-checkpoint.v1" },
        evidence: { kind: "activity_initialized" },
      },
    });
    expect(fixture.registry.list()).toHaveLength(8);
    expect(fixture.registry.list().every(({ owner }) => owner === "scaffold")).toBe(true);
  });
});

type MutableAuthority = Omit<GeometryActionAuthorityV1, "isCurrent"> & {
  phase: GeometryActionAuthorityV1["phase"];
  actor: GeometryActionAuthorityV1["actor"];
  maxLevel: GeometryActionAuthorityV1["maxLevel"];
  missionId?: string;
  attemptedVariationTargets: ("convex" | "concave" | "crossed")[];
};

function gatewayFixture(
  options: {
    empty?: boolean;
    getInteractionGeneration?: () => number;
    onSetCoords?: () => void;
  } = {},
) {
  const objects = new Map<string, FakeObject>();
  if (!options.empty) {
    for (const object of worldObjects()) {
      objects.set(object.name, {
        name: object.name,
        type: object.type,
        command: object.command,
        x: object.x,
        y: object.y,
        color: "#000000",
        thickness: 2,
        visible: true,
      });
    }
  }
  let apiCalls = 0;
  let mode = 0;
  const count = <T extends (...arguments_: never[]) => unknown>(operation: T) =>
    ((...arguments_: Parameters<T>) => {
      apiCalls += 1;
      return operation(...arguments_);
    }) as T;
  const setCoords = vi.fn((name: string, x: number, y: number) => {
    const object = objects.get(name);
    if (!object) return;
    object.x = x;
    object.y = y;
    object.command = `${name}=(${x},${y})`;
    options.onSetCoords?.();
  });
  const api: GeoGebraApi = {
    deleteObject: count((name: string) => {
      objects.delete(name);
    }),
    evalCommand: count((command: string) => {
      const [name] = command.split("=");
      if (!name || objects.has(name)) return false;
      const point = /^([A-D])=\((-?[\d.]+),(-?[\d.]+)\)$/.exec(command);
      objects.set(name, {
        name,
        type: point ? "point" : "segment",
        command,
        ...(point ? { x: Number(point[2]), y: Number(point[3]) } : {}),
        color: "#000000",
        thickness: 2,
        visible: true,
      });
      return true;
    }),
    exists: count((name: string) => objects.has(name)),
    getAllObjectNames: count(() => [...objects.keys()]),
    getColor: count((name: string) => objects.get(name)?.color ?? "#000000"),
    getCommandString: count((name: string) => objects.get(name)?.command ?? ""),
    getLineThickness: count((name: string) => objects.get(name)?.thickness ?? 2),
    getMode: count(() => mode),
    getVisible: count((name: string) => objects.get(name)?.visible ?? false),
    getViewProperties: count(() => ({ xMin: -5, xMax: 5, yMin: -3, yMax: 3 })),
    getXcoord: count((name: string) => objects.get(name)?.x ?? Number.NaN),
    getYcoord: count((name: string) => objects.get(name)?.y ?? Number.NaN),
    isDefined: count((name: string) => objects.has(name)),
    isIndependent: count((name: string) => ["A", "B", "C", "D"].includes(name)),
    isMoveable: count((name: string) => ["A", "B", "C", "D"].includes(name)),
    setColor: count((name: string, red: number, green: number, blue: number) => {
      const object = objects.get(name);
      if (object) {
        object.color = `#${[red, green, blue]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")}`.toUpperCase();
      }
    }),
    setCoords: count(setCoords),
    setCoordSystem: count(() => undefined),
    setFixed: count(() => undefined),
    setLabelVisible: count(() => undefined),
    setLineThickness: count((name: string, thickness: number) => {
      const object = objects.get(name);
      if (object) object.thickness = thickness;
    }),
    setMode: count((next: number) => {
      mode = next;
    }),
    setVisible: count((name: string, visible: boolean) => {
      const object = objects.get(name);
      if (object) object.visible = visible;
    }),
  };
  const registry = new SceneRegistry();
  for (const object of objects.values()) {
    registry.register(object.name, object.name.length === 1 ? "scaffold" : "student", object.type === "point" ? "point" : "segment");
  }
  const tokens = new GeometryConsentTokenStoreV1({
    now: () => 1_000,
    createToken: () => "ggb-consent:44444444-4444-4444-4444-444444444444",
  });
  const authority: MutableAuthority = {
    activityId,
    epoch: 1,
    revision: 2,
    phase: "investigating",
    actor: "assistant",
    maxLevel: "O2",
    missionId: "V1",
    uiGuidanceAllowed: true,
    attemptedVariationTargets: [],
  };
  const getWorld = vi.fn(() => makeWorld([...objects.values()], authority.revision));
  const gateway = new GeometryActionGatewayV1({
    api,
    activity: VARIGNON_ACTIVITY_FR_V1,
    registry,
    getAuthority: () => authority,
    getWorld,
    consentTokens: tokens,
    getInteractionGeneration: options.getInteractionGeneration,
  });
  return {
    gateway,
    authority,
    tokens,
    registry,
    setCoords,
    apiCalls: () => apiCalls,
    point(name: string) {
      const object = objects.get(name);
      return { x: object?.x, y: object?.y };
    },
  };
}

function authorizeVariation(
  authority: MutableAuthority,
  target: "convex" | "concave" | "crossed",
) {
  authority.missionId = target === "convex" ? "V3" : target === "concave" ? "V4" : "V5";
  authority.maxLevel = "O3";
  authority.attemptedVariationTargets = [target];
}

function context(turnId = "turn-1", revision = 2): GatewayContext {
  return {
    turnId,
    phase: revision === 0 ? "exercise_confirmed" : "constructing",
    epoch: 1,
    revision,
    isAuthorityCurrent: () => true,
  };
}

function call(name: string, arguments_: unknown, callId = `call-${name}`) {
  return { callId, name, arguments: JSON.stringify(arguments_) };
}

type FakeObject = {
  name: string;
  type: string;
  command: string;
  x?: number;
  y?: number;
  color: string;
  thickness: number;
  visible: boolean;
};

function makeWorld(objects: readonly FakeObject[], revision: number) {
  return GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId,
    epoch: 1,
    revision,
    snapshotHash: "world-hash",
    objectCount: objects.length,
    truncated: false,
    objects: objects.map((object) => ({
      name: object.name,
      type: object.type,
      command: object.command,
      parents: parentsFor(object.command),
      dependencyStatus: "known",
      owner: object.name.length === 1 ? "scaffold" : "student",
      ...(object.x === undefined ? {} : { x: object.x }),
      ...(object.y === undefined ? {} : { y: object.y }),
      color: object.color,
      visible: object.visible,
    })),
    facts: [],
    change: {
      kind: "initial",
      objectNames: [],
      terminal: true,
      actor: "system",
      occurredAt: 1,
    },
  });
}

function parentsFor(command: string): string[] {
  const midpoint = /Midpoint\(([A-D]),([A-D])\)/.exec(command);
  if (midpoint) return [midpoint[1], midpoint[2]];
  const segment = /Segment\(([A-H]),([A-H])\)/.exec(command);
  return segment ? [segment[1], segment[2]] : [];
}

function worldObjects(): GeometryWorldObjectV2[] {
  return [
    point("A", -4, -1, "A=(-4,-1)"),
    point("B", -1, -3, "B=(-1,-3)"),
    point("C", 4, -1, "C=(4,-1)"),
    point("D", 1, 3, "D=(1,3)"),
    point("E", -2.5, -2, "E=Midpoint(A,B)"),
    point("F", 1.5, -2, "F=Midpoint(B,C)"),
    point("G", 2.5, 1, "G=Midpoint(C,D)"),
    point("H", -1.5, 1, "H=Midpoint(D,A)"),
  ];
}

function point(
  name: string,
  x: number,
  y: number,
  command: string,
): GeometryWorldObjectV2 {
  return {
    name,
    type: "point",
    command,
    parents: parentsFor(command),
    dependencyStatus: "known",
    owner: name < "E" ? "scaffold" : "student",
    x,
    y,
    color: "#000000",
    visible: true,
  };
}

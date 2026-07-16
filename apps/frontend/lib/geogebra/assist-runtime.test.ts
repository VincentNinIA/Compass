import { describe, expect, it, vi } from "vitest";

import { GeoGebraAdapter } from "./adapter";
import { GeoGebraAssistRuntime } from "./assist-runtime";
import type {
  GeoGebraApi,
  GeoGebraAppletParameters,
  GeoGebraObjectListener,
} from "@/types/geogebra";

type FakeObject = {
  type: string;
  command: string;
  color?: [number, number, number];
  labelVisible?: boolean;
  x?: number;
  y?: number;
};

async function createHarness() {
  const objects = new Map<string, FakeObject>([
    ["F", { type: "point", command: "F = (0, 0)", x: 0, y: 0 }],
    ["G", { type: "point", command: "G = (3, 2)", x: 3, y: 2 }],
    ["E", { type: "point", command: "E = (-2, 1)", x: -2, y: 1 }],
  ]);
  const addListeners = new Set<GeoGebraObjectListener>();
  const removeListeners = new Set<GeoGebraObjectListener>();
  const updateListeners = new Set<GeoGebraObjectListener>();
  const evalCommand = vi.fn((command: string) => {
    const pointMatch = command.match(
      /^(\w+) = \((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)$/,
    );
    if (pointMatch) {
      const [, label, x, y] = pointMatch;
      objects.set(label, {
        type: "point",
        command,
        x: Number(x),
        y: Number(y),
      });
      for (const listener of addListeners) listener(label);
      return true;
    }
    const match = command.match(
      /^(\w+) = (Line|Ray|Segment|Circle|Polygon)\(([A-Za-z]\w*(?:,[A-Za-z]\w*)+)\)$/,
    );
    if (!match) return false;
    const [, label, operation] = match;
    objects.set(label, { type: operation.toLowerCase(), command });
    for (const listener of addListeners) listener(label);
    return true;
  });
  const api: GeoGebraApi = {
    evalCommand,
    exists: (label) => objects.has(label),
    isDefined: (label) => objects.has(label),
    getAllObjectNames: () => [...objects.keys()],
    getObjectType: (label) => objects.get(label)?.type ?? "",
    getCommandString: (label) => objects.get(label)?.command ?? "",
    getXcoord: (label) => objects.get(label)?.x ?? Number.NaN,
    getYcoord: (label) => objects.get(label)?.y ?? Number.NaN,
    setCoordSystem: vi.fn(),
    setColor: (label, red, green, blue) => {
      const object = objects.get(label);
      if (object) object.color = [red, green, blue];
    },
    setLabelVisible: (label, visible) => {
      const object = objects.get(label);
      if (object) object.labelVisible = visible;
    },
    setCoords: (label, x, y) => {
      const object = objects.get(label);
      if (object) {
        object.x = x;
        object.y = y;
        for (const listener of updateListeners) listener(label);
      }
    },
    renameObject: (oldLabel, newLabel) => {
      const object = objects.get(oldLabel);
      if (!object || objects.has(newLabel)) return false;
      objects.delete(oldLabel);
      objects.set(newLabel, object);
      for (const listener of updateListeners) listener(newLabel);
      return true;
    },
    registerAddListener: (listener) => addListeners.add(listener),
    unregisterAddListener: (listener) => addListeners.delete(listener),
    registerRemoveListener: (listener) => removeListeners.add(listener),
    unregisterRemoveListener: (listener) => removeListeners.delete(listener),
    registerUpdateListener: (listener) => updateListeners.add(listener),
    unregisterUpdateListener: (listener) => updateListeners.delete(listener),
  };
  let parameters: GeoGebraAppletParameters | undefined;
  const adapter = new GeoGebraAdapter({
    loadScript: async () => undefined,
    createApplet: (nextParameters) => {
      parameters = nextParameters;
      return {
        inject: () => parameters?.appletOnLoad(api),
        removeExistingApplet: vi.fn(),
        setHTML5Codebase: vi.fn(),
      };
    },
  });
  const loaded = await adapter.load(document.createElement("div"));
  expect(loaded.ok).toBe(true);
  const runtime = new GeoGebraAssistRuntime(adapter);
  return { adapter, evalCommand, objects, runtime };
}

function call(name: string, callId: string, arguments_: object) {
  return { name, callId, arguments: JSON.stringify(arguments_) };
}

describe("GeoGebraAssistRuntime", () => {
  it("returns a bounded inventory without claiming validation", async () => {
    const { runtime } = await createHarness();
    const context = runtime.toolRuntime.getContext("turn-inspect");
    expect(context).toBeDefined();

    const result = await runtime.toolRuntime.gateway.execute(
      call("inspect_geogebra_workspace", "inspect-1", {}),
      context!,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        objectCount: 3,
        truncated: false,
        note: expect.stringContaining("does not prove"),
      },
    });
  });

  it("creates one green line through existing F and G and is idempotent", async () => {
    const { evalCommand, objects, runtime } = await createHarness();
    const context = runtime.toolRuntime.getContext("turn-line")!;
    const request = call("draw_geogebra_line", "line-1", {
      pointA: "F",
      pointB: "G",
      color: "green",
    });

    const first = await runtime.toolRuntime.gateway.execute(request, context);
    const replay = await runtime.toolRuntime.gateway.execute(request, context);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      ok: true,
      data: {
        kind: "line",
        points: ["F", "G"],
        color: "green",
      },
    });
    expect(evalCommand).toHaveBeenCalledTimes(1);
    expect(evalCommand).toHaveBeenCalledWith(
      "compassLineFG = Line(F,G)",
    );
    expect(objects.get("compassLineFG")).toMatchObject({
      color: [46, 125, 50],
      labelVisible: false,
    });
  });

  it("fails without mutation when a required point is missing", async () => {
    const { evalCommand, objects, runtime } = await createHarness();
    const before = [...objects.keys()];

    const result = await runtime.toolRuntime.gateway.execute(
      call("draw_geogebra_line", "line-missing", {
        pointA: "F",
        pointB: "K",
        color: "blue",
      }),
      runtime.toolRuntime.getContext("turn-missing")!,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "object_missing" },
    });
    expect(evalCommand).not.toHaveBeenCalled();
    expect([...objects.keys()]).toEqual(before);
  });

  it("allows at most one construction mutation per learner turn", async () => {
    const { evalCommand, runtime } = await createHarness();
    const context = runtime.toolRuntime.getContext("same-turn")!;

    const first = await runtime.toolRuntime.gateway.execute(
      call("draw_geogebra_ray", "ray-1", {
        pointA: "E",
        pointB: "F",
        color: "blue",
      }),
      context,
    );
    const second = await runtime.toolRuntime.gateway.execute(
      call("draw_geogebra_segment", "segment-1", {
        pointA: "F",
        pointB: "G",
        color: "red",
      }),
      context,
    );

    expect(first).toMatchObject({ ok: true, data: { kind: "ray" } });
    expect(second).toMatchObject({
      ok: false,
      error: { code: "budget_exceeded" },
    });
    expect(evalCommand).toHaveBeenCalledTimes(1);
    expect(evalCommand).toHaveBeenCalledWith(
      "compassRayEF = Ray(E,F)",
    );
  });

  it("renames an existing object through the closed semantic action", async () => {
    const { objects, runtime } = await createHarness();

    const result = await runtime.toolRuntime.gateway.execute(
      call("rename_geogebra_object", "rename-1", {
        currentName: "E",
        newName: "K",
      }),
      runtime.toolRuntime.getContext("turn-rename")!,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { action: "renamed", previousName: "E", objectName: "K" },
    });
    expect(objects.has("E")).toBe(false);
    expect(objects.get("K")).toMatchObject({ type: "point" });
  });

  it("creates, moves and styles points only through strict semantic actions", async () => {
    const { objects, runtime } = await createHarness();

    const created = await runtime.toolRuntime.gateway.execute(
      call("create_geogebra_point", "point-1", {
        label: "K",
        x: 4,
        y: -1.5,
        color: "black",
      }),
      runtime.toolRuntime.getContext("turn-create")!,
    );
    const moved = await runtime.toolRuntime.gateway.execute(
      call("move_geogebra_point", "move-1", { point: "K", x: 5, y: 2 }),
      runtime.toolRuntime.getContext("turn-move")!,
    );
    const styled = await runtime.toolRuntime.gateway.execute(
      call("style_geogebra_object", "style-1", {
        objectName: "K",
        color: "red",
        labelVisible: false,
      }),
      runtime.toolRuntime.getContext("turn-style")!,
    );

    expect(created).toMatchObject({ ok: true, data: { action: "created_point" } });
    expect(moved).toMatchObject({ ok: true, data: { action: "moved_point" } });
    expect(styled).toMatchObject({ ok: true, data: { action: "styled" } });
    expect(objects.get("K")).toMatchObject({
      x: 5,
      y: 2,
      color: [198, 61, 47],
      labelVisible: false,
    });
  });

  it("constructs a circle and polygon from existing points", async () => {
    const { objects, runtime } = await createHarness();

    const circle = await runtime.toolRuntime.gateway.execute(
      call("draw_geogebra_circle", "circle-1", {
        center: "E",
        throughPoint: "F",
        color: "blue",
      }),
      runtime.toolRuntime.getContext("turn-circle")!,
    );
    const polygon = await runtime.toolRuntime.gateway.execute(
      call("draw_geogebra_polygon", "polygon-1", {
        pointLabels: ["E", "F", "G"],
        color: "green",
      }),
      runtime.toolRuntime.getContext("turn-polygon")!,
    );

    expect(circle).toMatchObject({ ok: true, data: { kind: "circle" } });
    expect(polygon).toMatchObject({ ok: true, data: { kind: "polygon" } });
    expect(objects.get("compassCircleEF")).toMatchObject({ type: "circle" });
    expect(objects.get("compassPolygonEFG")).toMatchObject({ type: "polygon" });
  });

  it("rejects unknown tools and extra construction arguments", async () => {
    const { evalCommand, runtime } = await createHarness();
    const context = runtime.toolRuntime.getContext("turn-invalid")!;

    const unknown = await runtime.toolRuntime.gateway.execute(
      call("execute_any_geogebra_command", "bad-tool", { command: "DeleteAll" }),
      context,
    );
    const extra = await runtime.toolRuntime.gateway.execute(
      call("draw_geogebra_segment", "bad-args", {
        pointA: "F",
        pointB: "G",
        color: "red",
        command: "DeleteAll",
      }),
      context,
    );

    expect(unknown).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
    expect(extra).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" },
    });
    expect(evalCommand).not.toHaveBeenCalled();
  });
});

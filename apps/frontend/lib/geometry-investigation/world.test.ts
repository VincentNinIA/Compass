import { describe, expect, it } from "vitest";

import { SceneRegistry } from "@/lib/geogebra/scene";
import type { GeoGebraApi } from "@/types/geogebra";

import { parseGeometryDependencies } from "./dependencies";
import { createGeometryWorldDeltaV2, readGeometryWorldV2 } from "./world";

describe("parseGeometryDependencies", () => {
  it.each([
    ["Midpoint(A, B)", ["A", "B"]],
    ["E = Midpoint[A,B]", ["A", "B"]],
    ["Line(A,Midpoint(B,C))", ["A", "B", "C"]],
    ["Polygon(A,B,C,D)", ["A", "B", "C", "D"]],
  ])("extracts bounded parents from %s", (command, parents) => {
    expect(parseGeometryDependencies(command)).toEqual({
      status: "known",
      parents,
    });
  });

  it.each(["", "(2,3)", "A = (2,3)", "Midpoint(A,B", "free text"])(
    "does not invent dependencies for %s",
    (command) => {
      expect(parseGeometryDependencies(command)).toEqual({
        status: "unknown",
        parents: [],
      });
    },
  );
});

describe("readGeometryWorldV2", () => {
  it("publishes exact parents, ownership, finite values and a forty-object bound", () => {
    const names = ["E", "F", ...Array.from({ length: 40 }, (_, index) => `P${index}`)];
    const registry = new SceneRegistry();
    registry.register("E", "student", "point");
    registry.register("F", "assistant", "point");
    const api = fakeApi(names, {
      E: "Midpoint(A,B)",
      F: "",
    });

    const world = readGeometryWorldV2(api, {
      activityId: "varignon_fr_v1",
      epoch: 3,
      revision: 7,
      registry,
      change: {
        kind: "drag_end",
        objectNames: ["E"],
        terminal: true,
        actor: "learner",
        occurredAt: 100,
      },
    });

    expect(world.objectCount).toBe(42);
    expect(world.truncated).toBe(true);
    expect(world.objects).toHaveLength(40);
    expect(world.objects.find(({ name }) => name === "E")).toMatchObject({
      parents: ["A", "B"],
      dependencyStatus: "known",
      owner: "student",
      x: 1,
      y: 2,
      visible: true,
    });
    expect(world.objects.find(({ name }) => name === "F")).toMatchObject({
      parents: [],
      dependencyStatus: "unknown",
      owner: "assistant",
    });
    expect(world.snapshotHash).toMatch(/^fnv1a32:/);
  });

  it("derives an exact initial snapshot delta and a later changed-object delta", () => {
    const first = readGeometryWorldV2(fakeApi(["E"], { E: "Midpoint(A,B)" }), {
      activityId: "varignon_fr_v1",
      epoch: 1,
      revision: 0,
      change: {
        kind: "initial",
        objectNames: [],
        terminal: true,
        actor: "system",
        occurredAt: 0,
      },
    });
    const secondApi = fakeApi(["E"], { E: "Midpoint(A,B)" }, { E: [4, 5] });
    const second = readGeometryWorldV2(secondApi, {
      activityId: "varignon_fr_v1",
      epoch: 1,
      revision: 1,
      change: {
        kind: "drag_end",
        objectNames: ["E"],
        terminal: true,
        actor: "learner",
        occurredAt: 200,
      },
    });

    expect(createGeometryWorldDeltaV2(undefined, first)).toMatchObject({
      previousRevision: null,
      added: [{ name: "E" }],
      removed: [],
      changed: [],
    });
    expect(createGeometryWorldDeltaV2(first, second)).toMatchObject({
      previousRevision: 0,
      added: [],
      removed: [],
      changed: [{ name: "E", x: 4, y: 5 }],
      change: { kind: "drag_end" },
    });
  });
});

function fakeApi(
  names: string[],
  commands: Record<string, string>,
  coordinates: Record<string, [number, number]> = {},
): GeoGebraApi {
  return {
    evalCommand: () => true,
    exists: () => true,
    isDefined: () => true,
    getAllObjectNames: () => names,
    getCommandString: (name) => commands[name] ?? `${name}=(1,2)`,
    getObjectType: () => "point",
    getXcoord: (name) => coordinates[name]?.[0] ?? 1,
    getYcoord: (name) => coordinates[name]?.[1] ?? 2,
    getColor: () => "#2e7d32",
    getVisible: () => true,
    setCoordSystem: () => undefined,
    setLabelVisible: () => undefined,
  };
}

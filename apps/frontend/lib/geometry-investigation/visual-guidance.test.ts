import { describe, expect, it } from "vitest";

import {
  GEOMETRY_ACTIONS_V1,
  type GeometryWorldV2,
} from "./contracts";
import {
  GEOMETRY_HARNESS_CAPABILITIES_V1,
  findGeoGebraMoreButtonV1,
  findGeoGebraToolButtonV1,
  geometryAnchorForNamesV1,
  parseGeometryViewPropertiesV1,
  projectGeometryBoxV1,
  projectGeometryPointV1,
} from "./visual-guidance";

describe("geometry harness capability map", () => {
  it("maps every closed action once with its authority and presentation surface", () => {
    expect(
      GEOMETRY_HARNESS_CAPABILITIES_V1.map(({ action }) => action),
    ).toEqual(GEOMETRY_ACTIONS_V1);
    expect(new Set(GEOMETRY_HARNESS_CAPABILITIES_V1.map(({ action }) => action)).size)
      .toBe(GEOMETRY_ACTIONS_V1.length);
    expect(
      GEOMETRY_HARNESS_CAPABILITIES_V1.find(
        ({ action }) => action === "activate_geometry_tool",
      ),
    ).toMatchObject({
      level: "O2",
      surface: "toolbar",
      presentation: "toolbar_target",
      mutatesGeometry: false,
      consent: "none",
    });
    expect(
      GEOMETRY_HARNESS_CAPABILITIES_V1.find(
        ({ action }) => action === "restore_geometry_checkpoint",
      ),
    ).toMatchObject({
      level: "O4",
      surface: "canvas",
      presentation: "restore_barrier",
      consent: "visible_confirmation",
    });
  });
});

describe("geometry visual target projection", () => {
  it("anchors points directly and segments or polygons from their parents", () => {
    const world = worldFixture();
    expect(geometryAnchorForNamesV1(world, ["A"])).toEqual({ x: -4, y: -1 });
    expect(geometryAnchorForNamesV1(world, ["AB"])).toEqual({ x: -2, y: -2 });
    expect(geometryAnchorForNamesV1(world, ["quad"])).toEqual({ x: 0, y: 0 });
    expect(geometryAnchorForNamesV1(world, ["missing"])).toBeUndefined();
  });

  it("projects logical points and boxes with the public view properties", () => {
    const view = parseGeometryViewPropertiesV1(
      JSON.stringify({
        xMin: -5,
        yMin: -3,
        invXscale: 0.02,
        invYscale: 0.02,
        width: 500,
        height: 300,
        left: 100,
        top: 200,
      }),
    );
    expect(view).toBeDefined();
    expect(projectGeometryPointV1({ x: 0, y: 0 }, view!)).toEqual({
      x: 250,
      y: 150,
    });
    expect(
      projectGeometryBoxV1(
        { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
        view!,
      ),
    ).toEqual({ left: 200, top: 100, width: 100, height: 100 });
  });
});

describe("GeoGebra toolbar targeting", () => {
  it("locates the exact mode and the compact More/Plus expander", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button class="materialTextButton">Plus</button>
      <button class="toolButton" mode="19" id="mode19" selected="true">
        Milieu ou centre
      </button>
    `;
    for (const button of root.querySelectorAll("button")) {
      button.getBoundingClientRect = () =>
        ({ width: 80, height: 72 } as DOMRect);
    }
    expect(findGeoGebraToolButtonV1(root, 19)?.id).toBe("mode19");
    expect(findGeoGebraMoreButtonV1(root)?.textContent).toBe("Plus");
    expect(findGeoGebraToolButtonV1(root, 18)).toBeUndefined();
  });
});

function worldFixture(): GeometryWorldV2 {
  const point = (name: string, x: number, y: number) => ({
    name,
    type: "point",
    command: `${name}=(${x},${y})`,
    parents: [],
    dependencyStatus: "unknown" as const,
    owner: "scaffold" as const,
    x,
    y,
    visible: true,
  });
  const objects = [
    point("A", -4, -1),
    point("B", 0, -3),
    point("C", 4, 1),
    point("D", 0, 3),
    {
      name: "AB",
      type: "segment",
      command: "Segment(A,B)",
      parents: ["A", "B"],
      dependencyStatus: "known" as const,
      owner: "scaffold" as const,
      visible: true,
    },
    {
      name: "quad",
      type: "polygon",
      command: "Polygon(A,B,C,D)",
      parents: ["A", "B", "C", "D"],
      dependencyStatus: "known" as const,
      owner: "student" as const,
      visible: true,
    },
  ];
  return {
    schemaVersion: "geometry_world.v2",
    activityId: "varignon_fr_v1",
    epoch: 1,
    revision: 1,
    snapshotHash: "hash:1",
    objectCount: objects.length,
    truncated: false,
    objects,
    facts: [],
    change: {
      kind: "initial",
      objectNames: [],
      terminal: true,
      actor: "system",
      occurredAt: 0,
    },
  };
}

import { describe, expect, it } from "vitest";

import {
  GEOMETRY_INVESTIGATION_C04_MODEL_ACTIONS_V1,
  GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS,
  parseGeometryActionArgumentsC04,
  parseGeometryActionArgumentsV1,
} from "./actions";

describe("geometry investigation action contracts", () => {
  it("preserves the seven C04 actions and exposes exactly ten after C05", () => {
    expect(GEOMETRY_INVESTIGATION_C04_MODEL_ACTIONS_V1).toEqual([
      "inspect_geometry_workspace",
      "activate_geometry_tool",
      "highlight_geometry_objects",
      "create_geometry_variation",
      "classify_geometry_configuration",
      "check_geometry_relation",
      "focus_geometry_view",
    ]);
    expect(
      GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS.map(({ name }) => name),
    ).toEqual([
      ...GEOMETRY_INVESTIGATION_C04_MODEL_ACTIONS_V1,
      "capture_geometry_evidence",
      "restore_geometry_checkpoint",
      "demonstrate_geometry_step",
    ]);
    expect(
      GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS.some(
        ({ name }) => name === ("initialize_geometry_activity" as never),
      ),
    ).toBe(false);
  });

  it("never exposes construction Base64 or a free replay command", () => {
    const serialized = JSON.stringify(
      GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS,
    );
    expect(serialized).not.toContain("base64");
    expect(serialized).not.toContain("evalCommand");
  });

  it("keeps model-provided coordinates out of the variation schema", () => {
    const variation = GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS.find(
      ({ name }) => name === "create_geometry_variation",
    );
    expect(variation?.parameters).not.toHaveProperty("properties.x");
    expect(variation?.parameters).not.toHaveProperty("properties.y");
    expect(variation?.parameters).toMatchObject({ additionalProperties: false });
  });

  it("rejects extra keys, invalid bounds and duplicate ordered labels", () => {
    expect(
      parseGeometryActionArgumentsC04(
        "activate_geometry_tool",
        JSON.stringify({
          activityId: "varignon_fr_v1",
          epoch: 1,
          revision: 2,
          tool: "midpoint",
          command: "Midpoint(A,B)",
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseGeometryActionArgumentsC04(
        "highlight_geometry_objects",
        JSON.stringify({
          activityId: "varignon_fr_v1",
          epoch: 1,
          revision: 2,
          names: ["A"],
          style: "hint",
          durationMs: 999,
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseGeometryActionArgumentsC04(
        "classify_geometry_configuration",
        JSON.stringify({
          activityId: "varignon_fr_v1",
          epoch: 1,
          revision: 2,
          labels: ["A", "B", "B", "D"],
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts a strict object focus target and rejects an inverted box", () => {
    expect(
      parseGeometryActionArgumentsC04(
        "focus_geometry_view",
        JSON.stringify({
          activityId: "varignon_fr_v1",
          epoch: 1,
          revision: 2,
          target: { kind: "objects", names: ["A", "B"] },
          margin: 0.2,
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseGeometryActionArgumentsC04(
        "focus_geometry_view",
        JSON.stringify({
          activityId: "varignon_fr_v1",
          epoch: 1,
          revision: 2,
          target: { kind: "box", xMin: 1, xMax: -1, yMin: -1, yMax: 1 },
          margin: 0.2,
        }),
      ).ok,
    ).toBe(false);
  });

  it("keeps checkpoint contents and free replay instructions out of C05 inputs", () => {
    expect(
      parseGeometryActionArgumentsV1(
        "capture_geometry_evidence",
        JSON.stringify({
          activityId: "varignon_fr_v1",
          epoch: 1,
          revision: 2,
          missionId: "V3",
          configuration: "convex",
          requiredFactIds: ["rel_configuration_convex"],
          base64: "forbidden",
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseGeometryActionArgumentsV1(
        "demonstrate_geometry_step",
        JSON.stringify({
          activityId: "varignon_fr_v1",
          epoch: 1,
          revision: 2,
          stepId: "demo_v8_7",
          consentToken:
            "ggb-privileged:00000000-0000-0000-0000-000000000000",
          speed: "normal",
          command: "Move(A,(0,0))",
        }),
      ).ok,
    ).toBe(false);
  });
});

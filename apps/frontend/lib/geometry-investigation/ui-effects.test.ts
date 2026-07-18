import { describe, expect, it, vi } from "vitest";

import type { GeoGebraApi } from "@/types/geogebra";

import { GEOGEBRA_TOOL_MODE_IDS_V1, GeometryUiEffectsV1 } from "./ui-effects";

describe("GeometryUiEffectsV1", () => {
  it("activates a closed tool without creating objects and restores move mode", () => {
    const state = styledApi();
    const guidance = vi.fn();
    const prepareToolTarget = vi.fn();
    const effects = new GeometryUiEffectsV1(state.api, {
      onGuidanceCue: guidance,
      prepareToolTarget,
    });
    expect(effects.activateTool("midpoint")).toMatchObject({
      tool: "midpoint",
      mode: 19,
      createdObjects: 0,
    });
    expect(prepareToolTarget).toHaveBeenCalledWith(19);
    expect(guidance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "toolbar",
        action: "activate_geometry_tool",
        tool: "midpoint",
        mode: 19,
        durationMs: 10_000,
      }),
    );
    expect(state.mode()).toBe(GEOGEBRA_TOOL_MODE_IDS_V1.midpoint);
    expect(effects.cleanup()).toMatchObject({ ok: true });
    expect(state.mode()).toBe(GEOGEBRA_TOOL_MODE_IDS_V1.move);
    expect(guidance).toHaveBeenLastCalledWith(undefined);
  });

  it("restores exact color, thickness and visibility after a timed highlight", () => {
    let timerCallback: (() => void) | undefined;
    const state = styledApi({ visible: false, thickness: 4, color: "#123456" });
    const guidance = vi.fn();
    const effects = new GeometryUiEffectsV1(state.api, {
      timers: {
        setTimeout(callback) {
          timerCallback = callback;
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout: vi.fn(),
      },
      onGuidanceCue: guidance,
    });
    effects.highlight(["A"], "relation", 2_000);
    expect(guidance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "objects",
        names: ["A"],
        style: "relation",
        durationMs: 2_000,
      }),
    );
    expect(state.style()).toMatchObject({ visible: true, thickness: 8 });
    expect(state.style().color).not.toBe("#123456");
    timerCallback?.();
    expect(state.style()).toEqual({ visible: false, thickness: 4, color: "#123456" });
  });

  it("captures and restores the exact previous viewport", () => {
    const state = styledApi();
    const guidance = vi.fn();
    const effects = new GeometryUiEffectsV1(state.api, {
      onGuidanceCue: guidance,
    });
    effects.focus({ xMin: -1, xMax: 1, yMin: -2, yMax: 2 }, 0.25);
    expect(state.viewport()).toEqual({ xMin: -1.5, xMax: 1.5, yMin: -3, yMax: 3 });
    expect(guidance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "viewport",
        box: { xMin: -1.5, xMax: 1.5, yMin: -3, yMax: 3 },
      }),
    );
    effects.cleanup();
    expect(state.viewport()).toEqual({ xMin: -5, xMax: 5, yMin: -3, yMax: 3 });
  });
});

function styledApi(
  initial: { color?: string; thickness?: number; visible?: boolean } = {},
) {
  let mode = 0;
  let viewport = { xMin: -5, xMax: 5, yMin: -3, yMax: 3 };
  const style = {
    color: initial.color ?? "#000000",
    thickness: initial.thickness ?? 2,
    visible: initial.visible ?? true,
  };
  const api: GeoGebraApi = {
    evalCommand: vi.fn(() => true),
    exists: (name) => name === "A",
    getAllObjectNames: () => ["A"],
    getCommandString: () => "A=(0,0)",
    getColor: () => style.color,
    getLineThickness: () => style.thickness,
    getMode: () => mode,
    getViewProperties: () => ({ ...viewport }),
    getVisible: () => style.visible,
    isDefined: () => true,
    setColor: (_name, red, green, blue) => {
      style.color = `#${[red, green, blue]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")}`.toUpperCase();
    },
    setCoordSystem: (xMin, xMax, yMin, yMax) => {
      viewport = { xMin, xMax, yMin, yMax };
    },
    setLabelVisible: vi.fn(),
    setLineThickness: (_name, thickness) => {
      style.thickness = thickness;
    },
    setMode: (next) => {
      mode = next;
    },
    setVisible: (_name, visible) => {
      style.visible = visible;
    },
  };
  return {
    api,
    mode: () => mode,
    style: () => ({ ...style }),
    viewport: () => ({ ...viewport }),
  };
}

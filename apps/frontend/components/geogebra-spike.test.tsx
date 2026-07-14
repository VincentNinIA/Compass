import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeoGebraSpike } from "./geogebra-spike";
import { resetGeoGebraScriptForTests } from "@/lib/geogebra";
import type {
  GeoGebraApi,
  GeoGebraAppletParameters,
} from "@/types/geogebra";

describe("GeoGebraSpike", () => {
  afterEach(() => {
    delete window.GGBApplet;
    delete window.__GEOTUTOR_GGB_EVIDENCE__;
    resetGeoGebraScriptForTests();
    vi.restoreAllMocks();
  });

  it("loads through appletOnLoad, reads A/B/AB, and removes the applet on unmount", async () => {
    const removeExistingApplet = vi.fn();
    const commands = new Map([
      ["A", ""],
      ["B", ""],
      ["AB", "Segment(A, B)"],
    ]);
    const api: GeoGebraApi = {
      evalCommand: vi.fn(() => true),
      exists: vi.fn((label) => commands.has(label)),
      isDefined: vi.fn((label) => commands.has(label)),
      getCommandString: vi.fn((label) => commands.get(label) ?? ""),
      setCoordSystem: vi.fn(),
      setLabelVisible: vi.fn(),
    };

    window.GGBApplet = class {
      readonly parameters: GeoGebraAppletParameters;

      constructor(parameters: GeoGebraAppletParameters) {
        this.parameters = parameters;
      }

      inject() {
        this.parameters.appletOnLoad(api);
      }

      removeExistingApplet = removeExistingApplet;
      setHTML5Codebase = vi.fn();
    };

    const view = render(<GeoGebraSpike />);

    await act(async () => undefined);
    expect(await screen.findByText("API verified")).toBeInTheDocument();
    expect(screen.getByText("Segment(A, B)")).toBeInTheDocument();
    expect(window.__GEOTUTOR_GGB_EVIDENCE__?.objects).toHaveLength(3);

    view.unmount();

    expect(removeExistingApplet).toHaveBeenCalledTimes(1);
    expect(window.__GEOTUTOR_GGB_EVIDENCE__).toBeUndefined();
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
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
    const created = new Set<string>();
    const api: GeoGebraApi = {
      evalCommand: vi.fn((command) => {
        for (const line of command.split("\n")) {
          created.add(line.split("=")[0].trim());
        }
        return true;
      }),
      exists: vi.fn((label) => created.has(label)),
      isDefined: vi.fn((label) => created.has(label)),
      getCommandString: vi.fn((label) => commands.get(label) ?? ""),
      setCoordSystem: vi.fn(),
      setLabelVisible: vi.fn(),
      getBase64: vi.fn((callback) => callback("initial-base64")),
      getAllObjectNames: vi.fn(() => [...created]),
      setBase64: vi.fn((_base64, callback) => callback?.()),
      registerClientListener: vi.fn(),
      unregisterClientListener: vi.fn(),
      registerAddListener: vi.fn(),
      unregisterAddListener: vi.fn(),
      registerRemoveListener: vi.fn(),
      unregisterRemoveListener: vi.fn(),
      registerUpdateListener: vi.fn(),
      unregisterUpdateListener: vi.fn(),
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
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.getByText(/Perpendicular to AB/)).toBeInTheDocument();
    expect(screen.getByText(/Passes through the midpoint/)).toBeInTheDocument();
    expect(window.__GEOTUTOR_GGB_EVIDENCE__?.objects).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Reset construction" }));
    await act(async () => undefined);
    expect(api.setBase64).toHaveBeenCalledWith(
      "initial-base64",
      expect.any(Function),
    );

    view.unmount();

    expect(removeExistingApplet).toHaveBeenCalledTimes(1);
    expect(window.__GEOTUTOR_GGB_EVIDENCE__).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";

import { GeoGebraAdapter } from "./adapter";
import type {
  GeoGebraApi,
  GeoGebraAppletParameters,
  GeoGebraClientListener,
} from "@/types/geogebra";

function createHarness() {
  let parameters: GeoGebraAppletParameters | undefined;
  const removeExistingApplet = vi.fn();
  const registerClientListener = vi.fn();
  const unregisterClientListener = vi.fn();
  const api = {
    evalCommand: vi.fn(() => true),
    exists: vi.fn(() => true),
    getCommandString: vi.fn(() => ""),
    isDefined: vi.fn(() => true),
    setCoordSystem: vi.fn(),
    setLabelVisible: vi.fn(),
    registerClientListener,
    unregisterClientListener,
  } satisfies GeoGebraApi;
  const adapter = new GeoGebraAdapter({
    loadScript: vi.fn(async () => undefined),
    createApplet: vi.fn((nextParameters) => {
      parameters = nextParameters;
      return {
        inject: vi.fn(),
        removeExistingApplet,
        setHTML5Codebase: vi.fn(),
      };
    }),
  });
  return {
    adapter,
    api,
    removeExistingApplet,
    registerClientListener,
    unregisterClientListener,
    getParameters: () => parameters,
  };
}

describe("GeoGebraAdapter", () => {
  it("allows only idle -> loading -> ready and rejects a double load", async () => {
    const harness = createHarness();
    const loading = harness.adapter.load("target");
    await vi.waitFor(() => expect(harness.getParameters()).toBeDefined());

    expect(harness.adapter.phase).toBe("loading");
    expect((await harness.adapter.load("target")).ok).toBe(false);

    harness.getParameters()?.appletOnLoad(harness.api);
    expect(await loading).toEqual({ ok: true, value: undefined });
    expect(harness.adapter.phase).toBe("ready");
    expect(harness.adapter.withApi((api) => api.exists("A"))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("deduplicates listeners and dispose is idempotent", async () => {
    const harness = createHarness();
    const loading = harness.adapter.load("target");
    await vi.waitFor(() => expect(harness.getParameters()).toBeDefined());
    harness.getParameters()?.appletOnLoad(harness.api);
    await loading;

    const listener: GeoGebraClientListener = vi.fn();
    harness.adapter.registerClientListener(listener);
    harness.adapter.registerClientListener(listener);
    expect(harness.registerClientListener).toHaveBeenCalledTimes(1);

    harness.adapter.dispose();
    harness.adapter.dispose();
    expect(harness.unregisterClientListener).toHaveBeenCalledTimes(1);
    expect(harness.removeExistingApplet).toHaveBeenCalledTimes(1);
    expect(harness.adapter.phase).toBe("disposed");
    expect(harness.adapter.withApi(() => true)).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });

  it("ignores a callback that arrives after dispose", async () => {
    const harness = createHarness();
    const loading = harness.adapter.load("target");
    await vi.waitFor(() => expect(harness.getParameters()).toBeDefined());
    harness.adapter.dispose();
    harness.getParameters()?.appletOnLoad({ ...harness.api, remove: vi.fn() });

    expect(await loading).toMatchObject({
      ok: false,
      error: { code: "stale_epoch" },
    });
    expect(harness.adapter.phase).toBe("disposed");
  });
});

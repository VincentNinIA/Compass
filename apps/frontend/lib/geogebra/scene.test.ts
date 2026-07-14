import { describe, expect, it, vi } from "vitest";

import { GeoGebraAdapter } from "./adapter";
import { initializeMinimalScene, SceneRegistry } from "./scene";
import type { GeoGebraApi, GeoGebraAppletParameters } from "@/types/geogebra";

async function readyAdapter(api: GeoGebraApi) {
  let parameters: GeoGebraAppletParameters | undefined;
  const adapter = new GeoGebraAdapter({
    loadScript: async () => undefined,
    createApplet(next) {
      parameters = next;
      return {
        inject: vi.fn(),
        removeExistingApplet: vi.fn(),
        setHTML5Codebase: vi.fn(),
      };
    },
  });
  const loading = adapter.load("target");
  await vi.waitFor(() => expect(parameters).toBeDefined());
  parameters?.appletOnLoad(api);
  await loading;
  return adapter;
}

function fakeApi(overrides: Partial<GeoGebraApi> = {}): GeoGebraApi {
  const existing = new Set<string>();
  return {
    evalCommand: vi.fn((command) => {
      existing.add(command.split("=")[0].trim());
      return true;
    }),
    exists: vi.fn((name) => existing.has(name)),
    isDefined: vi.fn((name) => existing.has(name)),
    deleteObject: vi.fn((name) => existing.delete(name)),
    getCommandString: vi.fn(() => ""),
    setCoordSystem: vi.fn(),
    setFixed: vi.fn(),
    setLabelVisible: vi.fn(),
    ...overrides,
  };
}

describe("initializeMinimalScene", () => {
  it("publishes only A, B and AB after every verification succeeds", async () => {
    const api = fakeApi();
    const registry = new SceneRegistry();
    const result = initializeMinimalScene(await readyAdapter(api), registry);

    expect(result).toEqual({
      ok: true,
      value: [
        { name: "A", owner: "system", kind: "point" },
        { name: "AB", owner: "system", kind: "segment" },
        { name: "B", owner: "system", kind: "point" },
      ],
    });
    expect(api.setFixed).toHaveBeenCalledTimes(3);
  });

  it("rejects a reserved-label collision without mutating the construction", async () => {
    const api = fakeApi({ exists: vi.fn((name) => name === "A") });
    const registry = new SceneRegistry();
    const result = initializeMinimalScene(await readyAdapter(api), registry);

    expect(result).toMatchObject({ ok: false, error: { code: "label_collision" } });
    expect(api.evalCommand).not.toHaveBeenCalled();
    expect(registry.list()).toEqual([]);
  });

  it("rolls back only labels created by the failed transaction", async () => {
    const api = fakeApi();
    vi.mocked(api.evalCommand).mockImplementation((command) => !command.startsWith("B ="));
    const registry = new SceneRegistry();
    registry.register("studentLine", "student", "line");
    const result = initializeMinimalScene(await readyAdapter(api), registry);

    expect(result).toMatchObject({ ok: false, error: { code: "command_rejected" } });
    expect(api.deleteObject).toHaveBeenCalledWith("A");
    expect(api.deleteObject).not.toHaveBeenCalledWith("studentLine");
    expect(registry.list()).toEqual([
      { name: "studentLine", owner: "student", kind: "line" },
    ]);
  });
});

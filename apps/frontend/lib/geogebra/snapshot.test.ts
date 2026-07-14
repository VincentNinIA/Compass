import { describe, expect, it, vi } from "vitest";

import { GeoGebraAdapter } from "./adapter";
import { SceneRegistry } from "./scene";
import { normalizeCommand, SnapshotService } from "./snapshot";
import type { GeoGebraApi, GeoGebraAppletParameters } from "@/types/geogebra";

async function setup(commands: Map<string, string>, exists?: (name: string) => boolean) {
  let parameters: GeoGebraAppletParameters | undefined;
  const api: GeoGebraApi = {
    evalCommand: vi.fn(() => true),
    exists: vi.fn(exists ?? ((name) => commands.has(name))),
    isDefined: vi.fn(() => true),
    getCommandString: vi.fn((name) => commands.get(name) ?? ""),
    setCoordSystem: vi.fn(),
    setLabelVisible: vi.fn(),
  };
  const adapter = new GeoGebraAdapter({
    loadScript: async () => undefined,
    createApplet(next) {
      parameters = next;
      return { inject: vi.fn(), removeExistingApplet: vi.fn(), setHTML5Codebase: vi.fn() };
    },
  });
  const loading = adapter.load("target");
  await vi.waitFor(() => expect(parameters).toBeDefined());
  parameters?.appletOnLoad(api);
  await loading;
  const registry = new SceneRegistry();
  registry.register("B", "system", "point");
  registry.register("A", "system", "point");
  registry.register("line1", "student", "line");
  return { api, commands, service: new SnapshotService(adapter, registry) };
}

describe("SnapshotService", () => {
  it("sorts objects, requests non-localized commands and keeps revision for the same hash", async () => {
    const harness = await setup(
      new Map([
        ["line1", "Line[A, B]"],
        ["B", "(2.00000000001, 0)"],
        ["A", "(-2, -0.00000000001)"],
      ]),
    );
    const first = harness.service.capture();
    const second = harness.service.capture();

    expect(first).toMatchObject({ ok: true, value: { revision: 1, complete: true } });
    expect(second).toMatchObject({ ok: true, value: { revision: 1 } });
    if (first.ok) {
      expect(first.value.objects.map(({ name }) => name)).toEqual(["A", "B", "line1"]);
    }
    expect(harness.api.getCommandString).toHaveBeenCalledWith("A", false);
  });

  it("increments revision only when normalized construction changes", async () => {
    const harness = await setup(new Map([["A", "(-2,0)"], ["B", "(2,0)"], ["line1", "Line[A,B]"]]));
    const first = harness.service.capture();
    harness.commands.set("line1", "Line[A,(0,1)]");
    const second = harness.service.capture();

    expect(first.ok && first.value.revision).toBe(1);
    expect(second.ok && second.value.revision).toBe(2);
    expect(first.value.hash).not.toBe(second.value.hash);
  });

  it("retries once and returns an incomplete non-decision snapshot", async () => {
    let checks = 0;
    const harness = await setup(
      new Map([["A", "(-2,0)"], ["B", "(2,0)"], ["line1", "Line[A,B]"]]),
      (name) => name !== "line1" || ++checks > 2,
    );
    const result = harness.service.capture();
    expect(result).toMatchObject({ ok: false, error: { code: "incomplete" }, value: { complete: false, revision: 0 } });
  });
});

describe("normalizeCommand", () => {
  it("normalizes whitespace, negative zero and insignificant floating noise", () => {
    expect(normalizeCommand(" Line ( A , (2.00000000001, -0.00000000001) ) ")).toBe(
      "Line(A,(2,0))",
    );
  });
});

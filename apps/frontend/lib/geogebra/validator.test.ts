import { describe, expect, it, vi } from "vitest";

import { GeoGebraAdapter } from "./adapter";
import { SceneRegistry } from "./scene";
import { MIDPOINT_DISTANCE_TOLERANCE, PerpendicularBisectorValidator } from "./validator";
import type { GeoGebraApi, GeoGebraAppletParameters } from "@/types/geogebra";

async function harness(perpendicular: boolean, distance: number) {
  let parameters: GeoGebraAppletParameters | undefined;
  const existing = new Set(["A", "B", "AB", "candidate"]);
  const values = new Map<string, number>();
  const api: GeoGebraApi = {
    evalCommand: vi.fn((command) => {
      const name = command.split("=")[0].trim();
      existing.add(name);
      if (name.endsWith("Perpendicular")) values.set(name, perpendicular ? 1 : 0);
      if (name.endsWith("MidpointDistance")) values.set(name, distance);
      return true;
    }),
    exists: vi.fn((name) => existing.has(name)),
    isDefined: vi.fn((name) => existing.has(name)),
    deleteObject: vi.fn((name) => { existing.delete(name); values.delete(name); }),
    getCommandString: vi.fn(() => ""), getValue: vi.fn((name) => values.get(name) ?? 0),
    setCoordSystem: vi.fn(), setLabelVisible: vi.fn(),
  };
  const adapter = new GeoGebraAdapter({
    loadScript: async () => undefined,
    createApplet(next) { parameters = next; return { inject: vi.fn(), removeExistingApplet: vi.fn(), setHTML5Codebase: vi.fn() }; },
  });
  const loading = adapter.load("target");
  await vi.waitFor(() => expect(parameters).toBeDefined());
  parameters?.appletOnLoad(api);
  await loading;
  const registry = new SceneRegistry();
  registry.register("A", "system", "point"); registry.register("B", "system", "point");
  registry.register("AB", "system", "segment"); registry.register("candidate", "student", "line");
  return { api, registry, validator: new PerpendicularBisectorValidator(adapter, registry) };
}

describe("PerpendicularBisectorValidator", () => {
  it.each([
    [false, 2, 0],
    [false, 0, 1],
    [true, 2, 1],
    [true, 0, 2],
  ])("scores independent evidence perpendicular=%s distance=%s", async (perpendicular, distance, score) => {
    const { validator } = await harness(perpendicular, distance);
    const result = validator.validate(7);
    expect(result).toMatchObject({
      ok: true,
      value: {
        score,
        revision: 7,
        evidence: [
          { id: "evidence-r7-perpendicular", pass: perpendicular, observed: perpendicular ? 1 : 0 },
          { id: "evidence-r7-passes_midpoint", pass: distance === 0, observed: distance },
        ],
      },
    });
  });

  it("includes the midpoint tolerance boundary and rejects just above it", async () => {
    const atBoundary = await harness(true, MIDPOINT_DISTANCE_TOLERANCE);
    const above = await harness(true, MIDPOINT_DISTANCE_TOLERANCE + 1e-10);
    expect(atBoundary.validator.validate(1)).toMatchObject({ ok: true, value: { score: 2 } });
    expect(above.validator.validate(1)).toMatchObject({ ok: true, value: { score: 1 } });
  });

  it("cleans namespaced helpers from API and registry", async () => {
    const { api, registry, validator } = await harness(true, 0);
    expect(validator.validate(2).ok).toBe(true);
    expect(registry.list().some(({ owner }) => owner === "temporary")).toBe(false);
    expect(api.deleteObject).toHaveBeenCalledTimes(3);
  });

  it("rejects absent and ambiguous candidates without awarding points", async () => {
    const { registry, validator } = await harness(true, 0);
    registry.remove("candidate");
    expect(validator.validate(1)).toMatchObject({ ok: false, error: { code: "candidate_missing" } });
    registry.register("line1", "student", "line"); registry.register("line2", "student", "line");
    expect(validator.validate(1)).toMatchObject({ ok: false, error: { code: "candidate_ambiguous" } });
  });
});

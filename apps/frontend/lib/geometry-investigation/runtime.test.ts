import { describe, expect, it, vi } from "vitest";

import { createGeometryInvestigationRuntime } from "./runtime";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

describe("GeometryInvestigationRuntime", () => {
  it("composes existing authorities without exposing a mutation API", () => {
    const services = {
      adapter: { name: "existing-adapter" },
      observation: { name: "existing-observation" },
      engine: { name: "future-engine" },
      gateway: { name: "existing-gateway" },
      checkpoints: { name: "existing-checkpoints" },
      policy: { name: "existing-policy" },
      callbacks: { onError: vi.fn() },
    };

    const runtime = createGeometryInvestigationRuntime(
      VARIGNON_ACTIVITY_FR_V1,
      services,
    );

    expect(runtime.activity.template).toBe("varignon.v1");
    expect(runtime.services.adapter).toBe(services.adapter);
    expect(runtime.services.observation).toBe(services.observation);
    expect(runtime.services.gateway).toBe(services.gateway);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.activity.missions)).toBe(true);
    expect("start" in runtime).toBe(false);
    expect("mutate" in runtime).toBe(false);
    expect("restore" in runtime).toBe(false);
  });

  it("rejects an invalid activity before retaining injected services", () => {
    expect(() =>
      createGeometryInvestigationRuntime(
        { ...VARIGNON_ACTIVITY_FR_V1, schemaVersion: "geometry_investigation.v2" },
        {
          adapter: {},
          observation: {},
          engine: {},
          gateway: {},
          checkpoints: {},
          policy: {},
        },
      ),
    ).toThrow();
  });
});

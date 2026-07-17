import { describe, expect, it } from "vitest";

import {
  GEOMETRY_CONSENT_MAX_TTL_MS,
  GeometryConsentTokenStoreV1,
  type GeometryVariationConsentBindingV1,
} from "./consent";

const binding = {
  activityId: "varignon_fr_v1",
  epoch: 1,
  revision: 2,
  action: "create_geometry_variation",
  target: "concave",
  movingPoint: "A",
} as const satisfies GeometryVariationConsentBindingV1;

describe("GeometryConsentTokenStoreV1", () => {
  it("binds, consumes once and never returns the token in validation output", () => {
    const store = new GeometryConsentTokenStoreV1({
      now: () => 1_000,
      createToken: () => "ggb-consent:11111111-1111-1111-1111-111111111111",
    });
    const token = store.issue(binding);
    expect(store.validate(token, binding)).toEqual({ ok: true });
    expect(store.consume(token, binding)).toEqual({ ok: true });
    expect(store.consume(token, binding)).toEqual({ ok: false, reason: "used" });
  });

  it("rejects target, revision and point mismatches without consuming", () => {
    const store = new GeometryConsentTokenStoreV1({
      now: () => 1_000,
      createToken: () => "ggb-consent:22222222-2222-2222-2222-222222222222",
    });
    const token = store.issue(binding);
    expect(
      store.consume(token, { ...binding, target: "crossed" }),
    ).toEqual({ ok: false, reason: "binding_mismatch" });
    expect(store.consume(token, binding)).toEqual({ ok: true });
  });

  it("caps TTL and expires old tokens", () => {
    let now = 0;
    const store = new GeometryConsentTokenStoreV1({
      now: () => now,
      createToken: () => "ggb-consent:33333333-3333-3333-3333-333333333333",
    });
    const token = store.issue(binding, GEOMETRY_CONSENT_MAX_TTL_MS * 10);
    now = GEOMETRY_CONSENT_MAX_TTL_MS + 1;
    expect(store.validate(token, binding)).toEqual({ ok: false, reason: "expired" });
  });
});

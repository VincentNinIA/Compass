import { describe, expect, it, vi } from "vitest";

import { SceneRegistry } from "@/lib/geogebra/scene";
import type { GeoGebraApi } from "@/types/geogebra";

import { GeometryActionRuntimeV1 } from "./action-runtime";
import type { GeometryActionAuthorityV1 } from "./authority";
import { GeometryWorldV2 } from "./contracts";
import type { GeometryReplayControllerV1 } from "./replay";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

describe("GeometryActionRuntimeV1", () => {
  it("anchors tool contexts to activity, epoch, revision and mission", () => {
    const fixture = runtimeFixture();
    const context = fixture.runtime.toolRuntime.getContext("turn-v1");
    expect(context).toMatchObject({
      turnId: "turn-v1",
      phase: "constructing",
      epoch: 1,
      revision: 2,
    });
    expect(context?.isAuthorityCurrent?.()).toBe(true);
    fixture.authority.revision = 3;
    expect(context?.isAuthorityCurrent?.()).toBe(false);
  });

  it("does not expose an unreachable variation-consent API", () => {
    const fixture = runtimeFixture();
    expect(fixture.runtime).not.toHaveProperty("issueVariationConsent");
    expect(fixture.runtime).not.toHaveProperty("consentTokens");
  });

  it("issues and revokes a one-shot demonstration token only after an attempt", () => {
    const fixture = runtimeFixture();
    Object.assign(fixture.authority, {
      maxLevel: "O5",
      missionId: "V8",
      attemptedDemonstrationStepIds: [],
    });
    expect(
      fixture.runtime.issueDemonstrationConsent({
        stepId: "demo_v8_7",
        speed: "reduced",
        confirmed: true,
      }),
    ).toBeUndefined();
    fixture.authority.attemptedDemonstrationStepIds = ["demo_v8_7"];
    const token = fixture.runtime.issueDemonstrationConsent({
      stepId: "demo_v8_7",
      speed: "reduced",
      confirmed: true,
    });
    expect(token).toMatch(/^ggb-privileged:/);
    fixture.runtime.cancel("student_action");
    expect(
      fixture.runtime.privilegedTokens.validate(token!, {
        activityId: VARIGNON_ACTIVITY_FR_V1.id,
        epoch: 1,
        revision: 2,
        action: "demonstrate_geometry_step",
        stepId: "demo_v8_7",
        speed: "reduced",
      }),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("preserves the learner world only for direct learner cancellation", () => {
    const stop = vi.fn(() => true);
    const fixture = runtimeFixture(stop);

    fixture.runtime.cancel("student_action");
    fixture.runtime.cancel("student_speech");
    fixture.runtime.cancel("timeout");

    expect(stop).toHaveBeenNthCalledWith(1, {
      preserveLearnerWorld: true,
    });
    expect(stop).toHaveBeenNthCalledWith(2, {
      preserveLearnerWorld: true,
    });
    expect(stop).toHaveBeenNthCalledWith(3, {
      preserveLearnerWorld: false,
    });
  });
});

type MutableAuthority = Omit<GeometryActionAuthorityV1, "isCurrent"> & {
  revision: number;
  attemptedVariationTargets: ("convex" | "concave" | "crossed")[];
  attemptedDemonstrationStepIds?: string[];
};

function runtimeFixture(replayStop?: (options?: {
  preserveLearnerWorld?: boolean;
}) => boolean) {
  const authority: MutableAuthority = {
    activityId: VARIGNON_ACTIVITY_FR_V1.id,
    epoch: 1,
    revision: 2,
    phase: "investigating",
    actor: "assistant",
    maxLevel: "O3",
    missionId: "V4",
    uiGuidanceAllowed: true,
    attemptedVariationTargets: [],
  };
  const api: GeoGebraApi = {
    evalCommand: vi.fn(() => true),
    exists: vi.fn(() => true),
    getCommandString: vi.fn(() => ""),
    isDefined: vi.fn(() => true),
    setCoordSystem: vi.fn(),
    setLabelVisible: vi.fn(),
  };
  const world = GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId: VARIGNON_ACTIVITY_FR_V1.id,
    epoch: 1,
    revision: 2,
    snapshotHash: "runtime-world",
    objectCount: 0,
    truncated: false,
    objects: [],
    facts: [],
    change: {
      kind: "initial",
      objectNames: [],
      terminal: true,
      actor: "system",
      occurredAt: 1,
    },
  });
  const runtime = new GeometryActionRuntimeV1({
    api,
    activity: VARIGNON_ACTIVITY_FR_V1,
    registry: new SceneRegistry(),
    getAuthority: () => authority,
    getWorld: () => world,
    ...(replayStop
      ? {
          replay: {
            stop: replayStop,
          } as unknown as GeometryReplayControllerV1,
        }
      : {}),
  });
  return { runtime, authority };
}

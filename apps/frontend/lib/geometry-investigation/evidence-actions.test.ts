import { describe, expect, it, vi } from "vitest";

import { SceneRegistry } from "@/lib/geogebra/scene";
import type { GatewayContext } from "@/lib/tools/gateway";
import type { GeoGebraApi } from "@/types/geogebra";

import { GeometryActionGatewayV1 } from "./action-gateway";
import type { GeometryActionAuthorityV1 } from "./authority";
import type { GeometryCheckpointControllerV1 } from "./checkpoint-v2";
import { GeometryWorldV2, type GeometryWorldObjectV2 } from "./contracts";
import { evaluateGeometryWorldV2 } from "./engine";
import { GeometryEvidenceStoreV1, type GeometryCheckpointV1 } from "./evidence-store";
import { GeometryPrivilegedConsentStoreV1 } from "./privileged-consent";
import type { GeometryReplayControllerV1 } from "./replay";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

const activityId = VARIGNON_ACTIVITY_FR_V1.id;
const common = { activityId, epoch: 1, revision: 2 } as const;

describe("C05 evidence actions", () => {
  it("captures passing current evidence atomically without exposing Base64", async () => {
    const fixture = evidenceFixture();
    const result = await fixture.gateway.execute(
      call("capture_geometry_evidence", {
        ...common,
        missionId: "V3",
        configuration: "convex",
        requiredFactIds: ["rel_configuration_convex"],
      }),
      context(),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "stored",
        capture: {
          missionId: "V3",
          configuration: "convex",
          actor: "learner",
          factIds: expect.arrayContaining(["rel_configuration_convex"]),
        },
        thumbnailStored: true,
        quota: { captureCount: 1, learnerCaptures: 1 },
      },
    });
    expect(JSON.stringify(result)).not.toContain("base64-secret");
    expect(fixture.capture).toHaveBeenCalledTimes(1);
    expect(fixture.store.list()).toHaveLength(1);
  });

  it("rejects missing or stale facts before checkpoint export", async () => {
    const fixture = evidenceFixture({ evaluated: false });
    const result = await fixture.gateway.execute(
      call("capture_geometry_evidence", {
        ...common,
        missionId: "V3",
        configuration: "convex",
        requiredFactIds: ["rel_configuration_convex"],
      }),
      context(),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" },
    });
    expect(fixture.capture).not.toHaveBeenCalled();
    expect(fixture.store.list()).toHaveLength(0);
  });

  it("requires one-shot O4 confirmation before restore and returns exact anchors", async () => {
    const fixture = evidenceFixture();
    await captureConvex(fixture);
    authorizeRestore(fixture.authority);
    const checkpointId = fixture.store.list()[0].checkpointId;
    const missing = await fixture.gateway.execute(
      call(
        "restore_geometry_checkpoint",
        {
          ...common,
          checkpointId,
          confirmationId: "ggb-privileged:missing-token-0000",
        },
        "restore-missing",
      ),
      context("restore-missing-turn"),
    );
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "consent_required" },
    });
    expect(fixture.restore).not.toHaveBeenCalled();

    const confirmationId = fixture.privileged.issue({
      ...common,
      action: "restore_geometry_checkpoint",
      checkpointId,
    });
    const restored = await fixture.gateway.execute(
      call(
        "restore_geometry_checkpoint",
        { ...common, checkpointId, confirmationId },
        "restore-exact",
      ),
      context("restore-exact-turn"),
    );
    expect(restored).toMatchObject({
      ok: true,
      revision: 3,
      data: {
        status: "restored",
        checkpointId,
        recovery: "exact",
        epoch: 2,
        revision: 3,
        snapshotHash: "world-hash",
        listenerCount: 4,
      },
    });
    expect(fixture.restore).toHaveBeenCalledTimes(1);
  });

  it("falls back once to the activity baseline and freezes if both restores fail", async () => {
    const recovered = evidenceFixture({ restoreOutcomes: [false, true] });
    await captureConvex(recovered);
    const target = recovered.store.getCheckpoint(
      recovered.store.list()[0].checkpointId,
    )!;
    recovered.store.setBaseline({ ...target, id: "baseline_checkpoint" });
    authorizeRestore(recovered.authority);
    const confirmationId = recovered.privileged.issue({
      ...common,
      action: "restore_geometry_checkpoint",
      checkpointId: target.id,
    });
    const result = await recovered.gateway.execute(
      call("restore_geometry_checkpoint", {
        ...common,
        checkpointId: target.id,
        confirmationId,
      }),
      context("baseline-turn"),
    );
    expect(result).toMatchObject({
      ok: true,
      revision: 4,
      data: {
        recovery: "baseline",
        checkpointId: "baseline_checkpoint",
        requestedCheckpointId: target.id,
      },
    });
    expect(recovered.restore).toHaveBeenCalledTimes(2);

    const fatal = evidenceFixture({ restoreOutcomes: [false, false] });
    await captureConvex(fatal);
    const fatalTarget = fatal.store.getCheckpoint(fatal.store.list()[0].checkpointId)!;
    fatal.store.setBaseline({ ...fatalTarget, id: "baseline_fatal" });
    authorizeRestore(fatal.authority);
    const fatalConfirmation = fatal.privileged.issue({
      ...common,
      action: "restore_geometry_checkpoint",
      checkpointId: fatalTarget.id,
    });
    const failed = await fatal.gateway.execute(
      call("restore_geometry_checkpoint", {
        ...common,
        checkpointId: fatalTarget.id,
        confirmationId: fatalConfirmation,
      }),
      context("fatal-turn"),
    );
    expect(failed).toMatchObject({
      ok: false,
      error: { code: "restore_failed" },
    });
    expect(fatal.gateway.isMutationFrozen()).toBe(true);
  });

  it("requires O5 prior attempt and consent, then never credits learner completion", async () => {
    const fixture = evidenceFixture();
    Object.assign(fixture.authority, {
      missionId: "V8",
      maxLevel: "O5",
      attemptedDemonstrationStepIds: ["demo_v8_7"],
    });
    const consentToken = fixture.privileged.issue({
      ...common,
      action: "demonstrate_geometry_step",
      stepId: "demo_v8_7",
      speed: "reduced",
    });
    const result = await fixture.gateway.execute(
      call("demonstrate_geometry_step", {
        ...common,
        stepId: "demo_v8_7",
        consentToken,
        speed: "reduced",
      }),
      context(),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "completed",
        learnerCompleted: false,
        restoration: "checkpoint",
        evidence: { actor: "assistant_demo" },
      },
    });
    expect(fixture.runReplay).toHaveBeenCalledTimes(1);
  });
});

function evidenceFixture(
  options: { evaluated?: boolean; restoreOutcomes?: boolean[] } = {},
) {
  const baseWorld = worldFixture();
  const world =
    options.evaluated === false
      ? baseWorld
      : evaluateGeometryWorldV2(VARIGNON_ACTIVITY_FR_V1, baseWorld).world;
  const registry = new SceneRegistry();
  for (const object of world.objects) {
    registry.register(object.name, object.owner, "point");
  }
  const store = new GeometryEvidenceStoreV1();
  const checkpoint = (): GeometryCheckpointV1 => ({
    id: "checkpoint_V3_convex_e1_r2_world-hash",
    activityId,
    epoch: 1,
    revision: 2,
    snapshotHash: world.snapshotHash,
    base64: "base64-secret",
    inventory: world.objects.map(({ name }) => name).sort(),
    registry: registry.list(),
    listenerCount: 4,
    createdAt: 1_000,
  });
  const capture = vi.fn(async () => ({
    ok: true as const,
    checkpoint: checkpoint(),
    world,
  }));
  let restoreIndex = 0;
  const restore = vi.fn(async () => {
    const ok = options.restoreOutcomes?.[restoreIndex++] ?? true;
    return ok
      ? {
          ok: true as const,
          world,
          listenerCountBefore: 4,
          listenerCountAfter: 4,
        }
      : {
          ok: false as const,
          code: "restore_failed" as const,
          message: "diverged",
          listenerCountBefore: 4,
          listenerCountAfter: 3,
        };
  });
  const runReplay = vi.fn(async () => ({
    status: "completed" as const,
    stepId: "demo_v8_7",
    playedStepIds: ["demo_v8_1", "demo_v8_7"],
    temporaryObjects: [],
    restoration: "checkpoint" as const,
    learnerCompleted: false as const,
    evidence: {
      kind: "demonstration_viewed" as const,
      stepId: "demo_v8_7",
      actor: "assistant_demo" as const,
    },
  }));
  const privileged = new GeometryPrivilegedConsentStoreV1({
    now: () => 1_000,
    createToken: tokenFactory(),
  });
  const authority: MutableAuthority = {
    activityId,
    epoch: 1,
    revision: 2,
    phase: "investigating",
    actor: "assistant",
    maxLevel: "O2",
    missionId: "V3",
    uiGuidanceAllowed: true,
    attemptedVariationTargets: [],
    attemptedDemonstrationStepIds: [],
    learnerActionCurrent: true,
  };
  let restoreRevision = 2;
  const api: GeoGebraApi = {
    evalCommand: vi.fn(() => true),
    exists: vi.fn(() => true),
    getCommandString: vi.fn(() => ""),
    isDefined: vi.fn(() => true),
    setCoordSystem: vi.fn(),
    setLabelVisible: vi.fn(),
  };
  const gateway = new GeometryActionGatewayV1({
    api,
    activity: VARIGNON_ACTIVITY_FR_V1,
    registry,
    getAuthority: () => authority,
    getWorld: () => world,
    evidenceStore: store,
    checkpoints: { capture, restore } as unknown as GeometryCheckpointControllerV1,
    privilegedTokens: privileged,
    replay: {
      run: runReplay,
      stop: vi.fn(() => false),
    } as unknown as GeometryReplayControllerV1,
    getEvidenceActor: () => "learner",
    createThumbnail: async () => "data:image/png;base64,thumbnail",
    nextRestoreAuthority: () => ({
      activityId,
      epoch: 2,
      revision: ++restoreRevision,
    }),
    now: () => 1_000,
  });
  return {
    gateway,
    authority,
    store,
    privileged,
    capture,
    restore,
    runReplay,
  };
}

type MutableAuthority = {
  -readonly [Key in keyof GeometryActionAuthorityV1]: GeometryActionAuthorityV1[Key];
} & {
  maxLevel: GeometryActionAuthorityV1["maxLevel"];
  missionId: string;
  attemptedDemonstrationStepIds: string[];
};

async function captureConvex(fixture: ReturnType<typeof evidenceFixture>) {
  return fixture.gateway.execute(
    call("capture_geometry_evidence", {
      ...common,
      missionId: "V3",
      configuration: "convex",
      requiredFactIds: ["rel_configuration_convex"],
    }),
    context(),
  );
}

function authorizeRestore(authority: MutableAuthority) {
  authority.missionId = "V7";
  authority.maxLevel = "O4";
  authority.learnerActionCurrent = false;
}

function context(turnId = "turn-c05"): GatewayContext {
  return {
    turnId,
    phase: "constructing",
    epoch: 1,
    revision: 2,
    isAuthorityCurrent: () => true,
  };
}

function call(name: string, arguments_: unknown, callId = `call-${name}`) {
  return { callId, name, arguments: JSON.stringify(arguments_) };
}

function tokenFactory() {
  let index = 0;
  return () => `ggb-privileged:55555555-5555-5555-5555-${String(++index).padStart(12, "0")}`;
}

function worldFixture() {
  const objects = [
    point("A", -4, -1, "A=(-4,-1)"),
    point("B", -1, -3, "B=(-1,-3)"),
    point("C", 4, -1, "C=(4,-1)"),
    point("D", 1, 3, "D=(1,3)"),
    point("E", -2.5, -2, "E=Midpoint(A,B)"),
    point("F", 1.5, -2, "F=Midpoint(B,C)"),
    point("G", 2.5, 1, "G=Midpoint(C,D)"),
    point("H", -1.5, 1, "H=Midpoint(D,A)"),
  ];
  return GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId,
    epoch: 1,
    revision: 2,
    snapshotHash: "world-hash",
    objectCount: objects.length,
    truncated: false,
    objects,
    facts: [],
    change: {
      kind: "drag_end",
      objectNames: ["A"],
      terminal: true,
      actor: "learner",
      occurredAt: 1,
    },
  });
}

function point(
  name: string,
  x: number,
  y: number,
  command: string,
): GeometryWorldObjectV2 {
  const midpoint = /Midpoint\(([A-D]),([A-D])\)/.exec(command);
  return {
    name,
    type: "point",
    command,
    parents: midpoint ? [midpoint[1], midpoint[2]] : [],
    dependencyStatus: "known",
    owner: name < "E" ? "scaffold" : "student",
    x,
    y,
    color: "#000000",
    visible: true,
  };
}

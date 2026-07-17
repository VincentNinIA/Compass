import { describe, expect, it, vi } from "vitest";

import type { GeometryActionAuthorityV1 } from "./authority";
import type { GeometryCheckpointControllerV1 } from "./checkpoint-v2";
import { GeometryWorldV2 } from "./contracts";
import { GeometryReplayControllerV1 } from "./replay";
import type { GeometryUiEffectsV1 } from "./ui-effects";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

describe("GeometryReplayControllerV1", () => {
  it("plays the approved sequence in reduced motion then restores exactly", async () => {
    const fixture = replayFixture();
    const result = await fixture.replay.run({
      stepId: "demo_v8_7",
      speed: "reduced",
    });
    expect(result).toMatchObject({
      status: "completed",
      stepId: "demo_v8_7",
      restoration: "checkpoint",
      learnerCompleted: false,
      evidence: {
        kind: "demonstration_viewed",
        actor: "assistant_demo",
      },
    });
    expect(result.playedStepIds).toEqual([
      "demo_v8_1",
      "demo_v8_2",
      "demo_v8_3",
      "demo_v8_4",
      "demo_v8_5",
      "demo_v8_6",
      "demo_v8_7",
    ]);
    expect(fixture.highlight).toHaveBeenCalledTimes(6);
    expect(fixture.restore).toHaveBeenCalledTimes(1);
    expect(result.temporaryObjects).toEqual([]);
    expect(fixture.statuses).toEqual(["playing", "restoring", "idle"]);
    expect(fixture.onRestoredWorld).toHaveBeenCalledWith(fixture.world);
  });

  it("supports pause and resume without advancing the next step", async () => {
    let releaseDelay: (() => void) | undefined;
    const fixture = replayFixture({
      delay: (_delay, signal) =>
        new Promise<void>((resolve, reject) => {
          releaseDelay = resolve;
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    });
    const pending = fixture.replay.run({
      stepId: "demo_v8_2",
      speed: "normal",
    });
    await vi.waitFor(() => expect(releaseDelay).toBeTypeOf("function"));
    expect(fixture.replay.pause()).toBe(true);
    const releaseFirst = releaseDelay;
    releaseDelay = undefined;
    releaseFirst?.();
    await Promise.resolve();
    expect(fixture.highlight).toHaveBeenCalledTimes(1);
    expect(fixture.replay.resume()).toBe(true);
    await vi.waitFor(() => expect(releaseDelay).toBeTypeOf("function"));
    (releaseDelay as (() => void) | undefined)?.();
    const result = await pending;
    expect(result.status).toBe("completed");
    expect(fixture.statuses).toContain("paused");
  });

  it("stop during a step cancels playback and still restores the checkpoint", async () => {
    const fixture = replayFixture({
      delay: (_delay, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    });
    const pending = fixture.replay.run({
      stepId: "demo_v8_7",
      speed: "normal",
    });
    await vi.waitFor(() => expect(fixture.highlight).toHaveBeenCalledTimes(1));
    expect(fixture.replay.stop()).toBe(true);
    const result = await pending;
    expect(result.status).toBe("cancelled");
    expect(fixture.cleanup).toHaveBeenCalled();
    expect(fixture.restore).toHaveBeenCalledTimes(1);
    expect(fixture.replay.status).toBe("idle");
  });

  it("never restores an older checkpoint over a learner interaction", async () => {
    const fixture = replayFixture({
      delay: (_delay, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    });
    const pending = fixture.replay.run({
      stepId: "demo_v8_7",
      speed: "normal",
    });
    await vi.waitFor(() => expect(fixture.highlight).toHaveBeenCalledTimes(1));

    expect(
      fixture.replay.stop({ preserveLearnerWorld: true }),
    ).toBe(true);

    const result = await pending;
    expect(result).toMatchObject({
      status: "cancelled",
      restoration: "learner_world_preserved",
    });
    expect(result).not.toHaveProperty("evidence");
    expect(fixture.cleanup).toHaveBeenCalled();
    expect(fixture.restore).not.toHaveBeenCalled();
    expect(fixture.onRestoredWorld).not.toHaveBeenCalled();
    expect(fixture.statuses).toEqual(["playing", "idle"]);
  });

  it("cancels at the restore barrier before publishing an older world", async () => {
    const fixture = replayFixture({ cancelRestoreOnAbort: true });
    const pending = fixture.replay.run({
      stepId: "demo_v8_7",
      speed: "reduced",
    });
    await vi.waitFor(() => expect(fixture.replay.status).toBe("restoring"));

    expect(fixture.replay.stop({ preserveLearnerWorld: true })).toBe(true);

    const result = await pending;
    expect(result).toMatchObject({
      status: "cancelled",
      restoration: "learner_world_preserved",
    });
    expect(result).not.toHaveProperty("evidence");
    expect(fixture.restore).toHaveBeenCalledTimes(1);
    expect(fixture.onRestoredWorld).not.toHaveBeenCalled();
    expect(fixture.statuses).toEqual(["playing", "restoring", "idle"]);
  });

  it("freezes mutations when terminal checkpoint restoration diverges", async () => {
    const freeze = vi.fn();
    const fixture = replayFixture({ restoreOk: false, freeze });
    await expect(
      fixture.replay.run({ stepId: "demo_v8_1", speed: "reduced" }),
    ).rejects.toMatchObject({ code: "rollback_failed" });
    expect(freeze).toHaveBeenCalledTimes(1);
  });
});

function replayFixture(
  options: {
    delay?: (delayMs: number, signal: AbortSignal) => Promise<void>;
    restoreOk?: boolean;
    cancelRestoreOnAbort?: boolean;
    freeze?: (reason: string) => void;
  } = {},
) {
  const world = GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId: VARIGNON_ACTIVITY_FR_V1.id,
    epoch: 1,
    revision: 2,
    snapshotHash: "replay-hash",
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
  const checkpoint = {
    id: "replay_demo_v8_7_e1_r2",
    activityId: VARIGNON_ACTIVITY_FR_V1.id,
    epoch: 1,
    revision: 2,
    snapshotHash: world.snapshotHash,
    base64: "replay-base64",
    inventory: [],
    registry: [],
    listenerCount: 4,
    createdAt: 1,
  };
  const capture = vi.fn(async () => ({ ok: true as const, checkpoint, world }));
  const restore = vi.fn(async (
    _checkpoint: unknown,
    restoreAuthority: { signal?: AbortSignal },
  ) => {
    if (options.cancelRestoreOnAbort && !restoreAuthority.signal?.aborted) {
      await new Promise<void>((resolve) =>
        restoreAuthority.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    }
    return options.cancelRestoreOnAbort && restoreAuthority.signal?.aborted
      ? {
          ok: false as const,
          code: "cancelled" as const,
          message: "cancelled at barrier",
          listenerCountBefore: 4,
          listenerCountAfter: 4,
        }
      : options.restoreOk === false
      ? {
          ok: false as const,
          code: "restore_failed" as const,
          message: "diverged",
          listenerCountBefore: 4,
          listenerCountAfter: 3,
        }
      : {
          ok: true as const,
          world,
          listenerCountBefore: 4,
          listenerCountAfter: 4,
        };
  });
  const highlight = vi.fn();
  const cleanup = vi.fn(() => ({ ok: true, restored: [] }));
  const statuses: string[] = [];
  const onRestoredWorld = vi.fn();
  const authority: GeometryActionAuthorityV1 = {
    activityId: VARIGNON_ACTIVITY_FR_V1.id,
    epoch: 1,
    revision: 2,
    phase: "investigating",
    actor: "assistant",
    maxLevel: "O5",
    missionId: "V8",
    uiGuidanceAllowed: true,
    attemptedVariationTargets: [],
    attemptedDemonstrationStepIds: ["demo_v8_7"],
  };
  const replay = new GeometryReplayControllerV1({
    activity: VARIGNON_ACTIVITY_FR_V1,
    uiEffects: { highlight, cleanup } as unknown as GeometryUiEffectsV1,
    checkpoints: { capture, restore } as unknown as GeometryCheckpointControllerV1,
    getAuthority: () => authority,
    nextRestoreAuthority: () => ({
      activityId: authority.activityId,
      epoch: 1,
      revision: 3,
    }),
    delay: options.delay,
    onStatus: (status) => statuses.push(status),
    onRestoredWorld,
    freezeMutations: options.freeze,
    now: () => 1,
  });
  return {
    replay,
    capture,
    restore,
    highlight,
    cleanup,
    statuses,
    onRestoredWorld,
    world,
  };
}

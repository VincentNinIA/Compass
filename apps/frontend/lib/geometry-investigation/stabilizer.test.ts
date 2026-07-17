import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeometryWorldV2, type GeometryWorldChangeV2 } from "./contracts";
import { GeometryWorldObserverV2, GeometryWorldStabilizerV2 } from "./stabilizer";
import { SceneRegistry } from "@/lib/geogebra/scene";

describe("GeometryWorldStabilizerV2", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ignores per-pixel movement and emits one terminal drag after two identical snapshots", async () => {
    const onCommit = vi.fn();
    const readWorld = vi.fn((revision: number, change: GeometryWorldChangeV2) =>
      world(revision, change, "hash-drag"),
    );
    const stabilizer = new GeometryWorldStabilizerV2({
      readWorld,
      getAuthority: () => ({ activityId: "activity_v1", epoch: 1 }),
      onCommit,
      now: () => Date.now(),
    });

    stabilizer.observe({ type: "movingGeos", argument: "E" });
    await vi.advanceTimersByTimeAsync(500);
    expect(readWorld).not.toHaveBeenCalled();

    stabilizer.observe({ type: "dragEnd", argument: "E" });
    await vi.advanceTimersByTimeAsync(229);
    expect(onCommit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(readWorld).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toMatchObject({
      world: { change: { kind: "drag_end", objectNames: ["E"] } },
      delta: {
        schemaVersion: "geometry_world_delta.v2",
        previousRevision: null,
      },
    });
  });

  it("coalesces update bursts and preserves the precise terminal event", async () => {
    const onCommit = vi.fn();
    const stabilizer = new GeometryWorldStabilizerV2({
      readWorld: (revision, change) => world(revision, change, "hash-updated"),
      getAuthority: () => ({ activityId: "activity_v1", epoch: 1 }),
      onCommit,
      now: () => Date.now(),
    });

    for (let index = 0; index < 30; index += 1) {
      stabilizer.observe({ type: "update", target: "E" });
    }
    stabilizer.observe({ type: "movedGeos", argument: '["E","F"]' });
    await vi.advanceTimersByTimeAsync(230);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].world.change).toMatchObject({
      kind: "moved_geos",
      objectNames: ["E", "F"],
    });
  });

  it("fails closed when snapshots never stabilize", async () => {
    let sample = 0;
    const onCommit = vi.fn();
    const stabilizer = new GeometryWorldStabilizerV2({
      readWorld: (revision, change) =>
        world(revision, change, `hash-${++sample}`),
      getAuthority: () => ({ activityId: "activity_v1", epoch: 1 }),
      onCommit,
      now: () => Date.now(),
      maxStabilityMs: 200,
    });

    stabilizer.observe({ type: "add", target: "E" });
    await vi.advanceTimersByTimeAsync(500);

    expect(sample).toBeGreaterThan(2);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("rejects an observation when authority changes during sampling", async () => {
    let epoch = 1;
    const onCommit = vi.fn();
    const stabilizer = new GeometryWorldStabilizerV2({
      readWorld: (revision, change) => {
        const result = world(revision, change, "hash-stale", epoch);
        epoch = 2;
        return result;
      },
      getAuthority: () => ({ activityId: "activity_v1", epoch }),
      onCommit,
      now: () => Date.now(),
    });

    stabilizer.observe({ type: "add", target: "E" });
    await vi.advanceTimersByTimeAsync(500);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("synchronizes a restored world before deriving the next revision", async () => {
    const onCommit = vi.fn();
    const readWorld = vi.fn((revision: number, change: GeometryWorldChangeV2) =>
      world(revision, change, "hash-after", 2),
    );
    const stabilizer = new GeometryWorldStabilizerV2({
      readWorld,
      getAuthority: () => ({ activityId: "activity_v1", epoch: 2 }),
      onCommit,
      now: () => Date.now(),
    });
    stabilizer.synchronize(
      world(
        8,
        {
          kind: "undo",
          objectNames: ["E"],
          terminal: true,
          actor: "system",
          occurredAt: 1,
        },
        "hash-restored",
        2,
      ),
    );
    stabilizer.observe({ type: "update", target: "E" });
    await vi.advanceTimersByTimeAsync(230);
    expect(readWorld).toHaveBeenCalledWith(9, expect.anything());
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe("GeometryWorldObserverV2 learner interaction", () => {
  it("notifies direct learner gestures but not assistant observations", () => {
    const onLearnerInteraction = vi.fn();
    const adapter = {
      epoch: 1,
      registerClientListener: vi.fn(() => ({ ok: true as const, value: undefined })),
      registerObjectListener: vi.fn(() => ({ ok: true as const, value: undefined })),
      unregisterClientListener: vi.fn(() => ({ ok: true as const, value: undefined })),
      unregisterObjectListener: vi.fn(() => ({ ok: true as const, value: undefined })),
      withApi: vi.fn(),
    };
    const observer = new GeometryWorldObserverV2(
      adapter as never,
      new SceneRegistry(),
      "activity_v1",
      vi.fn(),
      { onLearnerInteraction },
    );

    observer.observe({ type: "movingGeos", argument: "A" });
    observer.observe({ type: "dragEnd", argument: "A" });
    observer.observe({ type: "select", argument: "A" });
    observer.observe({ type: "deselect", argument: "A" });
    observer.observe({ type: "update", argument: "A" });
    observer.observe({ type: "add", argument: "helper" }, "assistant");

    expect(onLearnerInteraction).toHaveBeenCalledTimes(4);
  });
});

function world(
  revision: number,
  change: GeometryWorldChangeV2,
  snapshotHash: string,
  epoch = 1,
) {
  return GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId: "activity_v1",
    epoch,
    revision,
    snapshotHash,
    objectCount: 1,
    truncated: false,
    objects: [
      {
        name: "E",
        type: "point",
        command: "Midpoint(A,B)",
        parents: ["A", "B"],
        dependencyStatus: "known",
        owner: "student",
        x: 0,
        y: 0,
        visible: true,
      },
    ],
    facts: [],
    change,
  });
}

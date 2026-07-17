import { describe, expect, it } from "vitest";

import {
  GEOMETRY_EVIDENCE_MAX_BYTES,
  GEOMETRY_EVIDENCE_MAX_CAPTURES,
  GeometryEvidenceStoreV1,
  type GeometryCheckpointV1,
} from "./evidence-store";

describe("GeometryEvidenceStoreV1", () => {
  it("stores an immutable capture and keeps Base64 private", () => {
    const store = new GeometryEvidenceStoreV1();
    const result = store.add(entry("capture_1", "checkpoint_1", "convex"));
    expect(result).toMatchObject({ ok: true, status: "stored" });
    expect(store.list()).toEqual([
      expect.objectContaining({ id: "capture_1", configuration: "convex" }),
    ]);
    expect(store.list()[0]).not.toHaveProperty("base64");
    expect(Object.isFrozen(store.list()[0])).toBe(true);
    expect(store.getCheckpoint("checkpoint_1")?.base64).toBe("base64-checkpoint_1");
  });

  it("is idempotent for the same capture and rejects conflicting reuse", () => {
    const store = new GeometryEvidenceStoreV1();
    expect(store.add(entry("capture_1", "checkpoint_1", "convex"))).toMatchObject({
      ok: true,
      status: "stored",
    });
    expect(store.add(entry("capture_1", "checkpoint_1", "convex"))).toMatchObject({
      ok: true,
      status: "existing",
    });
    expect(store.add(entry("capture_1", "checkpoint_2", "convex"))).toMatchObject({
      ok: false,
      code: "capture_conflict",
    });
    expect(store.report().captureCount).toBe(1);
  });

  it("enforces eight captures without retaining a ninth partial entry", () => {
    const store = new GeometryEvidenceStoreV1();
    for (let index = 0; index < GEOMETRY_EVIDENCE_MAX_CAPTURES; index += 1) {
      expect(
        store.add(
          entry(
            `capture_${index}`,
            `checkpoint_${index}`,
            index % 2 === 0 ? "convex" : "concave",
          ),
        ),
      ).toMatchObject({ ok: true });
    }
    expect(
      store.add(entry("capture_9", "checkpoint_9", "crossed")),
    ).toMatchObject({ ok: false, code: "capture_limit" });
    expect(store.report().captureCount).toBe(8);
  });

  it("drops an oversized optional thumbnail but keeps an admissible checkpoint", () => {
    const store = new GeometryEvidenceStoreV1();
    const result = store.add({
      ...entry("capture_1", "checkpoint_1", "convex"),
      thumbnailDataUrl: `data:image/png;base64,${"x".repeat(
        GEOMETRY_EVIDENCE_MAX_BYTES,
      )}`,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "stored_without_thumbnail",
    });
    if (result.ok) expect(result.entry.thumbnailDataUrl).toBeUndefined();
  });

  it("reports provenance and clears activity memory", () => {
    const store = new GeometryEvidenceStoreV1();
    store.add(entry("capture_1", "checkpoint_1", "convex", "learner"));
    store.add(
      entry("capture_2", "checkpoint_2", "concave", "assistant_demo"),
    );
    expect(store.report("varignon_fr_v1")).toMatchObject({
      captureCount: 2,
      learnerCaptures: 1,
      assistantDemoCaptures: 1,
      configurations: ["convex", "concave"],
    });
    expect(store.clear("varignon_fr_v1")).toBe(2);
    expect(store.report().captureCount).toBe(0);
  });
});

function entry(
  captureId: string,
  checkpointId: string,
  configuration: "convex" | "concave" | "crossed",
  actor: "learner" | "assistant_demo" = "learner",
) {
  const checkpoint = {
    id: checkpointId,
    activityId: "varignon_fr_v1",
    epoch: 1,
    revision: Number(captureId.match(/\d+/)?.[0] ?? 1),
    snapshotHash: `hash-${captureId}`,
    base64: `base64-${checkpointId}`,
    inventory: ["A", "B", "C", "D"],
    registry: [
      { name: "A", owner: "scaffold", kind: "point" },
      { name: "B", owner: "scaffold", kind: "point" },
      { name: "C", owner: "scaffold", kind: "point" },
      { name: "D", owner: "scaffold", kind: "point" },
    ],
    listenerCount: 4,
    createdAt: 1_000,
  } as const satisfies GeometryCheckpointV1;
  return {
    capture: {
      schemaVersion: "geometry_evidence_capture.v1" as const,
      id: captureId,
      activityId: checkpoint.activityId,
      missionId: "V3",
      configuration,
      epoch: checkpoint.epoch,
      revision: checkpoint.revision,
      snapshotHash: checkpoint.snapshotHash,
      checkpointId,
      objectNames: [...checkpoint.inventory],
      factIds: [`rel_configuration_${configuration}`],
      createdAt: 1_000,
      actor,
    },
    checkpoint,
  };
}

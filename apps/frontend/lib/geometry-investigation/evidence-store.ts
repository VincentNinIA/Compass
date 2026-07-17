import type { SceneObject } from "@/types/geogebra";

import {
  GeometryEvidenceCaptureV1,
  type GeometryEvidenceCaptureV1 as GeometryEvidenceCaptureV1Type,
} from "./contracts";

export const GEOMETRY_EVIDENCE_MAX_CAPTURES = 8 as const;
export const GEOMETRY_EVIDENCE_MAX_BYTES = 12 * 1024 * 1024;

export type GeometryCheckpointV1 = Readonly<{
  id: string;
  activityId: string;
  epoch: number;
  revision: number;
  snapshotHash: string;
  base64: string;
  inventory: readonly string[];
  registry: readonly SceneObject[];
  listenerCount: number;
  createdAt: number;
}>;

export type GeometryEvidenceEntryV1 = Readonly<{
  capture: GeometryEvidenceCaptureV1Type;
  checkpoint: GeometryCheckpointV1;
  thumbnailDataUrl?: string;
  byteSize: number;
}>;

export type GeometryEvidenceStoreResultV1 =
  | Readonly<{
      ok: true;
      status: "stored" | "stored_without_thumbnail" | "existing";
      entry: GeometryEvidenceEntryV1;
    }>
  | Readonly<{
      ok: false;
      code: "capture_limit" | "quota_exceeded" | "capture_conflict";
      message: string;
    }>;

export type GeometryEvidenceStoreReportV1 = Readonly<{
  activityId?: string;
  captureCount: number;
  byteSize: number;
  remainingBytes: number;
  configurations: readonly ("convex" | "concave" | "crossed")[];
  learnerCaptures: number;
  assistantDemoCaptures: number;
}>;

export class GeometryEvidenceStoreV1 {
  private readonly entries = new Map<string, GeometryEvidenceEntryV1>();
  private baseline?: GeometryCheckpointV1;
  private bytes = 0;

  add(input: Readonly<{
    capture: GeometryEvidenceCaptureV1Type;
    checkpoint: GeometryCheckpointV1;
    thumbnailDataUrl?: string;
  }>): GeometryEvidenceStoreResultV1 {
    const capture = GeometryEvidenceCaptureV1.parse(input.capture);
    const checkpoint = freezeCheckpoint(input.checkpoint);
    assertCaptureCheckpointMatch(capture, checkpoint);
    const existing = this.entries.get(capture.id);
    if (existing) {
      return sameEntryIdentity(existing, capture, checkpoint)
        ? { ok: true, status: "existing", entry: existing }
        : {
            ok: false,
            code: "capture_conflict",
            message: "Capture ID already refers to a different checkpoint.",
          };
    }
    if (this.entries.size >= GEOMETRY_EVIDENCE_MAX_CAPTURES) {
      return {
        ok: false,
        code: "capture_limit",
        message: "The activity already contains eight captures.",
      };
    }
    const baseSize = byteSize({ capture, checkpoint });
    if (this.bytes + baseSize > GEOMETRY_EVIDENCE_MAX_BYTES) {
      return {
        ok: false,
        code: "quota_exceeded",
        message: "The checkpoint exceeds the remaining in-memory quota.",
      };
    }
    const thumbnailSize = input.thumbnailDataUrl
      ? utf8Bytes(input.thumbnailDataUrl)
      : 0;
    const thumbnailStored =
      Boolean(input.thumbnailDataUrl) &&
      this.bytes + baseSize + thumbnailSize <= GEOMETRY_EVIDENCE_MAX_BYTES;
    const entry = Object.freeze({
      capture: deepFreezeCapture(capture),
      checkpoint,
      ...(thumbnailStored
        ? { thumbnailDataUrl: String(input.thumbnailDataUrl) }
        : {}),
      byteSize: baseSize + (thumbnailStored ? thumbnailSize : 0),
    }) satisfies GeometryEvidenceEntryV1;
    this.entries.set(capture.id, entry);
    this.bytes += entry.byteSize;
    return {
      ok: true,
      status:
        input.thumbnailDataUrl && !thumbnailStored
          ? "stored_without_thumbnail"
          : "stored",
      entry,
    };
  }

  list(activityId?: string): readonly GeometryEvidenceCaptureV1Type[] {
    return Object.freeze(
      [...this.entries.values()]
        .filter(({ capture }) => !activityId || capture.activityId === activityId)
        .map(({ capture }) => capture)
        .sort((left, right) => left.createdAt - right.createdAt),
    );
  }

  getCapture(id: string): GeometryEvidenceCaptureV1Type | undefined {
    return this.entries.get(id)?.capture;
  }

  getCheckpoint(id: string): GeometryCheckpointV1 | undefined {
    const direct = [...this.entries.values()].find(
      ({ checkpoint }) => checkpoint.id === id,
    )?.checkpoint;
    return direct ?? (this.baseline?.id === id ? this.baseline : undefined);
  }

  setBaseline(checkpoint: GeometryCheckpointV1): void {
    this.baseline = freezeCheckpoint(checkpoint);
  }

  getBaseline(activityId: string): GeometryCheckpointV1 | undefined {
    return this.baseline?.activityId === activityId ? this.baseline : undefined;
  }

  remove(captureId: string): boolean {
    const entry = this.entries.get(captureId);
    if (!entry) return false;
    this.entries.delete(captureId);
    this.bytes -= entry.byteSize;
    return true;
  }

  clear(activityId?: string): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (activityId && entry.capture.activityId !== activityId) continue;
      this.entries.delete(id);
      this.bytes -= entry.byteSize;
      removed += 1;
    }
    if (!activityId || this.baseline?.activityId === activityId) {
      this.baseline = undefined;
    }
    return removed;
  }

  report(activityId?: string): GeometryEvidenceStoreReportV1 {
    const entries = [...this.entries.values()].filter(
      ({ capture }) => !activityId || capture.activityId === activityId,
    );
    const entryBytes = entries.reduce((sum, { byteSize: size }) => sum + size, 0);
    return Object.freeze({
      ...(activityId ? { activityId } : {}),
      captureCount: entries.length,
      byteSize: entryBytes,
      remainingBytes: Math.max(0, GEOMETRY_EVIDENCE_MAX_BYTES - this.bytes),
      configurations: Object.freeze(
        [...new Set(entries.map(({ capture }) => capture.configuration))],
      ),
      learnerCaptures: entries.filter(({ capture }) => capture.actor === "learner")
        .length,
      assistantDemoCaptures: entries.filter(
        ({ capture }) => capture.actor === "assistant_demo",
      ).length,
    });
  }
}

function freezeCheckpoint(
  checkpoint: GeometryCheckpointV1,
): GeometryCheckpointV1 {
  if (
    !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(checkpoint.id) ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(checkpoint.activityId) ||
    !Number.isInteger(checkpoint.epoch) ||
    checkpoint.epoch < 0 ||
    !Number.isInteger(checkpoint.revision) ||
    checkpoint.revision < 0 ||
    checkpoint.base64.length === 0 ||
    checkpoint.base64.length > GEOMETRY_EVIDENCE_MAX_BYTES ||
    new Set(checkpoint.inventory).size !== checkpoint.inventory.length ||
    checkpoint.listenerCount < 0
  ) {
    throw new Error("Invalid geometry checkpoint.");
  }
  return Object.freeze({
    ...checkpoint,
    inventory: Object.freeze([...checkpoint.inventory]),
    registry: Object.freeze(
      checkpoint.registry.map((object) => Object.freeze({ ...object })),
    ),
  });
}

function assertCaptureCheckpointMatch(
  capture: GeometryEvidenceCaptureV1Type,
  checkpoint: GeometryCheckpointV1,
): void {
  if (
    capture.checkpointId !== checkpoint.id ||
    capture.activityId !== checkpoint.activityId ||
    capture.epoch !== checkpoint.epoch ||
    capture.revision !== checkpoint.revision ||
    capture.snapshotHash !== checkpoint.snapshotHash ||
    capture.objectNames.length !== checkpoint.inventory.length ||
    !capture.objectNames.every(
      (name, index) => name === checkpoint.inventory[index],
    )
  ) {
    throw new Error("Capture and checkpoint anchors do not match.");
  }
}

function sameEntryIdentity(
  entry: GeometryEvidenceEntryV1,
  capture: GeometryEvidenceCaptureV1Type,
  checkpoint: GeometryCheckpointV1,
): boolean {
  return (
    entry.capture.snapshotHash === capture.snapshotHash &&
    entry.capture.checkpointId === checkpoint.id &&
    entry.checkpoint.base64 === checkpoint.base64
  );
}

function deepFreezeCapture(
  capture: GeometryEvidenceCaptureV1Type,
): GeometryEvidenceCaptureV1Type {
  return Object.freeze({
    ...capture,
    objectNames: Object.freeze([...capture.objectNames]),
    factIds: Object.freeze([...capture.factIds]),
  }) as GeometryEvidenceCaptureV1Type;
}

function byteSize(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

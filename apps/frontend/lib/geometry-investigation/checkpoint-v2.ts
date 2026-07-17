import type { SceneRegistry } from "@/lib/geogebra/scene";
import type { GeoGebraApi, SceneObject, SceneObjectKind } from "@/types/geogebra";

import type { GeometryWorldV2 } from "./contracts";
import type { GeometryCheckpointV1 } from "./evidence-store";
import { readGeometryWorldV2 } from "./world";

export const GEOMETRY_CHECKPOINT_CALLBACK_TIMEOUT_MS = 3_000 as const;

export type GeometryCheckpointCaptureResultV1 =
  | Readonly<{ ok: true; checkpoint: GeometryCheckpointV1; world: GeometryWorldV2 }>
  | Readonly<{
      ok: false;
      code:
        | "workspace_unavailable"
        | "snapshot_unstable"
        | "checkpoint_unavailable"
        | "cancelled";
      message: string;
    }>;

export type GeometryCheckpointRestoreResultV1 =
  | Readonly<{
      ok: true;
      world: GeometryWorldV2;
      listenerCountBefore: number;
      listenerCountAfter: number;
    }>
  | Readonly<{
      ok: false;
      code: "restore_failed" | "cancelled";
      message: string;
      listenerCountBefore: number;
      listenerCountAfter: number;
    }>;

type ListenerSuspension = Readonly<{
  listenerCountBefore: number;
  resume(): number;
}>;

type TimerHandle = ReturnType<typeof setTimeout>;

export class GeometryCheckpointControllerV1 {
  constructor(
    private readonly dependencies: Readonly<{
      api: GeoGebraApi;
      registry: SceneRegistry;
      getWorld(): GeometryWorldV2;
      getListenerCount?: () => number;
      suspendListeners?: () => ListenerSuspension;
      reconcileListeners?: () => boolean;
      waitForStableRead?: () => Promise<void>;
      onRestoreStatus?: (restoring: boolean) => void;
      waitForRestoreBarrier?: () => Promise<void>;
      timeoutMs?: number;
      setTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
      clearTimeout?: (timer: TimerHandle) => void;
    }>,
  ) {}

  async capture(
    input: Readonly<{
      id: string;
      createdAt: number;
      signal?: AbortSignal;
    }>,
  ): Promise<GeometryCheckpointCaptureResultV1> {
    if (!this.dependencies.api.getBase64) {
      return captureFailure(
        "workspace_unavailable",
        "GeoGebra checkpoint export is unavailable.",
      );
    }
    if (input.signal?.aborted) {
      return captureFailure("cancelled", "Checkpoint capture was cancelled.");
    }
    const first = this.dependencies.getWorld();
    await (this.dependencies.waitForStableRead?.() ?? Promise.resolve());
    const second = this.dependencies.getWorld();
    if (!sameWorldAnchor(first, second)) {
      return captureFailure(
        "snapshot_unstable",
        "Geometry world did not stabilize twice.",
      );
    }
    const inventory = objectNames(this.dependencies.api);
    if (
      second.truncated ||
      inventory.length !== second.objectCount ||
      !sameNames(
        inventory,
        second.objects
          .map(({ name }) => name)
          .sort((left, right) => left.localeCompare(right)),
      )
    ) {
      return captureFailure(
        "snapshot_unstable",
        "Checkpoint inventory does not match the stable world.",
      );
    }
    const base64 = await this.readBase64(input.signal);
    if (!base64.ok) return base64;
    const third = this.dependencies.getWorld();
    if (!sameWorldAnchor(second, third) || input.signal?.aborted) {
      return captureFailure(
        input.signal?.aborted ? "cancelled" : "snapshot_unstable",
        input.signal?.aborted
          ? "Checkpoint capture was cancelled."
          : "Geometry changed during checkpoint export.",
      );
    }
    const checkpoint = Object.freeze({
      id: input.id,
      activityId: third.activityId,
      epoch: third.epoch,
      revision: third.revision,
      snapshotHash: third.snapshotHash,
      base64: base64.value,
      inventory: Object.freeze([...inventory]),
      registry: Object.freeze(captureRegistry(third, this.dependencies.registry)),
      listenerCount: Math.max(0, this.dependencies.getListenerCount?.() ?? 0),
      createdAt: input.createdAt,
    }) satisfies GeometryCheckpointV1;
    return { ok: true, checkpoint, world: third };
  }

  async restore(
    checkpoint: GeometryCheckpointV1,
    authority: Readonly<{
      activityId: string;
      epoch: number;
      revision: number;
      signal?: AbortSignal;
    }>,
  ): Promise<GeometryCheckpointRestoreResultV1> {
    const fallbackListenerCount = this.dependencies.getListenerCount?.() ?? 0;
    if (
      authority.signal?.aborted ||
      checkpoint.activityId !== authority.activityId ||
      !this.dependencies.api.setBase64
    ) {
      return restoreFailure(
        authority.signal?.aborted ? "cancelled" : "restore_failed",
        authority.signal?.aborted
          ? "Checkpoint restore was cancelled."
          : "Checkpoint does not belong to the current activity or restore is unavailable.",
        fallbackListenerCount,
        fallbackListenerCount,
      );
    }
    let suspension: ListenerSuspension | undefined;
    let listenerCountBefore = fallbackListenerCount;
    let listenerCountAfter = fallbackListenerCount;
    let resumed = false;
    const resume = () => {
      if (!resumed && suspension) {
        listenerCountAfter = suspension.resume();
        resumed = true;
      }
      return listenerCountAfter;
    };
    this.dependencies.onRestoreStatus?.(true);
    try {
      await (this.dependencies.waitForRestoreBarrier?.() ?? Promise.resolve());
      if (authority.signal?.aborted) {
        return restoreFailure(
          "cancelled",
          "Checkpoint restore was cancelled before its atomic write.",
          listenerCountBefore,
          listenerCountAfter,
        );
      }
      suspension = this.dependencies.suspendListeners?.() ?? {
        listenerCountBefore: fallbackListenerCount,
        resume: () =>
          this.dependencies.getListenerCount?.() ?? fallbackListenerCount,
      };
      listenerCountBefore = suspension.listenerCountBefore;
      listenerCountAfter = listenerCountBefore;
      const written = await this.writeBase64(checkpoint.base64);
      if (!written.ok) {
        return restoreFailure(
          written.code,
          written.message,
          listenerCountBefore,
          resume(),
        );
      }
      // setBase64 is atomic once started. The UI barrier remains active until
      // verification and listener reconciliation complete, even if a signal
      // arrives while GeoGebra owns the write callback.
      this.dependencies.registry.replace(
        checkpoint.registry.map((object) => ({ ...object })),
      );
      const inventory = objectNames(this.dependencies.api);
      const world = readGeometryWorldV2(this.dependencies.api, {
        activityId: authority.activityId,
        epoch: authority.epoch,
        revision: authority.revision,
        registry: this.dependencies.registry,
        change: {
          kind: "undo",
          objectNames: [...inventory],
          terminal: true,
          actor: "system",
          occurredAt: Date.now(),
        },
      });
      const reconciled = this.dependencies.reconcileListeners?.() ?? true;
      const after = resume();
      if (
        !sameNames(inventory, checkpoint.inventory) ||
        world.snapshotHash !== checkpoint.snapshotHash ||
        !sameRegistry(this.dependencies.registry.list(), checkpoint.registry) ||
        !reconciled ||
        after !== checkpoint.listenerCount
      ) {
        return restoreFailure(
          "restore_failed",
          "Restored hash, inventory, ownership or listeners diverged.",
          listenerCountBefore,
          after,
        );
      }
      return {
        ok: true,
        world,
        listenerCountBefore,
        listenerCountAfter: after,
      };
    } catch {
      return restoreFailure(
        "restore_failed",
        "Checkpoint restore failed safely.",
        listenerCountBefore,
        resume(),
      );
    } finally {
      resume();
      this.dependencies.onRestoreStatus?.(false);
    }
  }

  private readBase64(
    signal: AbortSignal | undefined,
  ): Promise<
    | { ok: true; value: string }
    | Extract<GeometryCheckpointCaptureResultV1, { ok: false }>
  > {
    return new Promise((resolve) => {
      let settled = false;
      let timer: TimerHandle | undefined;
      const finish = (
        result:
          | { ok: true; value: string }
          | Extract<GeometryCheckpointCaptureResultV1, { ok: false }>,
      ) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) this.clearTimeout(timer);
        resolve(result);
      };
      try {
        this.dependencies.api.getBase64?.((base64) => {
          finish(
            !signal?.aborted && typeof base64 === "string" && base64.length > 0
              ? { ok: true, value: base64 }
              : captureFailure(
                  signal?.aborted ? "cancelled" : "checkpoint_unavailable",
                  signal?.aborted
                    ? "Checkpoint capture was cancelled."
                    : "GeoGebra returned an empty checkpoint.",
                ),
          );
        });
        if (!settled) {
          timer = this.setTimeout(() => {
            finish(
              captureFailure(
                "checkpoint_unavailable",
                "GeoGebra checkpoint export timed out.",
              ),
            );
          }, this.dependencies.timeoutMs ?? GEOMETRY_CHECKPOINT_CALLBACK_TIMEOUT_MS);
        }
      } catch {
        finish(
          captureFailure(
            "checkpoint_unavailable",
            "GeoGebra checkpoint export failed.",
          ),
        );
      }
    });
  }

  private writeBase64(
    base64: string,
  ): Promise<
    | { ok: true }
    | { ok: false; code: "restore_failed"; message: string }
  > {
    return new Promise((resolve) => {
      let settled = false;
      let timer: TimerHandle | undefined;
      const finish = (
        result:
          | { ok: true }
          | { ok: false; code: "restore_failed"; message: string },
      ) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) this.clearTimeout(timer);
        resolve(result);
      };
      try {
        this.dependencies.api.setBase64?.(base64, () => {
          finish({ ok: true });
        });
        if (!settled) {
          timer = this.setTimeout(() => {
            finish({
              ok: false,
              code: "restore_failed",
              message: "GeoGebra checkpoint restore timed out.",
            });
          }, this.dependencies.timeoutMs ?? GEOMETRY_CHECKPOINT_CALLBACK_TIMEOUT_MS);
        }
      } catch {
        finish({
          ok: false,
          code: "restore_failed",
          message: "GeoGebra checkpoint restore failed.",
        });
      }
    });
  }

  private setTimeout(callback: () => void, delayMs: number): TimerHandle {
    return this.dependencies.setTimeout?.(callback, delayMs) ??
      globalThis.setTimeout(callback, delayMs);
  }

  private clearTimeout(timer: TimerHandle): void {
    if (this.dependencies.clearTimeout) this.dependencies.clearTimeout(timer);
    else globalThis.clearTimeout(timer);
  }
}

function captureRegistry(
  world: GeometryWorldV2,
  registry: SceneRegistry,
): SceneObject[] {
  return world.objects
    .map((object) => {
      const registered = registry.get(object.name);
      return Object.freeze(
        registered
          ? { ...registered }
          : {
              name: object.name,
              owner: object.owner,
              kind: mapKind(object.type),
            },
      );
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function mapKind(type: string): SceneObjectKind {
  const normalized = type.toLowerCase();
  if (normalized === "point") return "point";
  if (normalized === "segment") return "segment";
  if (normalized === "line") return "line";
  if (normalized === "boolean") return "boolean";
  if (normalized === "number") return "number";
  return "other";
}

function objectNames(api: GeoGebraApi): string[] {
  return [...(api.getAllObjectNames?.() ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );
}

function sameWorldAnchor(left: GeometryWorldV2, right: GeometryWorldV2): boolean {
  return (
    left.activityId === right.activityId &&
    left.epoch === right.epoch &&
    left.revision === right.revision &&
    left.snapshotHash === right.snapshotHash &&
    JSON.stringify(left.objects) === JSON.stringify(right.objects) &&
    JSON.stringify(left.facts) === JSON.stringify(right.facts)
  );
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function sameRegistry(
  left: readonly SceneObject[],
  right: readonly SceneObject[],
): boolean {
  const normalize = (objects: readonly SceneObject[]) =>
    [...objects].sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function captureFailure(
  code: Extract<GeometryCheckpointCaptureResultV1, { ok: false }>["code"],
  message: string,
): Extract<GeometryCheckpointCaptureResultV1, { ok: false }> {
  return { ok: false, code, message };
}

function restoreFailure(
  code: Extract<GeometryCheckpointRestoreResultV1, { ok: false }>["code"],
  message: string,
  listenerCountBefore: number,
  listenerCountAfter: number,
): Extract<GeometryCheckpointRestoreResultV1, { ok: false }> {
  return { ok: false, code, message, listenerCountBefore, listenerCountAfter };
}

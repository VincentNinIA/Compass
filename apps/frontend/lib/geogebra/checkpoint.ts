import type { CompletedActionBridge } from "./action-bridge";
import type { GeoGebraAdapter } from "./adapter";
import {
  initializeExerciseScene,
  initializeMinimalScene,
  type SceneRegistry,
} from "./scene";
import type { SnapshotService } from "./snapshot";
import type { Checkpoint, ConstructionSnapshot } from "@/types/geogebra";

export const SET_BASE64_TIMEOUT_MS = 3_000;
export const GET_BASE64_TIMEOUT_MS = 3_000;

export type CheckpointCaptureResult =
  | {
      ok: true;
      value: {
        checkpoint: Checkpoint;
        snapshot: ConstructionSnapshot;
        listenerCount: number;
      };
    }
  | {
      ok: false;
      error: { code: "checkpoint_unavailable"; message: string };
    };

export type ResetResult =
  | {
      ok: true;
      value: {
        epoch: number;
        recovered: boolean;
        snapshot: ConstructionSnapshot;
        listenerCount: number;
      };
    }
  | {
      ok: false;
      error: {
        code: "checkpoint_unavailable" | "restore_failed" | "recovery_failed";
        message: string;
      };
    };

export class CheckpointService {
  private checkpoint?: Checkpoint;
  private resetPromise?: Promise<ResetResult>;

  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly registry: SceneRegistry,
    private readonly snapshots: SnapshotService,
    private readonly bridge: CompletedActionBridge,
  ) {}

  get current() {
    return this.checkpoint;
  }

  async captureInitial(): Promise<ResetResult> {
    const captured = await this.captureCheckpoint();
    if (!captured.ok) return captured;
    this.checkpoint = captured.value.checkpoint;
    return {
      ok: true,
      value: {
        epoch: this.adapter.epoch,
        recovered: false,
        snapshot: captured.value.snapshot,
        listenerCount: captured.value.listenerCount,
      },
    };
  }

  async captureCheckpoint(): Promise<CheckpointCaptureResult> {
    const snapshot = this.snapshots.capture();
    if (!snapshot.ok) {
      return { ok: false, error: { code: "checkpoint_unavailable", message: snapshot.error.message } };
    }
    const base64 = await this.readBase64();
    if (!base64.ok) return base64;
    const inventory = this.readObjectNames();
    if (!inventory.ok) return inventory;
    return {
      ok: true,
      value: {
        checkpoint: {
          base64: base64.value,
          initialHash: snapshot.value.hash,
          initialObjectNames: inventory.value,
          initialObjects: this.registry.list(),
        },
        snapshot: snapshot.value,
        listenerCount: this.adapter.listenerCount,
      },
    };
  }

  setCurrent(checkpoint: Checkpoint) {
    this.checkpoint = checkpoint;
  }

  async restoreExact(checkpoint: Checkpoint): Promise<ResetResult> {
    const epoch = this.adapter.advanceEpoch();
    this.bridge.stop();
    const restored = await this.writeBase64(checkpoint.base64);
    if (!restored.ok) {
      return { ok: false, error: { code: "restore_failed", message: "GeoGebra did not acknowledge the checkpoint restore." } };
    }
    this.registry.replace(checkpoint.initialObjects);
    const inventory = this.readObjectNames();
    const snapshot = this.snapshots.capture();
    if (
      !inventory.ok ||
      !sameNames(inventory.value, checkpoint.initialObjectNames) ||
      !snapshot.ok ||
      snapshot.value.hash !== checkpoint.initialHash
    ) {
      return { ok: false, error: { code: "restore_failed", message: "The restored checkpoint does not match its exact hash and inventory." } };
    }
    const listeners = this.bridge.start();
    if (!listeners.ok) {
      return { ok: false, error: { code: "restore_failed", message: listeners.error.message } };
    }
    return {
      ok: true,
      value: {
        epoch,
        recovered: false,
        snapshot: snapshot.value,
        listenerCount: this.adapter.listenerCount,
      },
    };
  }

  reset(): Promise<ResetResult> {
    if (this.resetPromise) return this.resetPromise;
    this.resetPromise = this.performReset().finally(() => {
      this.resetPromise = undefined;
    });
    return this.resetPromise;
  }

  private async performReset(): Promise<ResetResult> {
    if (!this.checkpoint) {
      return { ok: false, error: { code: "checkpoint_unavailable", message: "Initial checkpoint is unavailable." } };
    }
    const epoch = this.adapter.advanceEpoch();
    this.bridge.stop();

    const restored = await this.writeBase64(this.checkpoint.base64);
    if (restored.ok) {
      const inventory = this.readObjectNames();
      if (
        inventory.ok &&
        sameNames(inventory.value, this.checkpoint.initialObjectNames)
      ) {
        this.restoreInitialRegistry(this.checkpoint);
        const snapshot = this.snapshots.capture();
        if (snapshot.ok && snapshot.value.hash === this.checkpoint.initialHash) {
          const listeners = this.bridge.start();
          if (!listeners.ok) {
            return { ok: false, error: { code: "restore_failed", message: listeners.error.message } };
          }
          return {
            ok: true,
            value: { epoch, recovered: false, snapshot: snapshot.value, listenerCount: this.adapter.listenerCount },
          };
        }
      }
    }

    const recovery = this.rebuildCanonicalScene();
    if (!recovery.ok) return recovery;
    const listeners = this.bridge.start();
    if (!listeners.ok) {
      return { ok: false, error: { code: "recovery_failed", message: listeners.error.message } };
    }
    return {
      ok: true,
      value: { epoch, recovered: true, snapshot: recovery.value, listenerCount: this.adapter.listenerCount },
    };
  }

  private rebuildCanonicalScene():
    | { ok: true; value: ConstructionSnapshot }
    | { ok: false; error: { code: "recovery_failed"; message: string } } {
    const cleared = this.adapter.withApi((api) => {
      api.newConstruction?.();
      if (!api.newConstruction) {
        for (const name of api.getAllObjectNames?.() ?? []) api.deleteObject?.(name);
      }
    });
    if (!cleared.ok) {
      return { ok: false, error: { code: "recovery_failed", message: cleared.error.message } };
    }
    this.registry.replace([]);
    const scene = this.rebuildCheckpointScene();
    if (!scene.ok) {
      return { ok: false, error: { code: "recovery_failed", message: scene.error.message } };
    }
    const snapshot = this.snapshots.capture();
    const inventory = this.readObjectNames();
    if (
      !snapshot.ok ||
      !inventory.ok ||
      snapshot.value.hash !== this.checkpoint?.initialHash ||
      !sameNames(inventory.value, this.checkpoint.initialObjectNames)
    ) {
      return { ok: false, error: { code: "recovery_failed", message: "Canonical recovery hash diverged from the checkpoint." } };
    }
    return { ok: true, value: snapshot.value };
  }

  private rebuildCheckpointScene() {
    const objects = this.checkpoint?.initialObjects ?? [];
    if (objects.length === 0) {
      return { ok: true as const, value: [] };
    }
    const owners = new Set(objects.map(({ owner }) => owner));
    if (owners.size !== 1) {
      return {
        ok: false as const,
        error: {
          code: "verification_failed" as const,
          message: "The checkpoint registry is not a supported canonical scene.",
          labels: objects.map(({ name }) => name),
        },
      };
    }
    return owners.has("exercise")
      ? initializeExerciseScene(this.adapter, this.registry)
      : initializeMinimalScene(this.adapter, this.registry);
  }

  private restoreInitialRegistry(checkpoint: Checkpoint) {
    this.registry.replace(checkpoint.initialObjects);
  }

  private readBase64(): Promise<
    | { ok: true; value: string }
    | { ok: false; error: { code: "checkpoint_unavailable"; message: string } }
  > {
    const result = this.adapter.withApi((api) => api.getBase64?.bind(api));
    if (!result.ok || !result.value) {
      return Promise.resolve({ ok: false, error: { code: "checkpoint_unavailable", message: result.ok ? "getBase64 is unavailable." : result.error.message } });
    }
    return new Promise((resolve) => {
      let settled = false;
      const settle = (
        value:
          | { ok: true; value: string }
          | { ok: false; error: { code: "checkpoint_unavailable"; message: string } },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(
        () => settle({ ok: false, error: { code: "checkpoint_unavailable", message: "getBase64 timed out." } }),
        GET_BASE64_TIMEOUT_MS,
      );
      try {
        result.value?.((base64) => settle({ ok: true, value: String(base64) }));
      } catch {
        settle({ ok: false, error: { code: "checkpoint_unavailable", message: "getBase64 failed." } });
      }
    });
  }

  private readObjectNames():
    | { ok: true; value: string[] }
    | {
        ok: false;
        error: { code: "checkpoint_unavailable"; message: string };
      } {
    const result = this.adapter.withApi((api) => {
      if (api.getObjectNumber && api.getObjectName) {
        return Array.from(
          { length: api.getObjectNumber() },
          (_, index) => api.getObjectName?.(index) ?? "",
        );
      }
      return api.getAllObjectNames?.();
    });
    if (!result.ok || !result.value) {
      return {
        ok: false,
        error: {
          code: "checkpoint_unavailable",
          message: result.ok
            ? "getAllObjectNames is unavailable."
            : result.error.message,
        },
      };
    }
    return {
      ok: true,
      value: [...result.value].map(String).sort(),
    };
  }

  private writeBase64(base64: string): Promise<{ ok: true } | { ok: false }> {
    const result = this.adapter.withApi((api) => api.setBase64?.bind(api));
    if (!result.ok || !result.value) return Promise.resolve({ ok: false });
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: { ok: true } | { ok: false }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(
        () => settle({ ok: false }),
        SET_BASE64_TIMEOUT_MS,
      );
      try {
        result.value?.(base64, () => settle({ ok: true }));
      } catch {
        settle({ ok: false });
      }
    });
  }
}

function sameNames(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

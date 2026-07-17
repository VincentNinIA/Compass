import type { CompletedActionBridge } from "./action-bridge";
import type { GeoGebraAdapter } from "./adapter";
import {
  initializeExerciseScene,
  initializeMinimalScene,
  type SceneRegistry,
} from "./scene";
import type { SnapshotService } from "./snapshot";
import { validateExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import type { ExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import type {
  Checkpoint,
  ConstructionSnapshot,
  SceneObject,
} from "@/types/geogebra";

export const SET_BASE64_TIMEOUT_MS = 3_000;
export const GET_BASE64_TIMEOUT_MS = 3_000;
const EXPECTED_BRIDGE_LISTENER_COUNT = 4;

export type ResetReason = "user_request" | "recovery_retry";

export type ResetCancellationContext = Readonly<{
  epoch: number;
  reason: ResetReason;
}>;

export type ResetOptions = Readonly<{
  reason?: ResetReason;
  recoveryPlan?: ExercisePlanV1;
  cancelEffects?(
    context: ResetCancellationContext,
  ): Promise<readonly string[]> | readonly string[];
  guardMutation?(): boolean;
}>;

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
        reason: ResetReason | "initial_capture" | "exact_restore";
        restoration: "checkpoint" | "canonical_fixture" | "capture";
        beforeHash: string | null;
        checkpointHash: string | null;
        afterHash: string;
        snapshot: ConstructionSnapshot;
        inventory: readonly string[];
        registry: readonly SceneObject[];
        listenerCountAtRequest: number;
        listenerCountBefore: number;
        listenerCount: number;
        cancelledScopes: readonly string[];
        checkpointPromoted: boolean;
      };
    }
  | {
      ok: false;
      error: {
        code:
          | "checkpoint_unavailable"
          | "restore_failed"
          | "recovery_failed"
          | "cancellation_failed";
        message: string;
        state?: "fatal";
        retryable?: true;
        epoch?: number;
        reason?: ResetReason;
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
        reason: "initial_capture",
        restoration: "capture",
        beforeHash: captured.value.snapshot.hash,
        checkpointHash: captured.value.checkpoint.initialHash,
        afterHash: captured.value.snapshot.hash,
        snapshot: captured.value.snapshot,
        inventory: Object.freeze([
          ...captured.value.checkpoint.initialObjectNames,
        ]),
        registry: freezeRegistry(captured.value.checkpoint.initialObjects),
        listenerCountAtRequest: captured.value.listenerCount,
        listenerCountBefore: captured.value.listenerCount,
        listenerCount: captured.value.listenerCount,
        cancelledScopes: Object.freeze([]),
        checkpointPromoted: true,
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

  async restoreExact(
    checkpoint: Checkpoint,
    options: Readonly<{ advanceEpoch?: boolean }> = {},
  ): Promise<ResetResult> {
    const listenerCountBefore = this.adapter.listenerCount;
    const before = this.snapshots.capture();
    const epoch = options.advanceEpoch === false
      ? this.adapter.epoch
      : this.adapter.advanceEpoch();
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
        reason: "exact_restore",
        restoration: "checkpoint",
        beforeHash: before.ok ? before.value.hash : null,
        checkpointHash: checkpoint.initialHash,
        afterHash: snapshot.value.hash,
        snapshot: snapshot.value,
        inventory: Object.freeze([...checkpoint.initialObjectNames]),
        registry: freezeRegistry(checkpoint.initialObjects),
        listenerCountAtRequest: listenerCountBefore,
        listenerCountBefore,
        listenerCount: this.adapter.listenerCount,
        cancelledScopes: Object.freeze([]),
        checkpointPromoted: false,
      },
    };
  }

  reset(options: ResetOptions = {}): Promise<ResetResult> {
    if (this.resetPromise) return this.resetPromise;
    this.resetPromise = this.performReset(options).finally(() => {
      this.resetPromise = undefined;
    });
    return this.resetPromise;
  }

  private async performReset(options: ResetOptions): Promise<ResetResult> {
    const reason = options.reason ?? "user_request";
    const listenerCountAtRequest = this.adapter.listenerCount;
    const before = this.snapshots.capture();
    const checkpoint = this.checkpoint;
    const epoch = this.adapter.advanceEpoch();
    let cancelledScopes: readonly string[] = Object.freeze([]);
    try {
      cancelledScopes = Object.freeze([
        ...(await options.cancelEffects?.({ epoch, reason }) ?? []),
      ]);
    } catch {
      return fatalReset(
        "cancellation_failed",
        "Active effects could not be invalidated before restoration.",
        epoch,
        reason,
      );
    }
    const listenerCountBefore = this.adapter.listenerCount;
    if (!this.mutationAllowed(options.guardMutation)) {
      return fatalReset(
        "cancellation_failed",
        "Reset authority expired before checkpoint restoration.",
        epoch,
        reason,
      );
    }
    this.bridge.stop();

    const restored = checkpoint
      ? this.mutationAllowed(options.guardMutation)
        ? await this.writeBase64(checkpoint.base64)
        : { ok: false as const }
      : { ok: false as const };
    if (restored.ok && checkpoint) {
      if (!this.mutationAllowed(options.guardMutation)) {
        return fatalReset(
          "cancellation_failed",
          "Reset authority expired after checkpoint restoration.",
          epoch,
          reason,
        );
      }
      const inventory = this.readObjectNames();
      if (
        inventory.ok &&
        sameNames(inventory.value, checkpoint.initialObjectNames)
      ) {
        if (!this.mutationAllowed(options.guardMutation)) {
          return fatalReset(
            "cancellation_failed",
            "Reset authority expired before registry restoration.",
            epoch,
            reason,
          );
        }
        this.restoreInitialRegistry(checkpoint);
        const snapshot = this.snapshots.capture();
        if (
          snapshot.ok &&
          snapshot.value.hash === checkpoint.initialHash &&
          sameRegistry(this.registry.list(), checkpoint.initialObjects)
        ) {
          if (!this.mutationAllowed(options.guardMutation)) {
            return fatalReset(
              "cancellation_failed",
              "Reset authority expired before listener restoration.",
              epoch,
              reason,
            );
          }
          const listeners = this.restartListeners(
            EXPECTED_BRIDGE_LISTENER_COUNT,
          );
          if (!listeners.ok) {
            return fatalReset(
              "restore_failed",
              listeners.message,
              epoch,
              reason,
            );
          }
          return {
            ok: true,
            value: {
              epoch,
              recovered: false,
              reason,
              restoration: "checkpoint",
              beforeHash: before.ok ? before.value.hash : null,
              checkpointHash: checkpoint.initialHash,
              afterHash: snapshot.value.hash,
              snapshot: snapshot.value,
              inventory: Object.freeze([...inventory.value]),
              registry: freezeRegistry(checkpoint.initialObjects),
              listenerCountAtRequest,
              listenerCountBefore,
              listenerCount: this.adapter.listenerCount,
              cancelledScopes,
              checkpointPromoted: false,
            },
          };
        }
      }
    }

    const recovery = await this.rebuildCanonicalScene(
      options.recoveryPlan,
      checkpoint,
      EXPECTED_BRIDGE_LISTENER_COUNT,
      options.guardMutation,
    );
    if (!recovery.ok) {
      return fatalReset(
        "recovery_failed",
        recovery.error.message,
        epoch,
        reason,
      );
    }
    return {
      ok: true,
      value: {
        epoch,
        recovered: true,
        reason,
        restoration: "canonical_fixture",
        beforeHash: before.ok ? before.value.hash : null,
        checkpointHash: checkpoint?.initialHash ?? null,
        afterHash: recovery.value.snapshot.hash,
        snapshot: recovery.value.snapshot,
        inventory: recovery.value.inventory,
        registry: recovery.value.registry,
        listenerCountAtRequest,
        listenerCountBefore,
        listenerCount: this.adapter.listenerCount,
        cancelledScopes,
        checkpointPromoted: true,
      },
    };
  }

  private async rebuildCanonicalScene(
    recoveryPlan: ExercisePlanV1 | undefined,
    priorCheckpoint: Checkpoint | undefined,
    expectedListenerCount: number,
    guardMutation?: () => boolean,
  ): Promise<
    | {
        ok: true;
        value: {
          snapshot: ConstructionSnapshot;
          inventory: readonly string[];
          registry: readonly SceneObject[];
        };
      }
    | { ok: false; error: { code: "recovery_failed"; message: string } }
  > {
    const validatedPlan = recoveryPlan
      ? validateExercisePlanV1(recoveryPlan)
      : undefined;
    const canRebuildBootstrap = isBootstrapCheckpoint(priorCheckpoint);
    if (validatedPlan && !validatedPlan.success) {
      return {
        ok: false,
        error: {
          code: "recovery_failed",
          message: "The confirmed recovery plan is invalid.",
        },
      };
    }
    if (!validatedPlan?.success && !canRebuildBootstrap) {
      return {
        ok: false,
        error: {
          code: "recovery_failed",
          message: "No confirmed in-memory plan is available for canonical recovery.",
        },
      };
    }
    if (!this.mutationAllowed(guardMutation)) {
      return {
        ok: false,
        error: {
          code: "recovery_failed",
          message: "Reset authority expired before canonical recovery.",
        },
      };
    }
    const cleared = this.adapter.withApi((api) => {
      api.newConstruction?.();
      if (!api.newConstruction) {
        for (const name of api.getAllObjectNames?.() ?? []) api.deleteObject?.(name);
      }
    });
    if (!cleared.ok) {
      return { ok: false, error: { code: "recovery_failed", message: cleared.error.message } };
    }
    if (!this.mutationAllowed(guardMutation)) {
      return {
        ok: false,
        error: {
          code: "recovery_failed",
          message: "Reset authority expired before canonical registry reset.",
        },
      };
    }
    this.registry.replace([]);
    if (!this.mutationAllowed(guardMutation)) {
      return {
        ok: false,
        error: {
          code: "recovery_failed",
          message: "Reset authority expired before canonical scene creation.",
        },
      };
    }
    const scene = validatedPlan?.success
      ? initializeExerciseScene(this.adapter, this.registry)
      : initializeMinimalScene(this.adapter, this.registry);
    if (!scene.ok) {
      return { ok: false, error: { code: "recovery_failed", message: scene.error.message } };
    }
    const snapshot = this.snapshots.capture();
    const inventory = this.readObjectNames();
    const expectedNames = ["A", "AB", "B"];
    const expectedOwner = validatedPlan?.success ? "exercise" : "system";
    if (
      !snapshot.ok ||
      !inventory.ok ||
      !sameNames(inventory.value, expectedNames) ||
      !isCanonicalRegistry(this.registry.list(), expectedOwner)
    ) {
      return { ok: false, error: { code: "recovery_failed", message: "Canonical recovery did not produce the exact A/B/AB fixture." } };
    }

    const promoted = await this.captureCheckpoint();
    if (!promoted.ok) {
      return {
        ok: false,
        error: { code: "recovery_failed", message: promoted.error.message },
      };
    }
    if (!this.mutationAllowed(guardMutation)) {
      return {
        ok: false,
        error: {
          code: "recovery_failed",
          message: "Reset authority expired before checkpoint verification.",
        },
      };
    }
    const verified = await this.writeBase64(promoted.value.checkpoint.base64);
    if (!this.mutationAllowed(guardMutation)) {
      return {
        ok: false,
        error: {
          code: "recovery_failed",
          message: "Reset authority expired after checkpoint verification.",
        },
      };
    }
    this.registry.replace(promoted.value.checkpoint.initialObjects);
    const verifiedInventory = this.readObjectNames();
    const verifiedSnapshot = this.snapshots.capture();
    if (
      !verified.ok ||
      !verifiedInventory.ok ||
      !verifiedSnapshot.ok ||
      verifiedSnapshot.value.hash !== promoted.value.checkpoint.initialHash ||
      !sameNames(
        verifiedInventory.value,
        promoted.value.checkpoint.initialObjectNames,
      ) ||
      !sameRegistry(
        this.registry.list(),
        promoted.value.checkpoint.initialObjects,
      )
    ) {
      return {
        ok: false,
        error: { code: "recovery_failed", message: "The promoted recovery checkpoint could not be reverified." },
      };
    }

    if (!this.mutationAllowed(guardMutation)) {
      return {
        ok: false,
        error: {
          code: "recovery_failed",
          message: "Reset authority expired before listener recovery.",
        },
      };
    }
    const listeners = this.restartListeners(expectedListenerCount);
    if (!listeners.ok) {
      return {
        ok: false,
        error: { code: "recovery_failed", message: listeners.message },
      };
    }
    if (!this.mutationAllowed(guardMutation)) {
      return {
        ok: false,
        error: {
          code: "recovery_failed",
          message: "Reset authority expired before checkpoint promotion.",
        },
      };
    }
    this.checkpoint = promoted.value.checkpoint;
    return {
      ok: true,
      value: {
        snapshot: verifiedSnapshot.value,
        inventory: Object.freeze([...verifiedInventory.value]),
        registry: freezeRegistry(promoted.value.checkpoint.initialObjects),
      },
    };
  }

  private restoreInitialRegistry(checkpoint: Checkpoint) {
    this.registry.replace(checkpoint.initialObjects);
  }

  private mutationAllowed(guardMutation?: () => boolean) {
    try {
      return guardMutation?.() ?? true;
    } catch {
      return false;
    }
  }

  private restartListeners(expected: number):
    | { ok: true }
    | { ok: false; message: string } {
    const started = this.bridge.start();
    if (!started.ok) return { ok: false, message: started.error.message };
    const reconciled = this.adapter.reconcileClientListeners();
    if (!reconciled.ok) {
      return { ok: false, message: reconciled.error.message };
    }
    if (this.adapter.listenerCount !== expected) {
      return {
        ok: false,
        message: `Listener reconciliation diverged: expected ${expected}, received ${this.adapter.listenerCount}.`,
      };
    }
    return { ok: true };
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

function sameRegistry(left: SceneObject[], right: SceneObject[]) {
  const normalizedLeft = [...left].sort((a, b) => a.name.localeCompare(b.name));
  const normalizedRight = [...right].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((object, index) => {
      const expected = normalizedRight[index];
      return (
        object.name === expected?.name &&
        object.owner === expected.owner &&
        object.kind === expected.kind
      );
    })
  );
}

function freezeRegistry(objects: readonly SceneObject[]): readonly SceneObject[] {
  return Object.freeze(objects.map((object) => Object.freeze({ ...object })));
}

function isCanonicalRegistry(
  objects: SceneObject[],
  owner: "system" | "exercise",
) {
  return (
    objects.length === 3 &&
    objects.every((object) => object.owner === owner) &&
    objects.find(({ name }) => name === "A")?.kind === "point" &&
    objects.find(({ name }) => name === "B")?.kind === "point" &&
    objects.find(({ name }) => name === "AB")?.kind === "segment"
  );
}

function isBootstrapCheckpoint(checkpoint: Checkpoint | undefined) {
  return Boolean(
    checkpoint &&
      sameNames(checkpoint.initialObjectNames, ["A", "AB", "B"]) &&
      isCanonicalRegistry(checkpoint.initialObjects, "system"),
  );
}

function fatalReset(
  code: Extract<
    ResetResult,
    { ok: false }
  >["error"]["code"],
  message: string,
  epoch: number,
  reason: ResetReason,
): ResetResult {
  return {
    ok: false,
    error: {
      code,
      message,
      state: "fatal",
      retryable: true,
      epoch,
      reason,
    },
  };
}

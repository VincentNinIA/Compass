import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import { validateExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import type { GeoGebraAdapter } from "./adapter";
import type { CompletedActionBridge } from "./action-bridge";
import type { CheckpointService } from "./checkpoint";
import type { ResetResult } from "./checkpoint";
import { initializeExerciseScene, type SceneRegistry } from "./scene";
import { normalizeCommand, type SnapshotService } from "./snapshot";
import type {
  Checkpoint,
  ConstructionSnapshot,
  GeoGebraApi,
  SceneObject,
} from "@/types/geogebra";

const CANONICAL_NAMES = ["A", "AB", "B"] as const;
const CREATED_NAMES = ["A", "B", "AB"] as const;
const COORDINATE_TOLERANCE = 1e-9;

export type InitializationResultV1 =
  | {
      status: "initialized";
      planId: string;
      snapshotHash: string;
      created: ["A", "B", "AB"];
    }
  | { status: "already_initialized"; snapshotHash: string }
  | { status: "failed"; code: string; rolledBack: boolean };

export type InitializationTraceStep =
  | "validated"
  | "preflight_passed"
  | "checkpoint_captured"
  | "bridge_stopped"
  | "bootstrap_cleared"
  | "givens_created"
  | "postconditions_verified"
  | "reset_checkpoint_promoted"
  | "listeners_reconciled"
  | "rollback_started"
  | "rollback_verified"
  | "recovery_required";

export type ExerciseInitializationRuntime = {
  initialize(confirmation: ExerciseConfirmedV1): Promise<InitializationResultV1>;
  recover(): Promise<ResetResult>;
};

type PreflightResult =
  | { ok: true }
  | { ok: false; code: "applet_not_ready" | "canvas_not_empty" | "bootstrap_not_verifiable" };

type PostconditionResult =
  | { ok: true; snapshot: ConstructionSnapshot }
  | { ok: false; code: "postcondition_failed" };

export class ExerciseInitializationService implements ExerciseInitializationRuntime {
  private mutex: Promise<void> = Promise.resolve();
  private recoveryRequired = false;
  private readonly consumedConfirmations = new Map<string, string>();
  private trace: InitializationTraceStep[] = [];

  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly registry: SceneRegistry,
    private readonly snapshots: SnapshotService,
    private readonly bridge: CompletedActionBridge,
    private readonly checkpoints: CheckpointService,
  ) {}

  get lastTrace(): readonly InitializationTraceStep[] {
    return this.trace;
  }

  initialize(confirmation: ExerciseConfirmedV1): Promise<InitializationResultV1> {
    const run = this.mutex.then(() => this.performInitialization(confirmation));
    this.mutex = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  recover(): Promise<ResetResult> {
    const run = this.mutex.then(async () => {
      const result = await this.checkpoints.reset();
      if (result.ok) this.recoveryRequired = false;
      return result;
    });
    this.mutex = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async performInitialization(
    confirmation: ExerciseConfirmedV1,
  ): Promise<InitializationResultV1> {
    this.trace = [];
    if (this.recoveryRequired) return failed("recovery_required", false);

    const validated = validateConfirmation(confirmation);
    if (!validated.ok) return failed("invalid_confirmation", false);
    this.trace.push("validated");

    const priorHash = this.consumedConfirmations.get(validated.confirmationId);
    if (priorHash) {
      return { status: "already_initialized", snapshotHash: priorHash };
    }

    const preflight = this.preflight();
    if (!preflight.ok) return failed(preflight.code, false);
    this.trace.push("preflight_passed");

    let checkpoint;
    try {
      checkpoint = await this.checkpoints.captureCheckpoint();
    } catch {
      return failed("checkpoint_unavailable", false);
    }
    if (!checkpoint.ok) return failed("checkpoint_unavailable", false);
    this.trace.push("checkpoint_captured");

    const listenerCountBefore = checkpoint.value.listenerCount;
    let stopped;
    try {
      stopped = this.bridge.stop();
    } catch {
      return failed("bridge_unavailable", false);
    }
    if (!stopped.ok) {
      this.bridge.start();
      return failed("bridge_unavailable", false);
    }
    this.trace.push("bridge_stopped");

    let failureCode = "initialization_failed";
    try {
      if (!this.clearBootstrap()) {
        failureCode = "clear_failed";
        throw new InitializationFailure();
      }
      this.trace.push("bootstrap_cleared");

      const scene = initializeExerciseScene(this.adapter, this.registry);
      if (!scene.ok) {
        failureCode = creationFailureCode(scene.error.labels);
        throw new InitializationFailure();
      }
      this.trace.push("givens_created");

      const postconditions = this.verifyPostconditions();
      if (!postconditions.ok) {
        failureCode = postconditions.code;
        throw new InitializationFailure();
      }
      this.trace.push("postconditions_verified");

      const resetCheckpoint = await this.checkpoints.captureCheckpoint();
      if (!resetCheckpoint.ok) {
        failureCode = "checkpoint_promotion_failed";
        throw new InitializationFailure();
      }

      const listeners = this.bridge.start();
      if (!listeners.ok || this.adapter.listenerCount !== listenerCountBefore) {
        failureCode = "listener_reconciliation_failed";
        throw new InitializationFailure();
      }
      this.trace.push("listeners_reconciled");

      this.checkpoints.setCurrent(resetCheckpoint.value.checkpoint);
      this.trace.push("reset_checkpoint_promoted");
      this.consumedConfirmations.set(
        validated.confirmationId,
        postconditions.snapshot.hash,
      );
      return {
        status: "initialized",
        planId: validated.plan.exerciseId,
        snapshotHash: postconditions.snapshot.hash,
        created: [...CREATED_NAMES],
      };
    } catch {
      return this.rollback(
        checkpoint.value.checkpoint,
        listenerCountBefore,
        failureCode,
      );
    }
  }

  private preflight(): PreflightResult {
    if (this.adapter.phase !== "ready") return { ok: false, code: "applet_not_ready" };
    try {
      const inspected = this.adapter.withApi((api) => {
        const names = readObjectNames(api);
        if (!names) return { ok: false as const, code: "bootstrap_not_verifiable" as const };
        const registered = this.registry.list();
        if (names.length === 0 && registered.length === 0) return { ok: true as const };
        if (
          !sameNames(names, CANONICAL_NAMES) ||
          !isCanonicalRegistry(registered, "system")
        ) {
          return { ok: false as const, code: "canvas_not_empty" as const };
        }
        if (!hasCoordinates(api, "A", -2, 0) || !hasCoordinates(api, "B", 2, 0)) {
          return { ok: false as const, code: "bootstrap_not_verifiable" as const };
        }
        if (!isCanonicalSegment(api, "AB")) {
          return { ok: false as const, code: "bootstrap_not_verifiable" as const };
        }
        return { ok: true as const };
      });
      return inspected.ok
        ? inspected.value
        : { ok: false, code: "applet_not_ready" };
    } catch {
      return { ok: false, code: "bootstrap_not_verifiable" };
    }
  }

  private clearBootstrap() {
    try {
      const cleared = this.adapter.withApi((api) => {
        const names = readObjectNames(api);
        if (!names) return false;
        if (names.length > 0) {
          if (api.newConstruction) {
            api.newConstruction();
          } else if (api.deleteObject) {
            for (const name of [...names].reverse()) api.deleteObject(name);
          } else {
            return false;
          }
        }
        const remaining = readObjectNames(api);
        return remaining?.length === 0;
      });
      if (!cleared.ok || !cleared.value) return false;
      this.registry.replace([]);
      return true;
    } catch {
      return false;
    }
  }

  private verifyPostconditions(): PostconditionResult {
    const verified = this.adapter.withApi((api) => {
      const names = readObjectNames(api);
      return (
        names !== undefined &&
        sameNames(names, CANONICAL_NAMES) &&
        isCanonicalRegistry(this.registry.list(), "exercise") &&
        hasCoordinates(api, "A", -3, 0) &&
        hasCoordinates(api, "B", 3, 0) &&
        isCanonicalSegment(api, "AB") &&
        CANONICAL_NAMES.every((name) => api.exists(name) && api.isDefined(name))
      );
    });
    if (!verified.ok || !verified.value) {
      return { ok: false, code: "postcondition_failed" };
    }
    const first = this.snapshots.capture();
    const second = this.snapshots.capture();
    if (!first.ok || !second.ok || first.value.hash !== second.value.hash) {
      return { ok: false, code: "postcondition_failed" };
    }
    return { ok: true, snapshot: second.value };
  }

  private async rollback(
    checkpoint: Checkpoint,
    listenerCountBefore: number,
    failureCode: string,
  ): Promise<InitializationResultV1> {
    this.trace.push("rollback_started");
    let restored;
    try {
      restored = await this.checkpoints.restoreExact(checkpoint);
    } catch {
      this.recoveryRequired = true;
      this.trace.push("recovery_required");
      return failed("recovery_required", false);
    }
    if (
      restored.ok &&
      restored.value.snapshot.hash === checkpoint.initialHash &&
      restored.value.listenerCount === listenerCountBefore
    ) {
      this.trace.push("rollback_verified");
      return failed(failureCode, true);
    }
    this.recoveryRequired = true;
    this.trace.push("recovery_required");
    return failed("recovery_required", false);
  }
}

class InitializationFailure extends Error {}

function validateConfirmation(input: unknown) {
  if (!isRecord(input)) return { ok: false as const };
  if (
    !sameNames(Object.keys(input).sort(), ["confirmationId", "confirmedAt", "plan"]) ||
    typeof input.confirmationId !== "string" ||
    input.confirmationId.trim().length === 0 ||
    !Number.isFinite(input.confirmedAt) ||
    Number(input.confirmedAt) < 0
  ) {
    return { ok: false as const };
  }
  const plan = validateExercisePlanV1(input.plan);
  if (!plan.success) return { ok: false as const };
  return {
    ok: true as const,
    confirmationId: input.confirmationId,
    plan: plan.data,
  };
}

function readObjectNames(api: GeoGebraApi): string[] | undefined {
  const names =
    api.getObjectNumber && api.getObjectName
      ? Array.from(
          { length: api.getObjectNumber() },
          (_, index) => api.getObjectName?.(index) ?? "",
        )
      : api.getAllObjectNames?.();
  return names ? [...names].map(String).filter(Boolean).sort() : undefined;
}

function hasCoordinates(
  api: GeoGebraApi,
  label: string,
  expectedX: number,
  expectedY: number,
) {
  if (!api.getXcoord || !api.getYcoord) return false;
  const type = api.getObjectType?.(label);
  return (
    (type === undefined || type === "point") &&
    Math.abs(api.getXcoord(label) - expectedX) <= COORDINATE_TOLERANCE &&
    Math.abs(api.getYcoord(label) - expectedY) <= COORDINATE_TOLERANCE
  );
}

function isCanonicalSegment(api: GeoGebraApi, label: string) {
  if (!api.exists(label) || !api.isDefined(label)) return false;
  const type = api.getObjectType?.(label);
  if (type !== undefined && type !== "segment") return false;
  const command = normalizeCommand(String(api.getCommandString(label, false)))
    .replaceAll("[", "(")
    .replaceAll("]", ")");
  return command === "Segment(A,B)";
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

function creationFailureCode(labels: string[]) {
  const failedLabel = labels.at(-1);
  return failedLabel === "A" || failedLabel === "B" || failedLabel === "AB"
    ? `create_${failedLabel.toLowerCase()}_failed`
    : "givens_creation_failed";
}

function sameNames(
  left: readonly string[],
  right: readonly string[],
) {
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failed(code: string, rolledBack: boolean): InitializationResultV1 {
  return { status: "failed", code, rolledBack };
}

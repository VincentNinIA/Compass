import type { GeometryActionAuthorityV1 } from "./authority";
import { GeometryActionError } from "./action-error";
import type { GeometryCheckpointControllerV1 } from "./checkpoint-v2";
import type {
  GeometryDemonstrationStepV1,
  GeometryInvestigationV1,
} from "./contracts";
import type { GeometryUiEffectsV1 } from "./ui-effects";

export type GeometryReplayStatusV1 = "idle" | "playing" | "paused" | "restoring";

type GeometryReplayResultBaseV1 = Readonly<{
  stepId: string;
  playedStepIds: readonly string[];
  temporaryObjects: readonly string[];
  learnerCompleted: false;
}>;

export type GeometryReplayResultV1 = GeometryReplayResultBaseV1 &
  (
    | Readonly<{
        status: "completed";
        restoration: "checkpoint";
        evidence: Readonly<{
          kind: "demonstration_viewed";
          stepId: string;
          actor: "assistant_demo";
        }>;
      }>
    | Readonly<{
        status: "cancelled";
        restoration: "checkpoint" | "learner_world_preserved";
      }>
  );

export class GeometryReplayControllerV1 {
  private active?: AbortController;
  private paused = false;
  private resumeWaiters: Array<() => void> = [];
  private statusValue: GeometryReplayStatusV1 = "idle";

  constructor(
    private readonly dependencies: Readonly<{
      activity: GeometryInvestigationV1;
      uiEffects: GeometryUiEffectsV1;
      checkpoints: GeometryCheckpointControllerV1;
      getAuthority(): GeometryActionAuthorityV1;
      nextRestoreAuthority(): Readonly<{
        activityId: string;
        epoch: number;
        revision: number;
      }>;
      delay?: (delayMs: number, signal: AbortSignal) => Promise<void>;
      onStatus?: (status: GeometryReplayStatusV1) => void;
      onStep?: (step: GeometryDemonstrationStepV1) => void;
      onRestoredWorld?: (world: import("./contracts").GeometryWorldV2) => void;
      freezeMutations?: (reason: string) => void;
      now?: () => number;
    }>,
  ) {}

  get status(): GeometryReplayStatusV1 {
    return this.statusValue;
  }

  async run(input: Readonly<{
    stepId: string;
    speed: "reduced" | "normal";
    signal?: AbortSignal;
  }>): Promise<GeometryReplayResultV1> {
    if (this.active) {
      throw new GeometryActionError(
        "invalid_phase",
        "A geometry demonstration is already active.",
      );
    }
    const target = this.dependencies.activity.demonstrationSteps.find(
      ({ id }) => id === input.stepId,
    );
    if (!target) {
      throw new GeometryActionError(
        "action_not_allowed",
        "The demonstration step is not declared by the activity.",
      );
    }
    const authority = this.dependencies.getAuthority();
    const controller = new AbortController();
    let stopForwarding = forwardAbort(input.signal, controller);
    this.active = controller;
    this.paused = false;
    this.setStatus("playing");
    const checkpoint = await this.dependencies.checkpoints.capture({
      id: replayCheckpointId(authority, target),
      createdAt: this.dependencies.now?.() ?? Date.now(),
      signal: controller.signal,
    });
    if (!checkpoint.ok) {
      this.finish();
      stopForwarding();
      throw new GeometryActionError(
        checkpoint.code === "cancelled" ? "cancelled" : "execution_failed",
        checkpoint.message,
      );
    }
    const steps = this.dependencies.activity.demonstrationSteps.filter(
      (step) => step.missionId === target.missionId && step.order <= target.order,
    );
    const playedStepIds: string[] = [];
    let cancelled = false;
    let primaryError: unknown;
    try {
      for (const step of steps) {
        assertNotAborted(controller.signal);
        await this.waitWhilePaused(controller.signal);
        this.dependencies.onStep?.(step);
        if (step.operation === "highlight") {
          this.dependencies.uiEffects.highlight(
            step.objectNames,
            "relation",
            1_000,
          );
          if (input.speed === "normal") {
            await (this.dependencies.delay?.(150, controller.signal) ??
              abortableDelay(150, controller.signal));
          }
          if (!this.dependencies.uiEffects.cleanup().ok) {
            throw new GeometryActionError(
              "rollback_failed",
              "Demonstration highlight cleanup failed.",
            );
          }
        } else if (step.operation === "restore") {
          if (!this.dependencies.uiEffects.cleanup().ok) {
            throw new GeometryActionError(
              "rollback_failed",
              "Demonstration UI cleanup failed.",
            );
          }
        } else {
          throw new GeometryActionError(
            "action_not_allowed",
            "This demonstration operation has no closed implementation.",
          );
        }
        playedStepIds.push(step.id);
      }
    } catch (error) {
      cancelled = controller.signal.aborted || isAbortError(error);
      primaryError = error;
    }

    const cleanup = this.dependencies.uiEffects.cleanup();
    if (cancelled && controller.signal.reason === "preserve_learner_world") {
      this.finish();
      stopForwarding();
      if (!cleanup.ok) {
        this.dependencies.freezeMutations?.(
          "Demonstration highlight cleanup failed after learner interaction.",
        );
        throw new GeometryActionError(
          "rollback_failed",
          "Demonstration highlights could not be cleaned up safely.",
        );
      }
      return cancelledReplayResult(target.id, playedStepIds, "learner_world_preserved");
    }

    stopForwarding();
    const restoreController = new AbortController();
    stopForwarding = forwardAbort(input.signal, restoreController);
    this.active = restoreController;
    this.setStatus("restoring");
    const restoreAuthority = this.dependencies.nextRestoreAuthority();
    const restored = await this.dependencies.checkpoints.restore(
      checkpoint.checkpoint,
      {
        ...restoreAuthority,
        signal: restoreController.signal,
      },
    );
    this.finish();
    stopForwarding();
    if (!restored.ok) {
      if (restored.code === "cancelled") {
        return cancelledReplayResult(
          target.id,
          playedStepIds,
          "learner_world_preserved",
        );
      }
      this.dependencies.freezeMutations?.(
        "Demonstration checkpoint restoration failed.",
      );
      throw new GeometryActionError(
        "rollback_failed",
        "Demonstration did not restore the learner checkpoint exactly.",
      );
    }
    this.dependencies.onRestoredWorld?.(restored.world);
    if (primaryError && !cancelled) throw primaryError;
    if (cancelled || restoreController.signal.aborted) {
      return cancelledReplayResult(target.id, playedStepIds, "checkpoint");
    }
    return Object.freeze({
      status: "completed",
      stepId: target.id,
      playedStepIds: Object.freeze([...playedStepIds]),
      temporaryObjects: Object.freeze([]),
      restoration: "checkpoint",
      learnerCompleted: false,
      evidence: Object.freeze({
        kind: "demonstration_viewed",
        stepId: target.id,
        actor: "assistant_demo",
      }),
    });
  }

  pause(): boolean {
    if (!this.active || this.paused || this.statusValue !== "playing") return false;
    this.paused = true;
    this.setStatus("paused");
    return true;
  }

  resume(): boolean {
    if (!this.active || !this.paused) return false;
    this.paused = false;
    this.setStatus("playing");
    for (const resolve of this.resumeWaiters.splice(0)) resolve();
    return true;
  }

  stop(options: Readonly<{ preserveLearnerWorld?: boolean }> = {}): boolean {
    if (!this.active) return false;
    this.active.abort(
      options.preserveLearnerWorld
        ? "preserve_learner_world"
        : "restore_checkpoint",
    );
    this.paused = false;
    for (const resolve of this.resumeWaiters.splice(0)) resolve();
    return true;
  }

  private async waitWhilePaused(signal: AbortSignal): Promise<void> {
    while (this.paused) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          reject(new DOMException("Demonstration cancelled.", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        this.resumeWaiters.push(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        });
      });
    }
  }

  private finish(): void {
    this.active = undefined;
    this.paused = false;
    this.resumeWaiters = [];
    this.setStatus("idle");
  }

  private setStatus(status: GeometryReplayStatusV1): void {
    this.statusValue = status;
    this.dependencies.onStatus?.(status);
  }
}

function cancelledReplayResult(
  stepId: string,
  playedStepIds: readonly string[],
  restoration: "checkpoint" | "learner_world_preserved",
): GeometryReplayResultV1 {
  return Object.freeze({
    status: "cancelled",
    stepId,
    playedStepIds: Object.freeze([...playedStepIds]),
    temporaryObjects: Object.freeze([]),
    restoration,
    learnerCompleted: false,
  });
}

function replayCheckpointId(
  authority: GeometryActionAuthorityV1,
  step: GeometryDemonstrationStepV1,
): string {
  return `replay_${step.id}_e${authority.epoch}_r${authority.revision}`.slice(0, 80);
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Demonstration cancelled.", "AbortError");
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Demonstration cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function forwardAbort(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (!source) return () => undefined;
  if (source.aborted) {
    target.abort();
    return () => undefined;
  }
  const abort = () => target.abort();
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

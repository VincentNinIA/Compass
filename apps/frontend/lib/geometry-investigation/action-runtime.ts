import type { ToolRuntime } from "@/lib/tools/runtime";

import {
  GeometryActionGatewayV1,
  type GeometryActionGatewayDependenciesV1,
} from "./action-gateway";
import { GeometryEvidenceStoreV1 } from "./evidence-store";
import { GeometryPrivilegedConsentStoreV1 } from "./privileged-consent";

export type GeometryActionRuntimeDependenciesV1 = Omit<
  GeometryActionGatewayDependenciesV1,
  "evidenceStore" | "privilegedTokens"
> &
  Readonly<{
    evidenceStore?: GeometryEvidenceStoreV1;
    privilegedTokens?: GeometryPrivilegedConsentStoreV1;
  }>;

export class GeometryActionRuntimeV1 {
  readonly gateway: GeometryActionGatewayV1;
  readonly toolRuntime: ToolRuntime;
  readonly evidenceStore: GeometryEvidenceStoreV1;
  readonly privilegedTokens: GeometryPrivilegedConsentStoreV1;

  constructor(private readonly dependencies: GeometryActionRuntimeDependenciesV1) {
    this.evidenceStore =
      dependencies.evidenceStore ?? new GeometryEvidenceStoreV1();
    this.privilegedTokens =
      dependencies.privilegedTokens ?? new GeometryPrivilegedConsentStoreV1();
    this.gateway = new GeometryActionGatewayV1({
      ...dependencies,
      evidenceStore: this.evidenceStore,
      privilegedTokens: this.privilegedTokens,
    });
    this.toolRuntime = {
      gateway: this.gateway,
      getContext: (turnId) => {
        const source = dependencies.getAuthority();
        const anchor = {
          ...source,
          attemptedVariationTargets: [...source.attemptedVariationTargets],
        };
        if (anchor.phase === "fatal") return undefined;
        return {
          turnId,
          phase:
            anchor.phase === "confirmed"
              ? "exercise_confirmed"
              : anchor.phase === "completed"
                ? "completed"
                : "constructing",
          epoch: anchor.epoch,
          revision: anchor.revision,
          isAuthorityCurrent: () => {
            const current = dependencies.getAuthority();
            return (
              current.isCurrent?.() !== false &&
              current.activityId === anchor.activityId &&
              current.epoch === anchor.epoch &&
              current.revision === anchor.revision &&
              current.phase === anchor.phase &&
              current.missionId === anchor.missionId
            );
          },
        };
      },
    };
  }

  issueRestoreConfirmation(request: Readonly<{
    checkpointId: string;
    confirmed: boolean;
    ttlMs?: number;
  }>): string | undefined {
    const authority = this.dependencies.getAuthority();
    const checkpoint = this.evidenceStore.getCheckpoint(request.checkpointId);
    if (
      !request.confirmed ||
      authority.phase !== "investigating" ||
      authority.actor !== "assistant" ||
      !["O4", "O5"].includes(authority.maxLevel) ||
      !checkpoint ||
      checkpoint.activityId !== authority.activityId
    ) {
      return undefined;
    }
    return this.privilegedTokens.issue(
      {
        activityId: authority.activityId,
        epoch: authority.epoch,
        revision: authority.revision,
        action: "restore_geometry_checkpoint",
        checkpointId: request.checkpointId,
      },
      request.ttlMs,
    );
  }

  issueDemonstrationConsent(request: Readonly<{
    stepId: string;
    speed: "reduced" | "normal";
    confirmed: boolean;
    ttlMs?: number;
  }>): string | undefined {
    const authority = this.dependencies.getAuthority();
    const step = this.dependencies.activity.demonstrationSteps.find(
      ({ id }) => id === request.stepId,
    );
    if (
      !request.confirmed ||
      authority.phase !== "investigating" ||
      authority.actor !== "assistant" ||
      authority.maxLevel !== "O5" ||
      !step ||
      step.missionId !== authority.missionId ||
      !authority.attemptedDemonstrationStepIds?.includes(request.stepId)
    ) {
      return undefined;
    }
    return this.privilegedTokens.issue(
      {
        activityId: authority.activityId,
        epoch: authority.epoch,
        revision: authority.revision,
        action: "demonstrate_geometry_step",
        stepId: request.stepId,
        speed: request.speed,
      },
      request.ttlMs,
    );
  }

  async captureBaseline(): Promise<boolean> {
    const checkpoints = this.dependencies.checkpoints;
    const authority = this.dependencies.getAuthority();
    if (!checkpoints || authority.phase === "fatal") return false;
    const captured = await checkpoints.capture({
      id: `baseline_e${authority.epoch}_r${authority.revision}`.slice(0, 80),
      createdAt: Date.now(),
    });
    if (!captured.ok) return false;
    this.evidenceStore.setBaseline(captured.checkpoint);
    return true;
  }

  pauseDemonstration(): boolean {
    return this.dependencies.replay?.pause() ?? false;
  }

  resumeDemonstration(): boolean {
    return this.dependencies.replay?.resume() ?? false;
  }

  stopDemonstration(): boolean {
    return this.dependencies.replay?.stop() ?? false;
  }

  clearActivityMemory(): number {
    const activityId = this.dependencies.getAuthority().activityId;
    this.privilegedTokens.revokeActivity(activityId);
    this.gateway.cancelEffects();
    return this.evidenceStore.clear(activityId);
  }

  cancel(
    reason: "student_action" | "student_speech" | "timeout" | "session_stop",
  ): void {
    this.gateway.cancelEffects(reason);
    this.privilegedTokens.revokeActivity(
      this.dependencies.getAuthority().activityId,
    );
    if (reason === "session_stop") {
      this.evidenceStore.clear(this.dependencies.getAuthority().activityId);
    }
  }
}

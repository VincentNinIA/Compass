import type { CheckpointService } from "./checkpoint";
import type { GeoGebraAdapter } from "./adapter";
import type { SceneRegistry } from "./scene";
import type { SnapshotService } from "./snapshot";
import { createStudentConstructionFingerprint } from "@/lib/pedagogy/meaningful-delta";
import {
  getHintLevelProfile,
  type HintAuthorization,
  type HintConfirmationLedger,
} from "@/lib/pedagogy/hint-assistance";
import type { HighlightManager } from "@/lib/tools/highlight";
import type { SceneObjectKind } from "@/types/geogebra";

export const HINT_OBJECT_PREFIX = "gtHint_";
export const DEFAULT_HINT_TTL_MS = 1_500;

type TimerDependencies = {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};

export type HintEndReason = "expired" | "cancelled" | "new_action";

export type HintDeliveryResult =
  | {
      status: "delivered";
      level: 1 | 2 | 3 | 4;
      restored: true;
      checkpointFallback: boolean;
      helpers: readonly string[];
    }
  | {
      status: "cancelled";
      level: 3 | 4;
      reason: Exclude<HintEndReason, "expired">;
      restored: boolean;
      checkpointFallback: boolean;
      helpers: readonly string[];
    }
  | {
      status: "rejected";
      reason:
        | "invalid_authorization"
        | "confirmation_required"
        | "stale_revision"
        | "hint_active";
    }
  | {
      status: "failed";
      reason: "checkpoint_unavailable" | "effect_failed" | "cleanup_failed";
      restored: boolean;
      checkpointFallback: boolean;
      helpers: readonly string[];
    };

type ActiveHint = {
  directiveId: string;
  abort: AbortController;
  reason: Exclude<HintEndReason, "expired">;
};

export class HintOrchestrator {
  private active?: ActiveHint;

  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly registry: SceneRegistry,
    private readonly snapshots: SnapshotService,
    private readonly checkpoint: CheckpointService,
    private readonly highlights: HighlightManager,
    private readonly confirmations: HintConfirmationLedger,
    private readonly timers: TimerDependencies = { setTimeout, clearTimeout },
  ) {}

  cancelActive(reason: "cancelled" | "new_action" = "cancelled"): boolean {
    if (!this.active) return false;
    this.active.reason = reason;
    this.active.abort.abort();
    return true;
  }

  notifyStudentAction(): boolean {
    return this.cancelActive("new_action");
  }

  async deliver(
    authorization: HintAuthorization,
    options: {
      revision: number;
      confirmationToken?: string;
      ttlMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<HintDeliveryResult> {
    if (!validAuthorization(authorization)) {
      return { status: "rejected", reason: "invalid_authorization" };
    }
    if (this.active) return { status: "rejected", reason: "hint_active" };
    const before = this.snapshots.capture();
    if (!before.ok || before.value.revision !== options.revision) {
      return { status: "rejected", reason: "stale_revision" };
    }
    if (authorization.level <= 2) {
      return {
        status: "delivered",
        level: authorization.level,
        restored: true,
        checkpointFallback: false,
        helpers: [],
      };
    }
    if (
      authorization.level === 4 &&
      (!options.confirmationToken ||
        !this.confirmations.consume(
          options.confirmationToken,
          authorization.directiveId,
          options.revision,
        ))
    ) {
      return { status: "rejected", reason: "confirmation_required" };
    }

    const ttlMs = options.ttlMs ?? DEFAULT_HINT_TTL_MS;
    if (!Number.isInteger(ttlMs) || ttlMs < 100 || ttlMs > 5_000) {
      return { status: "rejected", reason: "invalid_authorization" };
    }

    const safety =
      authorization.level === 4
        ? await this.checkpoint.captureCheckpoint()
        : undefined;
    if (authorization.level === 4 && !safety?.ok) {
      return { status: "failed", reason: "checkpoint_unavailable", restored: true, checkpointFallback: false, helpers: [] };
    }
    const studentBaseline = createStudentConstructionFingerprint(before.value);
    if (!studentBaseline) {
      return { status: "failed", reason: "checkpoint_unavailable", restored: true, checkpointFallback: false, helpers: [] };
    }

    const active: ActiveHint = {
      directiveId: authorization.directiveId,
      abort: new AbortController(),
      reason: "cancelled",
    };
    this.active = active;
    const forwardAbort = () => {
      active.reason = "cancelled";
      active.abort.abort();
    };
    options.signal?.addEventListener("abort", forwardAbort, { once: true });

    const helpers: string[] = [];
    let effectsApplied = false;
    let effectFailed = false;
    let endReason: HintEndReason = "expired";
    let cleanupSucceeded = true;
    let checkpointFallback = false;
    try {
      this.highlights.apply(["A", "B", "AB"], "hint", ttlMs);
      effectsApplied = true;
      const stem = `${HINT_OBJECT_PREFIX}${shortId(authorization.directiveId)}`;
      if (authorization.level === 3) {
        const midpoint = `${stem}_M`;
        createHelper(this.adapter, this.registry, midpoint, `${midpoint} = Midpoint(A, B)`, "point");
        helpers.push(midpoint);
      } else {
        const midpoint = `${stem}_M`;
        const bisector = `${stem}_d`;
        createHelper(this.adapter, this.registry, midpoint, `${midpoint} = Midpoint(A, B)`, "point");
        helpers.push(midpoint);
        createHelper(
          this.adapter,
          this.registry,
          bisector,
          `${bisector} = PerpendicularLine(${midpoint}, AB)`,
          "line",
        );
        helpers.push(bisector);
      }
      endReason = await waitForHintEnd(ttlMs, active.abort.signal, this.timers, active);
    } catch {
      if (active.abort.signal.aborted) endReason = active.reason;
      else effectFailed = true;
    } finally {
      options.signal?.removeEventListener("abort", forwardAbort);
      cleanupSucceeded = removeHelpers(this.adapter, this.registry, helpers);
      cleanupSucceeded =
        this.highlights.cleanup(["A", "B", "AB"]) && cleanupSucceeded;
      this.active = undefined;
    }

    if (!cleanupSucceeded && authorization.level === 4 && safety?.ok) {
      const current = this.snapshots.capture();
      const currentStudents = current.ok
        ? createStudentConstructionFingerprint(current.value)
        : null;
      if (currentStudents?.hash === studentBaseline.hash) {
        const fallback = await this.checkpoint.restoreExact(
          safety.value.checkpoint,
        );
        checkpointFallback = fallback.ok;
        cleanupSucceeded = fallback.ok;
        if (fallback.ok) {
          this.highlights.reconcileAfterExternalRestore(["A", "B", "AB"]);
        }
      }
    }

    if (!effectsApplied || effectFailed) {
      return {
        status: "failed",
        reason: "effect_failed",
        restored: cleanupSucceeded,
        checkpointFallback,
        helpers,
      };
    }
    if (!cleanupSucceeded) {
      return {
        status: "failed",
        reason: "cleanup_failed",
        restored: false,
        checkpointFallback,
        helpers,
      };
    }
    if (endReason !== "expired") {
      return {
        status: "cancelled",
        level: authorization.level as 3 | 4,
        reason: endReason,
        restored: true,
        checkpointFallback,
        helpers,
      };
    }
    return {
      status: "delivered",
      level: authorization.level,
      restored: true,
      checkpointFallback,
      helpers,
    };
  }
}

function validAuthorization(authorization: HintAuthorization): boolean {
  const profile = getHintLevelProfile(authorization.level);
  return (
    /^[A-Za-z0-9_-]{1,128}$/.test(authorization.directiveId) &&
    (authorization.source === "explicit" ||
      (authorization.source === "proactive" && authorization.level === 1)) &&
    authorization.requiresConfirmation === profile.requiresConfirmation &&
    authorization.cleanupPolicy === profile.cleanupPolicy &&
    authorization.allowedTools.length === profile.allowedTools.length &&
    authorization.allowedTools.every((tool) => profile.allowedTools.includes(tool))
  );
}

function createHelper(
  adapter: GeoGebraAdapter,
  registry: SceneRegistry,
  name: string,
  command: string,
  kind: SceneObjectKind,
): void {
  if (!name.startsWith(HINT_OBJECT_PREFIX) || registry.get(name)) {
    throw new Error("Reserved hint label collision.");
  }
  const created = adapter.withApi((api) => {
    if (api.exists(name)) throw new Error("Reserved hint label collision.");
    registry.register(name, "hint", kind);
    try {
      if (!api.evalCommand(command) || !api.exists(name) || !api.isDefined(name)) {
        throw new Error("GeoGebra rejected a hint helper.");
      }
      api.setFixed?.(name, true, false);
      api.setLabelVisible(name, false);
    } catch (error) {
      api.deleteObject?.(name);
      registry.remove(name);
      throw error;
    }
  });
  if (!created.ok) throw new Error(created.error.message);
}

function removeHelpers(
  adapter: GeoGebraAdapter,
  registry: SceneRegistry,
  names: readonly string[],
): boolean {
  let clean = true;
  for (const name of [...names].reverse()) {
    if (!name.startsWith(HINT_OBJECT_PREFIX) || registry.get(name)?.owner !== "hint") {
      clean = false;
      continue;
    }
    try {
      const removed = adapter.withApi((api) => {
        if (api.exists(name)) api.deleteObject?.(name);
        return !api.exists(name);
      });
      if (removed.ok && removed.value) registry.remove(name);
      else clean = false;
    } catch {
      clean = false;
    }
  }
  return clean;
}

function waitForHintEnd(
  ttlMs: number,
  signal: AbortSignal,
  timers: TimerDependencies,
  active: ActiveHint,
): Promise<HintEndReason> {
  if (signal.aborted) return Promise.resolve(active.reason);
  return new Promise((resolve) => {
    const timer = timers.setTimeout(() => {
      signal.removeEventListener("abort", cancelled);
      resolve("expired");
    }, ttlMs);
    const cancelled = () => {
      timers.clearTimeout(timer);
      resolve(active.reason);
    };
    signal.addEventListener("abort", cancelled, { once: true });
  });
}

function shortId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

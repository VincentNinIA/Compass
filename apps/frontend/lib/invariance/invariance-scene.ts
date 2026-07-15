import type { CompletedActionBridge } from "@/lib/geogebra/action-bridge";
import type { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import type { CheckpointService } from "@/lib/geogebra/checkpoint";
import type { SceneRegistry } from "@/lib/geogebra/scene";
import type { SnapshotService } from "@/lib/geogebra/snapshot";
import { createStudentConstructionFingerprint } from "@/lib/pedagogy/meaningful-delta";
import type {
  Checkpoint,
  ConstructionSnapshot,
  SceneObject,
  SceneObjectKind,
} from "@/types/geogebra";
import type {
  InvarianceSceneRequest,
  InvarianceTemporaryScene,
} from "./contracts";

export const INVARIANCE_HELPER_PREFIX = "gtInv_" as const;

export type InvarianceSceneErrorCode =
  | "scene_active"
  | "checkpoint_unavailable"
  | "bridge_unavailable"
  | "authority_expired"
  | "label_collision"
  | "helper_failed"
  | "cleanup_failed"
  | "restore_failed";

export type InvarianceSceneReport = Readonly<{
  runId: string;
  namespace: string;
  status: "completed" | "failed" | "cancelled";
  restoration: "cleanup" | "checkpoint" | "incomplete";
  restored: boolean;
  helpers: readonly string[];
  beforeHash: string | null;
  afterHash: string | null;
  studentHashBefore: string | null;
  studentHashAfter: string | null;
  listenerCountBefore: number | null;
  listenerCountAfter: number;
}>;

export class InvarianceSceneError extends Error {
  readonly name = "InvarianceSceneError";

  constructor(readonly code: InvarianceSceneErrorCode) {
    super(`Invariance temporary scene failed: ${code}.`);
  }
}

type Baseline = Readonly<{
  checkpoint: Checkpoint;
  snapshot: ConstructionSnapshot;
  studentHash: string;
  studentObjects: string;
  objects: readonly SceneObject[];
  objectNames: readonly string[];
  listenerCount: number;
}>;

type ExactState = Readonly<{
  snapshot: ConstructionSnapshot;
  studentHash: string;
}>;

const HELPER_SUFFIX = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const HELPER_EXPRESSION = /^[^=;\r\n]{1,512}$/;

export class InvarianceSceneService {
  private activeRunId?: string;
  private lastReportValue?: InvarianceSceneReport;

  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly registry: SceneRegistry,
    private readonly snapshots: SnapshotService,
    private readonly checkpoints: CheckpointService,
    private readonly bridge: CompletedActionBridge,
  ) {}

  get lastReport(): InvarianceSceneReport | undefined {
    return this.lastReportValue;
  }

  async run<T>(
    request: InvarianceSceneRequest,
    execute: (scene: InvarianceTemporaryScene) => Promise<T> | T,
  ): Promise<T> {
    const namespace = namespaceFor(request.runId);
    if (this.activeRunId) {
      throw new InvarianceSceneError("scene_active");
    }
    this.activeRunId = request.runId;
    this.lastReportValue = undefined;

    let baseline: Baseline | undefined;
    let bridgeStopped = false;
    const helpers: string[] = [];
    try {
      assertCurrent(request);
      const captured = await this.checkpoints.captureCheckpoint();
      if (!captured.ok) {
        throw new InvarianceSceneError("checkpoint_unavailable");
      }
      const student = createStudentConstructionFingerprint(
        captured.value.snapshot,
      );
      if (!student) {
        throw new InvarianceSceneError("checkpoint_unavailable");
      }
      baseline = Object.freeze({
        checkpoint: {
          base64: captured.value.checkpoint.base64,
          initialHash: captured.value.checkpoint.initialHash,
          initialObjectNames: [
            ...captured.value.checkpoint.initialObjectNames,
          ],
          initialObjects: captured.value.checkpoint.initialObjects.map(
            (object) => ({ ...object }),
          ),
        },
        snapshot: captured.value.snapshot,
        studentHash: student.hash,
        studentObjects: JSON.stringify(student.objects),
        objects: Object.freeze(
          captured.value.checkpoint.initialObjects.map((object) =>
            Object.freeze({ ...object }),
          ),
        ),
        objectNames: Object.freeze([
          ...captured.value.checkpoint.initialObjectNames,
        ]),
        listenerCount: captured.value.listenerCount,
      });
      assertCurrent(request);

      let stopped;
      try {
        stopped = this.bridge.stop();
      } catch {
        stopped = undefined;
      }
      if (!stopped?.ok) {
        this.restartListeners(baseline.listenerCount);
        throw new InvarianceSceneError("bridge_unavailable");
      }
      bridgeStopped = true;

      const scene = this.createScope(request, namespace, helpers);
      let value!: T;
      let primaryError: unknown;
      try {
        assertCurrent(request);
        value = await execute(scene);
        assertCurrent(request);
      } catch (error) {
        primaryError = error;
      }

      const helpersRemoved = this.removeHelpers(namespace, helpers);
      const directState = helpersRemoved
        ? this.verifyExactBaseline(baseline, namespace)
        : undefined;
      const directListeners =
        !primaryError &&
        directState !== undefined &&
        this.restartListeners(baseline.listenerCount);

      if (!primaryError && directState && directListeners) {
        this.publishReport(
          request,
          namespace,
          "completed",
          "cleanup",
          true,
          helpers,
          baseline,
          directState,
        );
        return value;
      }

      primaryError ??= new InvarianceSceneError("cleanup_failed");
      const fallback = await this.restoreCheckpoint(baseline, namespace);
      if (!fallback) {
        this.publishReport(
          request,
          namespace,
          isCancellation(primaryError, request.signal)
            ? "cancelled"
            : "failed",
          "incomplete",
          false,
          helpers,
          baseline,
        );
        throw new InvarianceSceneError("restore_failed");
      }
      this.publishReport(
        request,
        namespace,
        isCancellation(primaryError, request.signal) ? "cancelled" : "failed",
        "checkpoint",
        true,
        helpers,
        baseline,
        fallback,
      );
      throw primaryError;
    } catch (error) {
      if (!this.lastReportValue) {
        const restored = baseline
          ? this.verifyExactBaseline(baseline, namespace)
          : undefined;
        this.publishReport(
          request,
          namespace,
          isCancellation(error, request.signal) ? "cancelled" : "failed",
          bridgeStopped ? "incomplete" : "cleanup",
          !bridgeStopped && restored !== undefined,
          helpers,
          baseline,
          restored,
        );
      }
      throw error;
    } finally {
      this.activeRunId = undefined;
    }
  }

  private createScope(
    request: InvarianceSceneRequest,
    namespace: string,
    helpers: string[],
  ): InvarianceTemporaryScene {
    const helperName = (suffix: string) => {
      if (!HELPER_SUFFIX.test(suffix)) {
        throw new InvarianceSceneError("helper_failed");
      }
      const name = `${namespace}${suffix}`;
      if (name.length > 192) {
        throw new InvarianceSceneError("helper_failed");
      }
      return name;
    };
    return Object.freeze({
      namespace,
      helperName,
      createHelper: (
        suffix: string,
        expression: string,
        kind: SceneObjectKind,
      ) => {
        assertCurrent(request);
        if (!HELPER_EXPRESSION.test(expression) || !validKind(kind)) {
          throw new InvarianceSceneError("helper_failed");
        }
        const name = helperName(suffix);
        if (helpers.includes(name)) {
          throw new InvarianceSceneError("label_collision");
        }
        try {
          const created = this.adapter.withApi((api) => {
            if (this.registry.get(name) || api.exists(name)) {
              return { ok: false as const, code: "label_collision" as const };
            }
            this.registry.register(name, "temporary", kind);
            helpers.push(name);
            try {
              if (
                !api.evalCommand(`${name} = ${expression}`) ||
                !api.exists(name) ||
                !api.isDefined(name)
              ) {
                return { ok: false as const, code: "helper_failed" as const };
              }
              api.setLabelVisible(name, false);
              return { ok: true as const };
            } catch {
              return { ok: false as const, code: "helper_failed" as const };
            }
          });
          if (!created.ok) {
            throw new InvarianceSceneError("helper_failed");
          }
          if (!created.value.ok) {
            throw new InvarianceSceneError(created.value.code);
          }
        } catch (error) {
          if (error instanceof InvarianceSceneError) throw error;
          throw new InvarianceSceneError("helper_failed");
        }
        assertCurrent(request);
        return name;
      },
    });
  }

  private removeHelpers(namespace: string, helpers: readonly string[]): boolean {
    let clean = true;
    for (const name of [...helpers].reverse()) {
      if (
        !name.startsWith(namespace) ||
        this.registry.get(name)?.owner !== "temporary"
      ) {
        clean = false;
        continue;
      }
      try {
        const removed = this.adapter.withApi((api) => {
          if (api.exists(name)) api.deleteObject?.(name);
          return !api.exists(name);
        });
        if (removed.ok && removed.value) this.registry.remove(name);
        else clean = false;
      } catch {
        clean = false;
      }
    }
    return clean;
  }

  private restartListeners(expected: number): boolean {
    try {
      const started = this.bridge.start();
      if (!started.ok) return false;
      const reconciled = this.adapter.reconcileClientListeners();
      return reconciled.ok && this.adapter.listenerCount === expected;
    } catch {
      return false;
    }
  }

  private async restoreCheckpoint(
    baseline: Baseline,
    namespace: string,
  ): Promise<ExactState | undefined> {
    try {
      const restored = await this.checkpoints.restoreExact({
        base64: baseline.checkpoint.base64,
        initialHash: baseline.checkpoint.initialHash,
        initialObjectNames: [...baseline.objectNames],
        initialObjects: baseline.objects.map((object) => ({ ...object })),
      }, { advanceEpoch: false });
      if (
        !restored.ok ||
        restored.value.listenerCount !== baseline.listenerCount
      ) {
        return undefined;
      }
      const reconciled = this.adapter.reconcileClientListeners();
      if (!reconciled.ok || this.adapter.listenerCount !== baseline.listenerCount) {
        return undefined;
      }
      return this.verifyExactBaseline(baseline, namespace);
    } catch {
      return undefined;
    }
  }

  private verifyExactBaseline(
    baseline: Baseline,
    namespace: string,
  ): ExactState | undefined {
    const snapshot = this.snapshots.capture();
    const names = this.readObjectNames();
    if (!snapshot.ok || !names) return undefined;
    const student = createStudentConstructionFingerprint(snapshot.value);
    if (
      !student ||
      snapshot.value.hash !== baseline.snapshot.hash ||
      student.hash !== baseline.studentHash ||
      JSON.stringify(student.objects) !== baseline.studentObjects ||
      !sameNames(names, baseline.objectNames) ||
      !sameRegistry(this.registry.list(), baseline.objects) ||
      this.registry
        .list()
        .some(
          ({ name, owner }) =>
            name.startsWith(namespace) && owner === "temporary",
        )
    ) {
      return undefined;
    }
    return Object.freeze({
      snapshot: snapshot.value,
      studentHash: student.hash,
    });
  }

  private readObjectNames(): string[] | undefined {
    try {
      const result = this.adapter.withApi((api) => {
        const names =
          api.getObjectNumber && api.getObjectName
            ? Array.from(
                { length: api.getObjectNumber() },
                (_, index) => api.getObjectName?.(index) ?? "",
              )
            : api.getAllObjectNames?.();
        return names
          ? [...names].map(String).filter(Boolean).sort()
          : undefined;
      });
      return result.ok ? result.value : undefined;
    } catch {
      return undefined;
    }
  }

  private publishReport(
    request: InvarianceSceneRequest,
    namespace: string,
    status: InvarianceSceneReport["status"],
    restoration: InvarianceSceneReport["restoration"],
    restored: boolean,
    helpers: readonly string[],
    baseline?: Baseline,
    after?: ExactState,
  ): void {
    this.lastReportValue = Object.freeze({
      runId: request.runId,
      namespace,
      status,
      restoration,
      restored,
      helpers: Object.freeze([...helpers]),
      beforeHash: baseline?.snapshot.hash ?? null,
      afterHash: after?.snapshot.hash ?? null,
      studentHashBefore: baseline?.studentHash ?? null,
      studentHashAfter: after?.studentHash ?? null,
      listenerCountBefore: baseline?.listenerCount ?? null,
      listenerCountAfter: this.adapter.listenerCount,
    });
  }
}

function namespaceFor(runId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) {
    throw new InvarianceSceneError("helper_failed");
  }
  return `${INVARIANCE_HELPER_PREFIX}${runId.replaceAll("-", "_")}_`;
}

function assertCurrent(request: InvarianceSceneRequest): void {
  if (request.signal.aborted) throw abortError();
  if (!request.isAuthorityCurrent()) {
    throw new InvarianceSceneError("authority_expired");
  }
}

function abortError(): DOMException {
  return new DOMException("Invariance scene cancelled.", "AbortError");
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function validKind(kind: SceneObjectKind): boolean {
  return ["point", "segment", "line", "boolean", "number", "other"].includes(
    kind,
  );
}

function sameNames(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

function sameRegistry(
  left: readonly SceneObject[],
  right: readonly SceneObject[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (object, index) =>
        object.name === right[index]?.name &&
        object.owner === right[index]?.owner &&
        object.kind === right[index]?.kind,
    )
  );
}

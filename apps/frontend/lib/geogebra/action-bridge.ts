import type { GeoGebraAdapter } from "./adapter";
import type { SceneRegistry } from "./scene";
import type { SnapshotService } from "./snapshot";
import type {
  CompletedConstructionAction,
  GeoGebraClientEvent,
  GeoGebraClientListener,
  SceneObjectKind,
} from "@/types/geogebra";

const SAMPLE_INTERVAL_MS = 50;
const STABILITY_WINDOW_MS = 500;

type ActionKind = CompletedConstructionAction["kind"];

export type ConstructionActivity =
  | { type: "student_drag_started"; affectedNames: readonly string[] }
  | { type: "student_drag_ended"; affectedNames: readonly string[] };

export class CompletedActionBridge {
  private readonly affectedNames = new Set<string>();
  private readonly studentAffectedNames = new Set<string>();
  private generation = 0;
  private actionCounter = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pendingKind: ActionKind = "update";
  private dragActive = false;
  private readonly listener: GeoGebraClientListener;
  private readonly addListener = (name: string) => this.handle({ type: "add", target: name });
  private readonly removeListener = (name: string) => this.handle({ type: "remove", target: name });
  private readonly updateListener = (name: string) => this.handle({ type: "update", target: name });

  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly registry: SceneRegistry,
    private readonly snapshots: SnapshotService,
    private readonly onAction: (action: CompletedConstructionAction) => void,
    private readonly onActivity?: (activity: ConstructionActivity) => void,
  ) {
    this.listener = (event) => this.handle(event);
  }

  start() {
    const client = this.adapter.registerClientListener(this.listener);
    if (!client.ok) return client;
    for (const [kind, listener] of [
      ["add", this.addListener],
      ["remove", this.removeListener],
      ["update", this.updateListener],
    ] as const) {
      const result = this.adapter.registerObjectListener(kind, listener);
      if (!result.ok) {
        this.stop();
        return result;
      }
    }
    return { ok: true as const, value: undefined };
  }

  stop() {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.affectedNames.clear();
    this.studentAffectedNames.clear();
    this.dragActive = false;
    this.adapter.unregisterObjectListener("add", this.addListener);
    this.adapter.unregisterObjectListener("remove", this.removeListener);
    this.adapter.unregisterObjectListener("update", this.updateListener);
    return this.adapter.unregisterClientListener(this.listener);
  }

  handle(event: GeoGebraClientEvent) {
    const kind = eventKind(event.type);
    if (!kind) return;

    const names = normalizeAffectedNames(event.target, event.argument);
    for (const name of names) {
      this.affectedNames.add(name);
    }
    this.pendingKind = mergeKinds(this.pendingKind, kind);
    if (kind === "remove") this.rememberStudentOwnership(names);
    this.reconcileOwnership(names, kind);
    if (kind !== "remove") this.rememberStudentOwnership(names);

    if (event.type === "movingGeos") {
      if (!this.dragActive && this.hasStudentNames(names)) {
        this.dragActive = true;
        this.onActivity?.({
          type: "student_drag_started",
          affectedNames: [...names],
        });
      }
      return;
    }
    if (
      (event.type === "dragEnd" || event.type === "movedGeos") &&
      this.dragActive
    ) {
      this.dragActive = false;
      this.onActivity?.({
        type: "student_drag_ended",
        affectedNames: [...names],
      });
    }
    this.scheduleStabilization();
  }

  private hasStudentNames(names: readonly string[]): boolean {
    return names.some((name) => this.registry.get(name)?.owner === "student");
  }

  private reconcileOwnership(names: string[], kind: ActionKind) {
    if (kind === "remove") {
      for (const name of names) this.registry.remove(name);
      return;
    }
    if (kind !== "add") return;
    this.adapter.withApi((api) => {
      for (const name of names) {
        // Application-owned helpers are registered before evalCommand so their
        // add event can never be reclassified as student work.
        if (this.registry.get(name)) continue;
        if (!api.exists(name) || !api.isDefined(name)) continue;
        const rawKind = api.getObjectType?.(name) ?? "other";
        this.registry.register(name, "student", normalizeKind(rawKind));
      }
    });
  }

  private rememberStudentOwnership(names: string[]) {
    for (const name of names) {
      if (this.registry.get(name)?.owner === "student") {
        this.studentAffectedNames.add(name);
      }
    }
  }

  private scheduleStabilization() {
    const generation = ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    const deadline = Date.now() + STABILITY_WINDOW_MS;
    let previousHash: string | undefined;

    const sample = () => {
      if (generation !== this.generation) return;
      const snapshot = this.snapshots.capture();
      if (snapshot.ok) {
        if (snapshot.value.hash === previousHash) {
          if (this.affectedNames.size === 0) {
            this.pendingKind = "update";
            this.timer = undefined;
            return;
          }
          this.actionCounter += 1;
          this.onAction({
            id: `construction-action-${this.actionCounter}`,
            kind: this.pendingKind,
            affectedNames: [...this.affectedNames].sort(),
            studentAffectedNames: [...this.studentAffectedNames].sort(),
            revision: snapshot.value.revision,
            snapshotHash: snapshot.value.hash,
          });
          this.affectedNames.clear();
          this.studentAffectedNames.clear();
          this.pendingKind = "update";
          this.timer = undefined;
          return;
        }
        previousHash = snapshot.value.hash;
      } else {
        previousHash = undefined;
      }
      if (Date.now() + SAMPLE_INTERVAL_MS <= deadline) {
        this.timer = setTimeout(sample, SAMPLE_INTERVAL_MS);
      } else {
        this.affectedNames.clear();
        this.studentAffectedNames.clear();
        this.pendingKind = "update";
        this.timer = undefined;
      }
    };

    this.timer = setTimeout(sample, 0);
  }
}

export function normalizeAffectedNames(target: unknown, argument: unknown) {
  const names = new Set<string>();
  collectNames(target, names);
  collectNames(argument, names);
  return [...names].filter(Boolean).sort();
}

function collectNames(value: unknown, names: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectNames(item, names);
    return;
  }
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        collectNames((parsed as { labels?: unknown }).labels, names);
      } else {
        collectNames(parsed, names);
      }
      return;
    } catch {
      return;
    }
  }
  for (const name of trimmed.split(",")) {
    const normalized = name.trim();
    if (/^[\p{L}_][\p{L}\p{N}_']*$/u.test(normalized)) names.add(normalized);
  }
}

function eventKind(type: string): ActionKind | undefined {
  if (type === "add") return "add";
  if (type === "remove" || type === "deleteGeos") return "remove";
  if (type === "dragEnd" || type === "movedGeos" || type === "movingGeos") return "drag";
  if (type === "update") return "update";
  return undefined;
}

function mergeKinds(current: ActionKind, next: ActionKind): ActionKind {
  const priority: ActionKind[] = ["update", "add", "remove", "drag"];
  return priority.indexOf(next) > priority.indexOf(current) ? next : current;
}

function normalizeKind(kind: string): SceneObjectKind {
  if (["point", "segment", "line", "boolean", "number"].includes(kind)) {
    return kind as SceneObjectKind;
  }
  return "other";
}

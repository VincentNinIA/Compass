import type { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import type { SceneRegistry } from "@/lib/geogebra/scene";
import type {
  GeoGebraClientEvent,
  GeoGebraClientListener,
  GeoGebraObjectListener,
  GeoGebraObjectListenerKind,
  SceneObjectKind,
} from "@/types/geogebra";

import type {
  GeometryWorldChangeV2,
  GeometryWorldDeltaV2,
  GeometryWorldV2,
} from "./contracts";
import { createGeometryWorldDeltaV2, readGeometryWorldV2 } from "./world";

export type GeometryWorldCommitV2 = Readonly<{
  world: GeometryWorldV2;
  delta: GeometryWorldDeltaV2;
}>;

export type GeometryWorldAuthorityV2 = Readonly<{
  activityId: string;
  epoch: number;
}>;

export type GeometryWorldStabilizerV2Options = Readonly<{
  readWorld(revision: number, change: GeometryWorldChangeV2): GeometryWorldV2;
  getAuthority(): GeometryWorldAuthorityV2;
  onCommit(commit: GeometryWorldCommitV2): void;
  coalesceMs?: number;
  sampleMs?: number;
  maxStabilityMs?: number;
  now?: () => number;
}>;

export type GeometryWorldObserverV2Options = Pick<
  GeometryWorldStabilizerV2Options,
  "coalesceMs" | "sampleMs" | "maxStabilityMs" | "now"
> &
  Readonly<{
    onLearnerInteraction?: (event: GeoGebraClientEvent) => void;
  }>;

export class GeometryWorldStabilizerV2 {
  private readonly coalesceMs: number;
  private readonly sampleMs: number;
  private readonly maxStabilityMs: number;
  private readonly now: () => number;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pendingChange?: GeometryWorldChangeV2;
  private movingNames = new Set<string>();
  private lastWorld?: GeometryWorldV2;
  private stopped = false;

  constructor(private readonly options: GeometryWorldStabilizerV2Options) {
    this.coalesceMs = options.coalesceMs ?? 180;
    this.sampleMs = options.sampleMs ?? 50;
    this.maxStabilityMs = options.maxStabilityMs ?? 500;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.observe({ type: "initial" }, "system");
  }

  observe(
    event: GeoGebraClientEvent,
    actor: GeometryWorldChangeV2["actor"] = "learner",
  ): void {
    if (this.stopped) return;
    if (event.type === "movingGeos") {
      for (const name of readEventNames(event)) this.movingNames.add(name);
      return;
    }
    if (event.type === "update" && this.movingNames.size > 0) {
      for (const name of readEventNames(event)) this.movingNames.add(name);
      return;
    }
    const next = toWorldChange(event, actor, this.now(), this.movingNames);
    if (!next) return;
    if (next.kind === "drag_end" || next.kind === "moved_geos") {
      this.movingNames.clear();
    }
    this.pendingChange = mergeWorldChanges(this.pendingChange, next);
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingChange = undefined;
    this.movingNames.clear();
  }

  synchronize(world: GeometryWorldV2): void {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingChange = undefined;
    this.movingNames.clear();
    this.lastWorld = world;
  }

  private schedule(): void {
    const generation = ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sample(generation), this.coalesceMs);
  }

  private sample(generation: number): void {
    if (!this.isCurrent(generation) || !this.pendingChange) return;
    const authority = this.options.getAuthority();
    const change = this.pendingChange;
    const revision = (this.lastWorld?.revision ?? -1) + 1;
    const deadline = this.now() + this.maxStabilityMs;
    let previous: GeometryWorldV2 | undefined;

    const read = () => {
      if (!this.isCurrent(generation)) return;
      let world: GeometryWorldV2;
      try {
        world = this.options.readWorld(revision, change);
      } catch {
        this.clearPending(generation);
        return;
      }
      if (!authorityMatches(authority, world, this.options.getAuthority())) {
        this.clearPending(generation);
        return;
      }
      if (previous && worldsMatch(previous, world)) {
        this.commit(generation, world);
        return;
      }
      previous = world;
      if (this.now() + this.sampleMs <= deadline) {
        this.timer = setTimeout(read, this.sampleMs);
      } else {
        this.clearPending(generation);
      }
    };

    read();
  }

  private commit(generation: number, world: GeometryWorldV2): void {
    if (!this.isCurrent(generation)) return;
    const meaningful =
      !this.lastWorld ||
      this.lastWorld.snapshotHash !== world.snapshotHash ||
      ["set_mode", "select", "deselect", "undo", "redo", "focus_view"].includes(
        world.change.kind,
      );
    if (meaningful) {
      const delta = createGeometryWorldDeltaV2(this.lastWorld, world);
      this.lastWorld = world;
      this.options.onCommit({ world, delta });
    }
    this.clearPending(generation);
  }

  private clearPending(generation: number): void {
    if (generation !== this.generation) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingChange = undefined;
  }

  private isCurrent(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }
}

export class GeometryWorldObserverV2 {
  private readonly stabilizer: GeometryWorldStabilizerV2;
  private readonly objectListeners = new Map<
    GeoGebraObjectListenerKind,
    GeoGebraObjectListener
  >();
  private readonly clientListener: GeoGebraClientListener;
  private started = false;

  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly registry: SceneRegistry,
    activityId: string,
    onCommit: (commit: GeometryWorldCommitV2) => void,
    private readonly options: GeometryWorldObserverV2Options = {},
  ) {
    this.stabilizer = new GeometryWorldStabilizerV2({
      ...options,
      getAuthority: () => ({ activityId, epoch: adapter.epoch }),
      readWorld: (revision, change) => {
        const result = adapter.withApi((api) =>
          readGeometryWorldV2(api, {
            activityId,
            epoch: adapter.epoch,
            revision,
            change,
            registry,
          }),
        );
        if (!result.ok) throw new Error(result.error.code);
        return result.value;
      },
      onCommit,
    });
    for (const kind of ["add", "remove", "update"] as const) {
      this.objectListeners.set(kind, (name) => {
        this.reconcileOwnership(kind, name);
        this.stabilizer.observe({ type: kind, target: name });
      });
    }
    this.clientListener = (event) => this.observe(event);
  }

  start() {
    if (this.started) return { ok: true as const, value: undefined };
    const client = this.adapter.registerClientListener(this.clientListener);
    if (!client.ok) return client;
    for (const [kind, listener] of this.objectListeners) {
      const result = this.adapter.registerObjectListener(kind, listener);
      if (!result.ok) {
        this.stop();
        return result;
      }
    }
    this.started = true;
    this.stabilizer.start();
    return { ok: true as const, value: undefined };
  }

  observe(
    event: GeoGebraClientEvent,
    actor: GeometryWorldChangeV2["actor"] = "learner",
  ): void {
    if (actor === "learner" && isDirectLearnerInteraction(event)) {
      this.options.onLearnerInteraction?.(event);
    }
    this.stabilizer.observe(event, actor);
  }

  synchronize(world: GeometryWorldV2): void {
    this.stabilizer.synchronize(world);
  }

  stop() {
    this.stabilizer.stop();
    for (const [kind, listener] of this.objectListeners) {
      this.adapter.unregisterObjectListener(kind, listener);
    }
    this.objectListeners.clear();
    this.started = false;
    return this.adapter.unregisterClientListener(this.clientListener);
  }

  private reconcileOwnership(kind: GeoGebraObjectListenerKind, name: string): void {
    if (kind === "remove") {
      this.registry.remove(name);
      return;
    }
    if (kind !== "add" || this.registry.get(name)) return;
    const result = this.adapter.withApi((api) => {
      if (!api.exists(name) || !api.isDefined(name)) return;
      this.registry.register(
        name,
        "student",
        normalizeSceneKind(api.getObjectType?.(name)),
      );
    });
    if (!result.ok) return;
  }
}

function isDirectLearnerInteraction(event: GeoGebraClientEvent): boolean {
  return [
    "add",
    "remove",
    "deleteGeos",
    "movingGeos",
    "dragEnd",
    "select",
    "deselect",
    "undo",
    "redo",
  ].includes(event.type);
}

function toWorldChange(
  event: GeoGebraClientEvent,
  actor: GeometryWorldChangeV2["actor"],
  occurredAt: number,
  movingNames: ReadonlySet<string>,
): GeometryWorldChangeV2 | undefined {
  const kindByType: Record<string, GeometryWorldChangeV2["kind"]> = {
    initial: "initial",
    add: "add",
    remove: "remove",
    deleteGeos: "remove",
    update: "update",
    dragEnd: "drag_end",
    movedGeos: "moved_geos",
    setMode: "set_mode",
    select: "select",
    deselect: "deselect",
    undo: "undo",
    redo: "redo",
    focusView: "focus_view",
  };
  const kind = kindByType[event.type];
  if (!kind) return undefined;
  const names = new Set(readEventNames(event));
  if (kind === "drag_end" || kind === "moved_geos") {
    for (const name of movingNames) names.add(name);
  }
  return {
    kind,
    objectNames: [...names].sort(),
    terminal: true,
    actor,
    occurredAt,
  };
}

function mergeWorldChanges(
  current: GeometryWorldChangeV2 | undefined,
  next: GeometryWorldChangeV2,
): GeometryWorldChangeV2 {
  if (!current) return next;
  const priority: GeometryWorldChangeV2["kind"][] = [
    "initial",
    "update",
    "select",
    "deselect",
    "set_mode",
    "add",
    "remove",
    "undo",
    "redo",
    "focus_view",
    "moved_geos",
    "drag_end",
  ];
  const kind =
    priority.indexOf(next.kind) >= priority.indexOf(current.kind)
      ? next.kind
      : current.kind;
  return {
    kind,
    objectNames: [...new Set([...current.objectNames, ...next.objectNames])].sort(),
    terminal: true,
    actor: next.actor,
    occurredAt: next.occurredAt,
  };
}

function readEventNames(event: GeoGebraClientEvent): string[] {
  const names = new Set<string>();
  collectNames(event.target, names);
  collectNames(event.argument, names);
  return [...names].sort();
}

function collectNames(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNames(item, names);
    return;
  }
  if (typeof value !== "string") return;
  const trimmed = value.trim();
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
  for (const token of trimmed.split(",")) {
    const name = token.trim();
    if (/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) names.add(name);
  }
}

function worldsMatch(left: GeometryWorldV2, right: GeometryWorldV2): boolean {
  return (
    left.snapshotHash === right.snapshotHash &&
    JSON.stringify(left.objects) === JSON.stringify(right.objects)
  );
}

function authorityMatches(
  initial: GeometryWorldAuthorityV2,
  world: GeometryWorldV2,
  current: GeometryWorldAuthorityV2,
): boolean {
  return (
    initial.activityId === current.activityId &&
    initial.epoch === current.epoch &&
    world.activityId === current.activityId &&
    world.epoch === current.epoch
  );
}

function normalizeSceneKind(value: string | undefined): SceneObjectKind {
  const normalized = value?.toLowerCase();
  if (normalized && ["point", "segment", "line", "boolean", "number"].includes(normalized)) {
    return normalized as SceneObjectKind;
  }
  return "other";
}

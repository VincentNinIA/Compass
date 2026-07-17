import type { SceneRegistry } from "@/lib/geogebra/scene";
import { normalizeCommand, stableHash } from "@/lib/geogebra/snapshot";
import type { GeoGebraApi, SceneObjectOwner } from "@/types/geogebra";

import {
  GeometryWorldDeltaV2,
  GeometryWorldV2,
  type GeometryFactV1,
  type GeometryWorldChangeV2,
  type GeometryWorldObjectV2,
} from "./contracts";
import { parseGeometryDependencies } from "./dependencies";

export const MAX_GEOMETRY_WORLD_OBJECTS = 40 as const;
const MAX_API_OBJECTS = 200;

export type ReadGeometryWorldV2Options = Readonly<{
  activityId: string;
  epoch: number;
  revision: number;
  change: GeometryWorldChangeV2;
  registry?: Pick<SceneRegistry, "get">;
  facts?: readonly GeometryFactV1[];
}>;

export function readGeometryWorldV2(
  api: GeoGebraApi,
  options: ReadGeometryWorldV2Options,
): GeometryWorldV2 {
  const names = readObjectNames(api);
  const objects = names
    .slice(0, MAX_GEOMETRY_WORLD_OBJECTS)
    .map((name) => readWorldObject(api, name, options.registry));
  const snapshotHash = stableHash(
    JSON.stringify({ schemaVersion: "geometry-world-snapshot.v2", objects }),
  );
  const facts = (options.facts ?? []).filter(
    (fact) =>
      fact.epoch === options.epoch &&
      fact.revision === options.revision &&
      fact.snapshotHash === snapshotHash,
  );

  return GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId: options.activityId,
    epoch: options.epoch,
    revision: options.revision,
    snapshotHash,
    objectCount: names.length,
    truncated: names.length > MAX_GEOMETRY_WORLD_OBJECTS,
    objects,
    facts,
    change: options.change,
  });
}

export function createGeometryWorldDeltaV2(
  previous: GeometryWorldV2 | undefined,
  next: GeometryWorldV2,
): GeometryWorldDeltaV2 {
  const before = new Map(
    (previous?.objects ?? []).map((object) => [object.name, object]),
  );
  const after = new Map(next.objects.map((object) => [object.name, object]));
  const added = next.objects.filter((object) => !before.has(object.name));
  const removed = (previous?.objects ?? [])
    .filter((object) => !after.has(object.name))
    .map(({ name }) => name);
  const changed = next.objects.filter((object) => {
    const prior = before.get(object.name);
    return prior !== undefined && JSON.stringify(prior) !== JSON.stringify(object);
  });

  return GeometryWorldDeltaV2.parse({
    schemaVersion: "geometry_world_delta.v2",
    activityId: next.activityId,
    epoch: next.epoch,
    revision: next.revision,
    previousRevision: previous?.revision ?? null,
    snapshotHash: next.snapshotHash,
    added,
    removed,
    changed,
    objectCount: next.objectCount,
    truncated: next.truncated,
    change: next.change,
  });
}

function readObjectNames(api: GeoGebraApi): string[] {
  const names = api.getAllObjectNames?.();
  if (Array.isArray(names)) {
    return [...new Set(names.filter(validObjectName))]
      .slice(0, MAX_API_OBJECTS)
      .sort((left, right) => left.localeCompare(right));
  }
  const count = Math.max(0, Math.min(MAX_API_OBJECTS, api.getObjectNumber?.() ?? 0));
  const fallback = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const name = api.getObjectName?.(index);
    if (validObjectName(name)) fallback.add(name);
  }
  return [...fallback].sort((left, right) => left.localeCompare(right));
}

function readWorldObject(
  api: GeoGebraApi,
  name: string,
  registry: Pick<SceneRegistry, "get"> | undefined,
): GeometryWorldObjectV2 {
  const type = safeRead(() => api.getObjectType?.(name), undefined) ?? "unknown";
  const rawCommand = safeRead(() => api.getCommandString(name, false), "");
  const command = normalizeCommand(rawCommand).slice(0, 240);
  const dependency = parseGeometryDependencies(command);
  const x = type.toLowerCase() === "point" ? finite(api.getXcoord?.(name)) : undefined;
  const y = type.toLowerCase() === "point" ? finite(api.getYcoord?.(name)) : undefined;
  const color = normalizeColor(safeRead(() => api.getColor?.(name), undefined));
  return {
    name,
    type: String(type).slice(0, 80) || "unknown",
    command,
    parents: dependency.parents,
    dependencyStatus: dependency.status,
    owner: mapOwner(registry?.get(name)?.owner),
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
    ...(color ? { color } : {}),
    visible: safeRead(() => api.getVisible?.(name), true) !== false,
  };
}

function mapOwner(
  owner: SceneObjectOwner | undefined,
): GeometryWorldObjectV2["owner"] {
  if (owner === "exercise" || owner === "system" || owner === "scaffold") {
    return "scaffold";
  }
  if (owner === "hint") return "hint";
  if (owner === "temporary") return "temporary";
  if (owner === "assistant") return "assistant";
  return "student";
}

function safeRead<T>(operation: () => T, fallback: T): T {
  try {
    return operation() ?? fallback;
  } catch {
    return fallback;
  }
}

function finite(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function normalizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized.toUpperCase() : undefined;
}

function validObjectName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value);
}

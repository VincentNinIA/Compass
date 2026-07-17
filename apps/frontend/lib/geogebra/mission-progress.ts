import type { GeneralExerciseReadyV1 } from "@/lib/exercise/general-exercise-contracts";
import type { GeoGebraApi } from "@/types/geogebra";

export type GeoGebraWorldObjectV1 = {
  name: string;
  type: string;
  command: string;
  color?: string;
  x?: number;
  y?: number;
};

export type GeoGebraWorldChangeV1 = {
  type: "initial" | "add" | "remove" | "update" | "client";
  target?: string;
};

export type GeoGebraWorldStateV1 = {
  schemaVersion: "geogebra_world.v1";
  revision: number;
  objectCount: number;
  truncated: boolean;
  objects: GeoGebraWorldObjectV1[];
  verifiedTaskIndexes: number[];
  change: GeoGebraWorldChangeV1;
};

const MAX_WORLD_OBJECTS = 40;
const COLOR_HEX = {
  green: "#2e7d32",
  blue: "#2563eb",
  red: "#c63d2f",
} as const;

export function readGeoGebraWorldState(
  api: GeoGebraApi,
  exercise: GeneralExerciseReadyV1 | undefined,
  revision: number,
  change: GeoGebraWorldChangeV1,
): GeoGebraWorldStateV1 {
  const names = readObjectNames(api);
  return {
    schemaVersion: "geogebra_world.v1",
    revision,
    objectCount: names.length,
    truncated: names.length > MAX_WORLD_OBJECTS,
    objects: names.slice(0, MAX_WORLD_OBJECTS).map((name) => readObject(api, name)),
    verifiedTaskIndexes: exercise
      ? evaluateGeoGebraMissions(api, exercise)
      : [],
    change,
  };
}

export function evaluateGeoGebraMissions(
  api: GeoGebraApi,
  exercise: GeneralExerciseReadyV1,
): number[] {
  const tasks = exercise.tasks.map(normalizeText);
  const checks = [
    matchesPointMission(tasks[0]) && hasNonAlignedPoints(api, "E", "F", "G"),
    matchesLineMission(tasks[1]) &&
      hasConstruction(api, "line", "F", "G", COLOR_HEX.green, true),
    matchesRayMission(tasks[2]) &&
      hasConstruction(api, "ray", "E", "F", COLOR_HEX.blue, false),
    matchesSegmentMission(tasks[3]) &&
      hasConstruction(api, "segment", "E", "G", COLOR_HEX.red, true),
    matchesPointKMission(tasks[4]) &&
      isPointOnRayOutsideSegment(api, "K", "E", "F"),
  ];
  const verified: number[] = [];
  for (const [index, passed] of checks.entries()) {
    if (!passed) break;
    verified.push(index);
  }
  return verified;
}

function matchesPointMission(task: string | undefined): boolean {
  return Boolean(task && task.includes("point") && task.includes("e") && task.includes("f") && task.includes("g") && (task.includes("non aligne") || task.includes("not aligned")));
}

function matchesLineMission(task: string | undefined): boolean {
  return Boolean(task && (task.includes("droite") || task.includes("line")) && !task.includes("demi") && task.includes("f") && task.includes("g"));
}

function matchesRayMission(task: string | undefined): boolean {
  return Boolean(task && (task.includes("demi-droite") || task.includes("ray")) && task.includes("e") && task.includes("f"));
}

function matchesSegmentMission(task: string | undefined): boolean {
  return Boolean(task && task.includes("segment") && task.includes("e") && task.includes("g"));
}

function matchesPointKMission(task: string | undefined): boolean {
  return Boolean(task && task.includes("point k") && (task.includes("demi-droite") || task.includes("ray")) && task.includes("segment"));
}

function hasNonAlignedPoints(
  api: GeoGebraApi,
  first: string,
  second: string,
  third: string,
): boolean {
  const a = pointCoordinates(api, first);
  const b = pointCoordinates(api, second);
  const c = pointCoordinates(api, third);
  if (!a || !b || !c) return false;
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const scale = Math.max(
    1,
    Math.abs(b.x - a.x),
    Math.abs(b.y - a.y),
    Math.abs(c.x - a.x),
    Math.abs(c.y - a.y),
  );
  return Math.abs(cross) > 1e-7 * scale * scale;
}

function hasConstruction(
  api: GeoGebraApi,
  kind: "line" | "ray" | "segment",
  pointA: string,
  pointB: string,
  expectedColor: string,
  reversible: boolean,
): boolean {
  const expected = `${kind}(${pointA},${pointB})`.toLowerCase();
  const reversed = `${kind}(${pointB},${pointA})`.toLowerCase();
  return readObjectNames(api).some((name) => {
    const type = api.getObjectType?.(name)?.toLowerCase();
    const command = normalizeCommand(api.getCommandString(name, false));
    const color = api.getColor?.(name)?.toLowerCase();
    return (
      type === kind &&
      (command.includes(expected) || (reversible && command.includes(reversed))) &&
      color === expectedColor
    );
  });
}

function isPointOnRayOutsideSegment(
  api: GeoGebraApi,
  point: string,
  origin: string,
  through: string,
): boolean {
  const k = pointCoordinates(api, point);
  const e = pointCoordinates(api, origin);
  const f = pointCoordinates(api, through);
  if (!k || !e || !f) return false;
  const dx = f.x - e.x;
  const dy = f.y - e.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return false;
  const projection = ((k.x - e.x) * dx + (k.y - e.y) * dy) / lengthSquared;
  const distance = Math.abs((k.x - e.x) * dy - (k.y - e.y) * dx);
  return projection > 1 + 1e-7 && distance <= 1e-7 * Math.max(1, lengthSquared);
}

function pointCoordinates(
  api: GeoGebraApi,
  name: string,
): { x: number; y: number } | undefined {
  if (!api.exists(name) || !api.isDefined(name)) return undefined;
  if (api.getObjectType?.(name)?.toLowerCase() !== "point") return undefined;
  const x = api.getXcoord?.(name);
  const y = api.getYcoord?.(name);
  return Number.isFinite(x) && Number.isFinite(y)
    ? { x: x as number, y: y as number }
    : undefined;
}

function readObjectNames(api: GeoGebraApi): string[] {
  const names = api.getAllObjectNames?.();
  if (Array.isArray(names)) return [...names].sort((a, b) => a.localeCompare(b));
  const count = Math.max(0, Math.min(200, api.getObjectNumber?.() ?? 0));
  const fallback: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = api.getObjectName?.(index);
    if (name) fallback.push(name);
  }
  return fallback.sort((a, b) => a.localeCompare(b));
}

function readObject(api: GeoGebraApi, name: string): GeoGebraWorldObjectV1 {
  const type = api.getObjectType?.(name) ?? "unknown";
  const x = finiteOrUndefined(type.toLowerCase() === "point" ? api.getXcoord?.(name) : undefined);
  const y = finiteOrUndefined(type.toLowerCase() === "point" ? api.getYcoord?.(name) : undefined);
  return {
    name,
    type,
    command: api.getCommandString(name, false).slice(0, 240),
    ...(api.getColor?.(name) ? { color: api.getColor?.(name).toLowerCase() } : {}),
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
  };
}

function normalizeCommand(command: string): string {
  return command.replaceAll("[", "(").replaceAll("]", ")").replace(/\s+/g, "").toLowerCase();
}

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function finiteOrUndefined(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

import { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import type { GeneralExerciseReadyV1 } from "@/lib/exercise/general-exercise-contracts";
import type {
  GeoGebraApi,
  GeoGebraClientEvent,
  GeoGebraClientListener,
  GeoGebraObjectListener,
  GeoGebraObjectListenerKind,
} from "@/types/geogebra";
import type {
  GatewayCall,
  GatewayContext,
  GatewayEnvelope,
  GatewayErrorCode,
  ToolGatewayExecutor,
} from "@/lib/tools/gateway";
import type { ToolRuntime } from "@/lib/tools/runtime";
import {
  readGeoGebraWorldState,
  type GeoGebraWorldChangeV1,
  type GeoGebraWorldStateV1,
} from "./mission-progress";
import {
  isGeoGebraAssistToolName,
  type GeoGebraAssistToolName,
} from "./assist-tools";

type AssistColor = "green" | "blue" | "red" | "black";
type ConstructionKind = "line" | "ray" | "segment";

type PointPairArguments = {
  pointA: string;
  pointB: string;
  color: AssistColor;
};

type ParsedArguments =
  | { kind: "inspect" }
  | { kind: "create_point"; label: string; x: number; y: number; color: AssistColor }
  | { kind: "rename"; currentName: string; newName: string }
  | { kind: "move_point"; point: string; x: number; y: number }
  | { kind: "style"; objectName: string; color: AssistColor; labelVisible: boolean }
  | ({ kind: ConstructionKind } & PointPairArguments)
  | { kind: "circle"; center: string; throughPoint: string; color: AssistColor }
  | { kind: "polygon"; pointLabels: string[]; color: AssistColor };

export type GeoGebraAssistRuntimeOptions = {
  exercise?: GeneralExerciseReadyV1;
  debounceMs?: number;
  onWorldState?(state: GeoGebraWorldStateV1): void;
};

const COLOR_RGB: Record<AssistColor, readonly [number, number, number]> = {
  green: [46, 125, 50],
  blue: [37, 99, 235],
  red: [198, 61, 47],
  black: [25, 34, 29],
};

const COMMAND_BY_KIND: Record<ConstructionKind, "Line" | "Ray" | "Segment"> = {
  line: "Line",
  ray: "Ray",
  segment: "Segment",
};

export class GeoGebraAssistGateway implements ToolGatewayExecutor {
  private readonly results = new Map<string, Promise<GatewayEnvelope>>();
  private readonly usage = new Map<string, { calls: number; mutations: number }>();

  constructor(private readonly adapter: GeoGebraAdapter) {}

  execute(call: GatewayCall, context: GatewayContext): Promise<GatewayEnvelope> {
    const cached = this.results.get(call.callId);
    if (cached) return cached;
    const pending = this.executeOnce(call, context);
    this.results.set(call.callId, pending);
    return pending;
  }

  private async executeOnce(
    call: GatewayCall,
    context: GatewayContext,
  ): Promise<GatewayEnvelope> {
    if (!validId(call.callId) || !isGeoGebraAssistToolName(call.name)) {
      return failure(call.callId, context.revision, "unknown_tool", "Tool is not allowed.");
    }
    if (!authorityIsCurrent(context)) {
      return failure(
        call.callId,
        context.revision,
        context.signal?.aborted ? "cancelled" : "rejected_stale",
        context.signal?.aborted
          ? "Tool execution was cancelled."
          : "Tool authority is stale.",
      );
    }
    if (context.phase !== "constructing") {
      return failure(
        call.callId,
        context.revision,
        "invalid_phase",
        "GeoGebra assistance is only available while constructing.",
      );
    }

    const parsed = parseArguments(call.name, call.arguments);
    if (!parsed.ok) {
      return failure(call.callId, context.revision, "invalid_arguments", parsed.message);
    }
    const mutating = parsed.value.kind !== "inspect";
    if (!this.consumeBudget(context.turnId, mutating)) {
      return failure(
        call.callId,
        context.revision,
        "budget_exceeded",
        mutating
          ? "Only one GeoGebra change is allowed per learner turn."
          : "The GeoGebra tool budget is exhausted for this turn.",
      );
    }
    if (context.signal?.aborted) {
      return failure(call.callId, context.revision, "cancelled", "Tool execution was cancelled.");
    }

    const result = this.run(call.callId, context.revision, parsed.value);
    if (!authorityIsCurrent(context)) {
      return failure(
        call.callId,
        context.revision,
        context.signal?.aborted ? "cancelled" : "rejected_stale",
        "Tool authority expired during execution.",
      );
    }
    return result;
  }

  private run(
    callId: string,
    revision: number,
    arguments_: ParsedArguments,
  ): GatewayEnvelope {
    switch (arguments_.kind) {
      case "inspect":
        return this.inspect(callId, revision);
      case "create_point":
        return this.createPoint(callId, revision, arguments_);
      case "rename":
        return this.rename(callId, revision, arguments_.currentName, arguments_.newName);
      case "move_point":
        return this.movePoint(callId, revision, arguments_);
      case "style":
        return this.style(callId, revision, arguments_);
      case "line":
      case "ray":
      case "segment":
        return this.drawPair(callId, revision, arguments_.kind, arguments_);
      case "circle":
        return this.drawCircle(callId, revision, arguments_);
      case "polygon":
        return this.drawPolygon(callId, revision, arguments_);
    }
  }

  private consumeBudget(turnId: string, mutating: boolean): boolean {
    const current = this.usage.get(turnId) ?? { calls: 0, mutations: 0 };
    const next = {
      calls: current.calls + 1,
      mutations: current.mutations + Number(mutating),
    };
    if (next.calls > 4 || next.mutations > 1) return false;
    this.usage.set(turnId, next);
    return true;
  }

  private inspect(callId: string, revision: number): GatewayEnvelope {
    const result = this.adapter.withApi((api) => {
      const allNames = readObjectNames(api);
      return {
        objectCount: allNames.length,
        truncated: allNames.length > 40,
        objects: allNames.slice(0, 40).map((name) => readObject(api, name)),
        note:
          "This inventory describes the current board but does not prove that the exercise is correct.",
      };
    });
    return result.ok
      ? success(callId, revision, result.value)
      : failure(callId, revision, "execution_failed", "The GeoGebra workspace is not ready.");
  }

  private createPoint(
    callId: string,
    revision: number,
    arguments_: Extract<ParsedArguments, { kind: "create_point" }>,
  ): GatewayEnvelope {
    return this.mutate(callId, revision, (api) => {
      if (api.exists(arguments_.label)) {
        return mutationFailure("execution_failed", `The label ${arguments_.label} is already in use.`);
      }
      const command = `${arguments_.label} = (${formatNumber(arguments_.x)},${formatNumber(arguments_.y)})`;
      if (!api.evalCommand(command) || !isExistingPoint(api, arguments_.label)) {
        return mutationFailure("execution_failed", "GeoGebra rejected the point safely.");
      }
      applyStyle(api, arguments_.label, arguments_.color, true);
      return mutationSuccess({
        action: "created_point",
        objectName: arguments_.label,
        coordinates: [arguments_.x, arguments_.y],
        color: arguments_.color,
      });
    });
  }

  private rename(
    callId: string,
    revision: number,
    currentName: string,
    newName: string,
  ): GatewayEnvelope {
    return this.mutate(callId, revision, (api) => {
      if (!api.exists(currentName)) {
        return mutationFailure("object_missing", `The GeoGebra object ${currentName} does not exist.`);
      }
      if (api.exists(newName)) {
        return mutationFailure("execution_failed", `The label ${newName} is already in use.`);
      }
      if (!api.renameObject || !api.renameObject(currentName, newName) || !api.exists(newName)) {
        return mutationFailure("execution_failed", "GeoGebra could not rename that object safely.");
      }
      return mutationSuccess({ action: "renamed", previousName: currentName, objectName: newName });
    });
  }

  private movePoint(
    callId: string,
    revision: number,
    arguments_: Extract<ParsedArguments, { kind: "move_point" }>,
  ): GatewayEnvelope {
    return this.mutate(callId, revision, (api) => {
      if (!isExistingPoint(api, arguments_.point)) {
        return mutationFailure("object_missing", `The point ${arguments_.point} does not exist.`);
      }
      if (!api.setCoords) {
        return mutationFailure("execution_failed", "GeoGebra cannot move this point safely.");
      }
      api.setCoords(arguments_.point, arguments_.x, arguments_.y);
      return mutationSuccess({
        action: "moved_point",
        objectName: arguments_.point,
        coordinates: [arguments_.x, arguments_.y],
      });
    });
  }

  private style(
    callId: string,
    revision: number,
    arguments_: Extract<ParsedArguments, { kind: "style" }>,
  ): GatewayEnvelope {
    return this.mutate(callId, revision, (api) => {
      if (!api.exists(arguments_.objectName)) {
        return mutationFailure("object_missing", `The object ${arguments_.objectName} does not exist.`);
      }
      applyStyle(api, arguments_.objectName, arguments_.color, arguments_.labelVisible);
      return mutationSuccess({
        action: "styled",
        objectName: arguments_.objectName,
        color: arguments_.color,
        labelVisible: arguments_.labelVisible,
      });
    });
  }

  private drawPair(
    callId: string,
    revision: number,
    kind: ConstructionKind,
    arguments_: PointPairArguments,
  ): GatewayEnvelope {
    return this.mutate(callId, revision, (api) => {
      const missing = [arguments_.pointA, arguments_.pointB].filter(
        (name) => !isExistingPoint(api, name),
      );
      if (missing.length > 0) {
        return mutationFailure(
          "object_missing",
          `These points must already exist in GeoGebra: ${missing.join(", ")}.`,
        );
      }
      const objectName = nextObjectName(api, kind, [arguments_.pointA, arguments_.pointB]);
      const command = `${objectName} = ${COMMAND_BY_KIND[kind]}(${arguments_.pointA},${arguments_.pointB})`;
      if (!api.evalCommand(command) || !api.exists(objectName)) {
        return mutationFailure("execution_failed", "GeoGebra rejected the requested construction safely.");
      }
      applyStyle(api, objectName, arguments_.color, false);
      return mutationSuccess({
        action: "constructed",
        objectName,
        kind,
        points: [arguments_.pointA, arguments_.pointB],
        color: arguments_.color,
      });
    });
  }

  private drawCircle(
    callId: string,
    revision: number,
    arguments_: Extract<ParsedArguments, { kind: "circle" }>,
  ): GatewayEnvelope {
    return this.mutate(callId, revision, (api) => {
      const missing = [arguments_.center, arguments_.throughPoint].filter(
        (name) => !isExistingPoint(api, name),
      );
      if (missing.length > 0) {
        return mutationFailure("object_missing", `These points must already exist in GeoGebra: ${missing.join(", ")}.`);
      }
      const objectName = nextObjectName(api, "circle", [arguments_.center, arguments_.throughPoint]);
      if (!api.evalCommand(`${objectName} = Circle(${arguments_.center},${arguments_.throughPoint})`) || !api.exists(objectName)) {
        return mutationFailure("execution_failed", "GeoGebra rejected the circle safely.");
      }
      applyStyle(api, objectName, arguments_.color, false);
      return mutationSuccess({ action: "constructed", objectName, kind: "circle", points: [arguments_.center, arguments_.throughPoint], color: arguments_.color });
    });
  }

  private drawPolygon(
    callId: string,
    revision: number,
    arguments_: Extract<ParsedArguments, { kind: "polygon" }>,
  ): GatewayEnvelope {
    return this.mutate(callId, revision, (api) => {
      const missing = arguments_.pointLabels.filter((name) => !isExistingPoint(api, name));
      if (missing.length > 0) {
        return mutationFailure("object_missing", `These points must already exist in GeoGebra: ${missing.join(", ")}.`);
      }
      const objectName = nextObjectName(api, "polygon", arguments_.pointLabels);
      if (!api.evalCommand(`${objectName} = Polygon(${arguments_.pointLabels.join(",")})`) || !api.exists(objectName)) {
        return mutationFailure("execution_failed", "GeoGebra rejected the polygon safely.");
      }
      applyStyle(api, objectName, arguments_.color, false);
      return mutationSuccess({ action: "constructed", objectName, kind: "polygon", points: arguments_.pointLabels, color: arguments_.color });
    });
  }

  private mutate(
    callId: string,
    revision: number,
    operation: (api: GeoGebraApi) => MutationResult,
  ): GatewayEnvelope {
    const result = this.adapter.withApi(operation);
    if (!result.ok) {
      return failure(callId, revision, "execution_failed", "The GeoGebra workspace is not ready.");
    }
    return result.value.ok
      ? success(callId, revision, {
          ...result.value.data,
          note: "The requested change was applied in GeoGebra. Mission progress is checked separately from the board state.",
        })
      : failure(callId, revision, result.value.code, result.value.message);
  }
}

type MutationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: GatewayErrorCode; message: string };

export class GeoGebraAssistRuntime {
  private revision = 0;
  private disposed = false;
  private readonly gateway: GeoGebraAssistGateway;
  private readonly objectListeners = new Map<GeoGebraObjectListenerKind, GeoGebraObjectListener>();
  private readonly clientListener: GeoGebraClientListener;
  private publishTimer?: ReturnType<typeof setTimeout>;
  private lastWorldSignature?: string;
  private lastChange: GeoGebraWorldChangeV1 = { type: "initial" };
  readonly toolRuntime: ToolRuntime;

  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly options: GeoGebraAssistRuntimeOptions = {},
  ) {
    this.gateway = new GeoGebraAssistGateway(adapter);
    for (const kind of ["add", "remove", "update"] as const) {
      const listener = (target: string) => this.observe({ type: kind, target });
      this.objectListeners.set(kind, listener);
      adapter.registerObjectListener(kind, listener);
    }
    this.clientListener = (event) => this.observe(clientChange(event));
    adapter.registerClientListener(this.clientListener);
    this.toolRuntime = {
      gateway: this.gateway,
      getContext: (turnId) =>
        this.disposed
          ? undefined
          : {
              turnId,
              phase: "constructing",
              epoch: adapter.epoch,
              revision: this.revision,
              isAuthorityCurrent: () => !this.disposed && adapter.phase === "ready",
            },
    };
    this.scheduleWorldState(0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.publishTimer) clearTimeout(this.publishTimer);
    for (const [kind, listener] of this.objectListeners) {
      this.adapter.unregisterObjectListener(kind, listener);
    }
    this.adapter.unregisterClientListener(this.clientListener);
  }

  private observe(change: GeoGebraWorldChangeV1): void {
    this.revision += 1;
    this.lastChange = change;
    this.scheduleWorldState(this.options.debounceMs ?? 180);
  }

  private scheduleWorldState(delay: number): void {
    if (!this.options.onWorldState || this.disposed) return;
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      if (this.disposed) return;
      const result = this.adapter.withApi((api) =>
        readGeoGebraWorldState(
          api,
          this.options.exercise,
          this.revision,
          this.lastChange,
        ),
      );
      if (!result.ok) return;
      const signature = worldSignature(result.value);
      if (signature === this.lastWorldSignature) return;
      this.lastWorldSignature = signature;
      this.options.onWorldState?.(result.value);
    }, delay);
  }
}

function authorityIsCurrent(context: GatewayContext): boolean {
  return !context.signal?.aborted && (context.isAuthorityCurrent?.() ?? true);
}

function parseArguments(
  name: GeoGebraAssistToolName,
  source: string,
): { ok: true; value: ParsedArguments } | { ok: false; message: string } {
  if (new TextEncoder().encode(source).byteLength > 2_048) {
    return { ok: false, message: "Tool arguments are too large." };
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, message: "Tool arguments are not valid JSON." };
  }
  if (!plainObject(value)) {
    return { ok: false, message: "Tool arguments must be an object." };
  }
  if (name === "inspect_geogebra_workspace") {
    return Object.keys(value).length === 0
      ? { ok: true, value: { kind: "inspect" } }
      : { ok: false, message: "Inspect does not accept arguments." };
  }
  if (name === "create_geogebra_point" && exactKeys(value, ["color", "label", "x", "y"]) && validObjectName(value.label) && validCoordinate(value.x) && validCoordinate(value.y) && validColor(value.color)) {
    return { ok: true, value: { kind: "create_point", label: value.label, x: value.x, y: value.y, color: value.color } };
  }
  if (name === "rename_geogebra_object" && exactKeys(value, ["currentName", "newName"]) && validObjectName(value.currentName) && validObjectName(value.newName) && value.currentName !== value.newName) {
    return { ok: true, value: { kind: "rename", currentName: value.currentName, newName: value.newName } };
  }
  if (name === "move_geogebra_point" && exactKeys(value, ["point", "x", "y"]) && validObjectName(value.point) && validCoordinate(value.x) && validCoordinate(value.y)) {
    return { ok: true, value: { kind: "move_point", point: value.point, x: value.x, y: value.y } };
  }
  if (name === "style_geogebra_object" && exactKeys(value, ["color", "labelVisible", "objectName"]) && validObjectName(value.objectName) && validColor(value.color) && typeof value.labelVisible === "boolean") {
    return { ok: true, value: { kind: "style", objectName: value.objectName, color: value.color, labelVisible: value.labelVisible } };
  }
  if (["draw_geogebra_line", "draw_geogebra_ray", "draw_geogebra_segment"].includes(name) && exactKeys(value, ["color", "pointA", "pointB"]) && validObjectName(value.pointA) && validObjectName(value.pointB) && value.pointA !== value.pointB && validColor(value.color)) {
    return { ok: true, value: { kind: name.replace("draw_geogebra_", "") as ConstructionKind, pointA: value.pointA, pointB: value.pointB, color: value.color } };
  }
  if (name === "draw_geogebra_circle" && exactKeys(value, ["center", "color", "throughPoint"]) && validObjectName(value.center) && validObjectName(value.throughPoint) && value.center !== value.throughPoint && validColor(value.color)) {
    return { ok: true, value: { kind: "circle", center: value.center, throughPoint: value.throughPoint, color: value.color } };
  }
  if (name === "draw_geogebra_polygon" && exactKeys(value, ["color", "pointLabels"]) && Array.isArray(value.pointLabels) && value.pointLabels.length >= 3 && value.pointLabels.length <= 8 && value.pointLabels.every(validObjectName) && new Set(value.pointLabels).size === value.pointLabels.length && validColor(value.color)) {
    return { ok: true, value: { kind: "polygon", pointLabels: value.pointLabels, color: value.color } };
  }
  return { ok: false, message: "GeoGebra action arguments do not match the strict schema." };
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

function readObject(api: GeoGebraApi, name: string) {
  const type = api.getObjectType?.(name) ?? "unknown";
  const command = api.getCommandString(name, false).slice(0, 240);
  return {
    name,
    type,
    command,
    ...(api.getColor?.(name) ? { color: api.getColor?.(name) } : {}),
    ...(type.toLowerCase() === "point"
      ? { x: finiteOrUndefined(api.getXcoord?.(name)), y: finiteOrUndefined(api.getYcoord?.(name)) }
      : {}),
  };
}

function isExistingPoint(api: GeoGebraApi, name: string): boolean {
  return api.exists(name) && api.isDefined(name) && api.getObjectType?.(name)?.toLowerCase() === "point";
}

function applyStyle(api: GeoGebraApi, name: string, color: AssistColor, labelVisible: boolean): void {
  api.setColor?.(name, ...COLOR_RGB[color]);
  api.setLabelVisible(name, labelVisible);
}

function nextObjectName(
  api: GeoGebraApi,
  kind: ConstructionKind | "circle" | "polygon",
  points: string[],
): string {
  const prefix = `compass${kind[0].toUpperCase()}${kind.slice(1)}${points.join("")}`.slice(0, 48);
  if (!api.exists(prefix)) return prefix;
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${prefix}${suffix}`;
    if (!api.exists(candidate)) return candidate;
  }
  throw new Error("No safe GeoGebra object label is available.");
}

function clientChange(event: GeoGebraClientEvent): GeoGebraWorldChangeV1 {
  return {
    type: "client",
    ...(typeof event.target === "string" ? { target: event.target } : {}),
  };
}

function worldSignature(state: GeoGebraWorldStateV1): string {
  return JSON.stringify({
    objectCount: state.objectCount,
    truncated: state.truncated,
    objects: state.objects,
    verifiedTaskIndexes: state.verifiedTaskIndexes,
  });
}

function mutationSuccess(data: Record<string, unknown>): MutationResult {
  return { ok: true, data };
}

function mutationFailure(code: GatewayErrorCode, message: string): MutationResult {
  return { ok: false, code, message };
}

function success(callId: string, revision: number, data: unknown): GatewayEnvelope {
  return { ok: true, callId, revision, data, evidenceIds: [] };
}

function failure(callId: string, revision: number, code: GatewayErrorCode, message: string): GatewayEnvelope {
  return { ok: false, callId, revision, error: { code, message }, evidenceIds: [] };
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validObjectName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(value);
}

function validCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -10_000 && value <= 10_000;
}

function validColor(value: unknown): value is AssistColor {
  return value === "green" || value === "blue" || value === "red" || value === "black";
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteOrUndefined(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

import type { GeoGebraApi } from "@/types/geogebra";

import type {
  GeometryActionArgumentsC04,
} from "./actions";
import { GeometryActionError } from "./action-error";
import type { GeometryPointV1 } from "./numeric";
import type { GeometryVisualGuidanceCueV1 } from "./visual-guidance";

export const GEOGEBRA_TOOL_MODE_IDS_V1 = Object.freeze({
  move: 0,
  point: 1,
  line: 2,
  parallel: 3,
  perpendicular: 4,
  relation: 14,
  segment: 15,
  polygon: 16,
  ray: 18,
  midpoint: 19,
} satisfies Record<GeometryToolV1, number>);

export type GeometryToolV1 =
  GeometryActionArgumentsC04["activate_geometry_tool"]["tool"];
export type GeometryHighlightStyleV1 =
  GeometryActionArgumentsC04["highlight_geometry_objects"]["style"];

export type GeometryLogicalBoxV1 = Readonly<{
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}>;

type Timers = Readonly<{
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}>;

type HighlightOriginal = Readonly<{
  name: string;
  color: readonly [number, number, number];
  thickness: number;
  visible: boolean;
}>;

type HighlightGroup = Readonly<{
  id: number;
  originals: readonly HighlightOriginal[];
  timer: ReturnType<typeof setTimeout>;
}>;

const HIGHLIGHT_STYLES = Object.freeze({
  focus: { color: [37, 99, 235], minimumThickness: 7 },
  hint: { color: [245, 158, 11], minimumThickness: 7 },
  relation: { color: [16, 185, 129], minimumThickness: 8 },
} satisfies Record<
  GeometryHighlightStyleV1,
  { color: [number, number, number]; minimumThickness: number }
>);

const TOOL_LABELS = Object.freeze({
  fr: {
    move: "Déplacer",
    point: "Point",
    midpoint: "Milieu ou centre",
    segment: "Segment",
    line: "Droite",
    ray: "Demi-droite",
    polygon: "Polygone",
    parallel: "Parallèle",
    perpendicular: "Perpendiculaire",
    relation: "Relation",
  },
  en: {
    move: "Move",
    point: "Point",
    midpoint: "Midpoint or center",
    segment: "Segment",
    line: "Line",
    ray: "Ray",
    polygon: "Polygon",
    parallel: "Parallel line",
    perpendicular: "Perpendicular line",
    relation: "Relation",
  },
} satisfies Record<"fr" | "en", Record<GeometryToolV1, string>>);

const CLICK_ORDERS = Object.freeze({
  fr: {
    move: "Fais glisser un objet libre.",
    point: "Clique dans la vue pour placer un point.",
    midpoint: "Clique sur les deux extrémités du segment.",
    segment: "Clique sur le premier point, puis sur le second.",
    line: "Clique sur le premier point, puis sur le second.",
    ray: "Clique sur l'origine, puis sur un point de direction.",
    polygon: "Clique les sommets dans l'ordre, puis reclique le premier.",
    parallel: "Clique la droite de référence, puis le point de passage.",
    perpendicular: "Clique la droite de référence, puis le point de passage.",
    relation: "Clique les deux objets à comparer.",
  },
  en: {
    move: "Drag a free object.",
    point: "Click in the view to place a point.",
    midpoint: "Click the two endpoints of the segment.",
    segment: "Click the first point, then the second.",
    line: "Click the first point, then the second.",
    ray: "Click the origin, then a point in the direction.",
    polygon: "Click the vertices in order, then click the first one again.",
    parallel: "Click the reference line, then the point it must pass through.",
    perpendicular: "Click the reference line, then the point it must pass through.",
    relation: "Click the two objects to compare.",
  },
} satisfies Record<"fr" | "en", Record<GeometryToolV1, string>>);

export class GeometryUiEffectsV1 {
  private initialMode?: number;
  private initialViewport?: GeometryLogicalBoxV1;
  private readonly activeHighlightByName = new Map<string, HighlightGroup>();
  private groupSequence = 0;
  private guidanceSequence = 0;

  constructor(
    private readonly api: GeoGebraApi,
    private readonly dependencies: Readonly<{
      locale?: "fr" | "en";
      timers?: Timers;
      freezeMutations?: (reason: string) => void;
      onGuidanceCue?: (cue?: GeometryVisualGuidanceCueV1) => void;
      prepareToolTarget?: (mode: number) => void;
    }> = {},
  ) {}

  activateTool(tool: GeometryToolV1) {
    if (!this.api.setMode || !this.api.getMode) {
      throw new GeometryActionError(
        "workspace_unavailable",
        "GeoGebra tool mode methods are unavailable.",
      );
    }
    const previousMode = this.api.getMode();
    if (!Number.isInteger(previousMode)) {
      throw new GeometryActionError(
        "workspace_unavailable",
        "GeoGebra returned an invalid tool mode.",
      );
    }
    const before = objectNames(this.api);
    try {
      this.dependencies.prepareToolTarget?.(GEOGEBRA_TOOL_MODE_IDS_V1[tool]);
      this.api.setOnTheFlyPointCreationActive?.(false);
      this.api.setMode(GEOGEBRA_TOOL_MODE_IDS_V1[tool]);
    } finally {
      this.api.setOnTheFlyPointCreationActive?.(true);
    }
    const after = objectNames(this.api);
    if (!sameNames(before, after)) {
      this.api.setMode(previousMode);
      throw new GeometryActionError(
        "rejected_stale",
        "The construction changed while the tool was activated.",
      );
    }
    this.initialMode ??= previousMode;
    const locale = this.dependencies.locale ?? "fr";
    const result = {
      tool,
      mode: GEOGEBRA_TOOL_MODE_IDS_V1[tool],
      label: TOOL_LABELS[locale][tool],
      clickOrder: CLICK_ORDERS[locale][tool],
      createdObjects: 0,
      reversible: true,
    };
    this.emitGuidance({
      id: ++this.guidanceSequence,
      kind: "toolbar",
      action: "activate_geometry_tool",
      tool,
      mode: result.mode,
      label: result.label,
      clickOrder: result.clickOrder,
      durationMs: 10_000,
    });
    return result;
  }

  highlight(
    names: readonly string[],
    style: GeometryHighlightStyleV1,
    durationMs: number,
  ) {
    if (names.some((name) => this.activeHighlightByName.has(name))) {
      throw new GeometryActionError(
        "highlight_active",
        "One of the requested objects is already highlighted.",
      );
    }
    const originals = names.map((name) => this.readHighlightOriginal(name));
    const applied: HighlightOriginal[] = [];
    try {
      for (const original of originals) {
        this.applyHighlightStyle(original, style);
        applied.push(original);
      }
    } catch (error) {
      const restored = this.restoreHighlights(applied.toReversed());
      if (!restored) this.freeze("Highlight rollback could not be verified.");
      throw error;
    }
    const id = ++this.groupSequence;
    const timers = this.timers();
    const timer = timers.setTimeout(() => {
      const restored = this.restoreHighlightGroup(id);
      if (!restored) this.freeze("Timed highlight cleanup could not be verified.");
    }, durationMs);
    const group = { id, originals, timer } satisfies HighlightGroup;
    for (const name of names) this.activeHighlightByName.set(name, group);
    const result = {
      names: [...names],
      style,
      durationMs,
      expiresInMs: durationMs,
      reversible: true,
    };
    this.emitGuidance({
      id: ++this.guidanceSequence,
      kind: "objects",
      action: "highlight_geometry_objects",
      names: result.names,
      style,
      durationMs,
    });
    return result;
  }

  showVariationMovement(
    movingPoint: "A" | "B" | "C" | "D",
    target: "convex" | "concave" | "crossed",
    from: GeometryPointV1,
    to: GeometryPointV1,
    applied: boolean,
  ) {
    const durationMs = applied ? 6_000 : 8_000;
    this.emitGuidance({
      id: ++this.guidanceSequence,
      kind: "movement",
      action: applied
        ? "create_geometry_variation"
        : "preview_geometry_variation",
      movingPoint,
      target,
      from,
      to,
      applied,
      durationMs,
    });
    return {
      status: applied ? "applied" : "previewed",
      movingPoint,
      target,
      durationMs,
      coordinatesExposed: false,
      geometryChanged: applied,
      evidenceCreated: false,
    } as const;
  }

  focus(box: GeometryLogicalBoxV1, margin: number) {
    if (!this.api.getViewProperties) {
      throw new GeometryActionError(
        "workspace_unavailable",
        "GeoGebra viewport inspection is unavailable.",
      );
    }
    const previous = parseViewport(this.api.getViewProperties(1));
    if (!previous) {
      throw new GeometryActionError(
        "workspace_unavailable",
        "GeoGebra returned invalid viewport properties.",
      );
    }
    const width = box.xMax - box.xMin;
    const height = box.yMax - box.yMin;
    if (!(width > 0) || !(height > 0)) {
      throw new GeometryActionError("invalid_arguments", "Focus box is empty.");
    }
    const applied = {
      xMin: box.xMin - width * margin,
      xMax: box.xMax + width * margin,
      yMin: box.yMin - height * margin,
      yMax: box.yMax + height * margin,
    };
    this.api.setCoordSystem(
      applied.xMin,
      applied.xMax,
      applied.yMin,
      applied.yMax,
    );
    this.initialViewport ??= previous;
    const result = { viewport: applied, margin, reversible: true };
    this.emitGuidance({
      id: ++this.guidanceSequence,
      kind: "viewport",
      action: "focus_geometry_view",
      box: applied,
      durationMs: 4_000,
    });
    return result;
  }

  cleanup(): { ok: boolean; restored: string[] } {
    const restored: string[] = [];
    const highlightGroups = new Set(
      [...this.activeHighlightByName.values()].map(({ id }) => id),
    );
    let ok = true;
    for (const id of highlightGroups) {
      const group = [...this.activeHighlightByName.values()].find(
        (candidate) => candidate.id === id,
      );
      if (!group) continue;
      this.timers().clearTimeout(group.timer);
      const groupOk = this.restoreHighlightGroup(id);
      ok &&= groupOk;
      if (groupOk) restored.push(...group.originals.map(({ name }) => name));
    }
    if (this.initialViewport) {
      const viewport = this.initialViewport;
      try {
        this.api.setCoordSystem(
          viewport.xMin,
          viewport.xMax,
          viewport.yMin,
          viewport.yMax,
        );
        restored.push("viewport");
        this.initialViewport = undefined;
      } catch {
        ok = false;
      }
    }
    if (this.initialMode !== undefined) {
      try {
        this.api.setMode?.(GEOGEBRA_TOOL_MODE_IDS_V1.move);
        restored.push("tool_mode");
        this.initialMode = undefined;
      } catch {
        ok = false;
      }
    }
    if (!ok) this.freeze("UI effect cleanup could not be verified.");
    this.emitGuidance(undefined);
    return { ok, restored: [...new Set(restored)].sort() };
  }

  private readHighlightOriginal(name: string): HighlightOriginal {
    if (
      !this.api.exists(name) ||
      !this.api.isDefined(name) ||
      !this.api.getColor ||
      !this.api.setColor ||
      !this.api.getLineThickness ||
      !this.api.setLineThickness ||
      !this.api.getVisible ||
      !this.api.setVisible
    ) {
      throw new GeometryActionError(
        this.api.exists(name) ? "workspace_unavailable" : "object_missing",
        this.api.exists(name)
          ? "GeoGebra style methods are unavailable."
          : "A requested object does not exist.",
      );
    }
    const color = parseColor(this.api.getColor(name));
    const thickness = this.api.getLineThickness(name);
    const visible = this.api.getVisible(name);
    if (!color || !Number.isInteger(thickness) || thickness < 1) {
      throw new GeometryActionError(
        "workspace_unavailable",
        "GeoGebra returned invalid style properties.",
      );
    }
    return { name, color, thickness, visible };
  }

  private applyHighlightStyle(
    original: HighlightOriginal,
    style: GeometryHighlightStyleV1,
  ): void {
    const target = HIGHLIGHT_STYLES[style];
    this.api.setVisible!(original.name, true);
    this.api.setColor!(original.name, ...target.color);
    this.api.setLineThickness!(
      original.name,
      Math.min(13, Math.max(target.minimumThickness, original.thickness + 3)),
    );
  }

  private restoreHighlightGroup(id: number): boolean {
    const group = [...this.activeHighlightByName.values()].find(
      (candidate) => candidate.id === id,
    );
    if (!group) return true;
    const restored = this.restoreHighlights(group.originals.toReversed());
    if (restored) {
      for (const { name } of group.originals) this.activeHighlightByName.delete(name);
    }
    return restored;
  }

  private restoreHighlights(originals: readonly HighlightOriginal[]): boolean {
    let restored = true;
    for (const original of originals) {
      try {
        this.api.setColor?.(original.name, ...original.color);
        this.api.setLineThickness?.(original.name, original.thickness);
        this.api.setVisible?.(original.name, original.visible);
        const actualColor = this.api.getColor?.(original.name);
        const actualThickness = this.api.getLineThickness?.(original.name);
        const actualVisible = this.api.getVisible?.(original.name);
        restored &&=
          sameColor(parseColor(actualColor), original.color) &&
          actualThickness === original.thickness &&
          actualVisible === original.visible;
      } catch {
        restored = false;
      }
    }
    return restored;
  }

  private timers(): Timers {
    return (
      this.dependencies.timers ?? {
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (timer) => globalThis.clearTimeout(timer),
      }
    );
  }

  private freeze(reason: string): void {
    this.dependencies.freezeMutations?.(reason);
  }

  private emitGuidance(cue?: GeometryVisualGuidanceCueV1): void {
    try {
      this.dependencies.onGuidanceCue?.(cue);
    } catch {
      // Presentation must never change the outcome of an authorized action.
    }
  }
}

function objectNames(api: GeoGebraApi): string[] {
  return [...(api.getAllObjectNames?.() ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((name, index) => name === right[index])
  );
}

function parseColor(value: string | undefined): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value ?? "");
  return match
    ? [
        Number.parseInt(match[1], 16),
        Number.parseInt(match[2], 16),
        Number.parseInt(match[3], 16),
      ]
    : undefined;
}

function sameColor(
  left: readonly number[] | undefined,
  right: readonly number[],
): boolean {
  return Boolean(left?.every((value, index) => value === right[index]));
}

function parseViewport(
  source: string | Record<string, unknown>,
): GeometryLogicalBoxV1 | undefined {
  let value: Record<string, unknown>;
  try {
    value = typeof source === "string" ? JSON.parse(source) : source;
  } catch {
    return undefined;
  }
  const xMin = finite(value.xMin);
  const yMin = finite(value.yMin);
  const directXMax = finite(value.xMax);
  const directYMax = finite(value.yMax);
  const xMax =
    directXMax ??
    (xMin !== undefined
      ? addScaled(xMin, finite(value.width), finite(value.invXscale))
      : undefined);
  const yMax =
    directYMax ??
    (yMin !== undefined
      ? addScaled(yMin, finite(value.height), finite(value.invYscale))
      : undefined);
  return xMin !== undefined && xMax !== undefined && xMin < xMax &&
    yMin !== undefined && yMax !== undefined && yMin < yMax
    ? { xMin, xMax, yMin, yMax }
    : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function addScaled(
  origin: number,
  pixels: number | undefined,
  inverseScale: number | undefined,
): number | undefined {
  return pixels !== undefined && inverseScale !== undefined
    ? origin + pixels * inverseScale
    : undefined;
}

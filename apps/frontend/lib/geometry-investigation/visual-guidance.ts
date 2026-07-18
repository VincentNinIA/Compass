import type { GeometryAuthorityLevel } from "./authority";
import { GEOMETRY_ACTION_AUTHORITY_LEVEL } from "./authority";
import {
  GEOMETRY_ACTIONS_V1,
  type GeometryWorldObjectV2,
  type GeometryWorldV2,
} from "./contracts";
import type { GeometryInvestigationActionV1 } from "./actions";
import type {
  GeometryHighlightStyleV1,
  GeometryLogicalBoxV1,
  GeometryToolV1,
} from "./ui-effects";

export type GeometryHarnessSurfaceV1 =
  | "coach"
  | "toolbar"
  | "canvas"
  | "gallery"
  | "activity";

export type GeometryHarnessPresentationV1 =
  | "none"
  | "toolbar_target"
  | "object_target"
  | "viewport_target"
  | "activity_state"
  | "world_change"
  | "fact_status"
  | "evidence_card"
  | "restore_barrier"
  | "demonstration_sequence";

export type GeometryHarnessConsentV1 =
  | "none"
  | "system_only"
  | "learner_evidence"
  | "one_shot"
  | "visible_confirmation";

export type GeometryHarnessCapabilityV1 = Readonly<{
  action: GeometryInvestigationActionV1;
  level: GeometryAuthorityLevel;
  surface: GeometryHarnessSurfaceV1;
  presentation: GeometryHarnessPresentationV1;
  mutatesGeometry: boolean;
  consent: GeometryHarnessConsentV1;
  reversible: boolean;
}>;

const CAPABILITY_DETAILS = Object.freeze({
  inspect_geometry_workspace: {
    surface: "canvas",
    presentation: "none",
    mutatesGeometry: false,
    consent: "none",
    reversible: true,
  },
  activate_geometry_tool: {
    surface: "toolbar",
    presentation: "toolbar_target",
    mutatesGeometry: false,
    consent: "none",
    reversible: true,
  },
  highlight_geometry_objects: {
    surface: "canvas",
    presentation: "object_target",
    mutatesGeometry: false,
    consent: "none",
    reversible: true,
  },
  initialize_geometry_activity: {
    surface: "activity",
    presentation: "activity_state",
    mutatesGeometry: true,
    consent: "system_only",
    reversible: true,
  },
  create_geometry_variation: {
    surface: "canvas",
    presentation: "world_change",
    mutatesGeometry: true,
    consent: "one_shot",
    reversible: true,
  },
  classify_geometry_configuration: {
    surface: "activity",
    presentation: "fact_status",
    mutatesGeometry: false,
    consent: "none",
    reversible: true,
  },
  check_geometry_relation: {
    surface: "activity",
    presentation: "fact_status",
    mutatesGeometry: false,
    consent: "none",
    reversible: true,
  },
  capture_geometry_evidence: {
    surface: "gallery",
    presentation: "evidence_card",
    mutatesGeometry: false,
    consent: "learner_evidence",
    reversible: true,
  },
  restore_geometry_checkpoint: {
    surface: "canvas",
    presentation: "restore_barrier",
    mutatesGeometry: true,
    consent: "visible_confirmation",
    reversible: true,
  },
  demonstrate_geometry_step: {
    surface: "canvas",
    presentation: "demonstration_sequence",
    mutatesGeometry: true,
    consent: "visible_confirmation",
    reversible: true,
  },
  focus_geometry_view: {
    surface: "canvas",
    presentation: "viewport_target",
    mutatesGeometry: false,
    consent: "none",
    reversible: true,
  },
} satisfies Record<
  GeometryInvestigationActionV1,
  Omit<GeometryHarnessCapabilityV1, "action" | "level">
>);

export const GEOMETRY_HARNESS_CAPABILITIES_V1 = Object.freeze(
  GEOMETRY_ACTIONS_V1.map((action) =>
    Object.freeze({
      action,
      level: GEOMETRY_ACTION_AUTHORITY_LEVEL[action],
      ...CAPABILITY_DETAILS[action],
    }),
  ),
) satisfies readonly GeometryHarnessCapabilityV1[];

type GuidanceBase = Readonly<{
  id: number;
  durationMs: number;
}>;

export type GeometryToolbarGuidanceCueV1 = GuidanceBase &
  Readonly<{
    kind: "toolbar";
    action: "activate_geometry_tool";
    tool: GeometryToolV1;
    mode: number;
    label: string;
    clickOrder: string;
  }>;

export type GeometryObjectsGuidanceCueV1 = GuidanceBase &
  Readonly<{
    kind: "objects";
    action: "highlight_geometry_objects";
    names: readonly string[];
    style: GeometryHighlightStyleV1;
  }>;

export type GeometryViewportGuidanceCueV1 = GuidanceBase &
  Readonly<{
    kind: "viewport";
    action: "focus_geometry_view";
    box: GeometryLogicalBoxV1;
  }>;

export type GeometryVisualGuidanceCueV1 =
  | GeometryToolbarGuidanceCueV1
  | GeometryObjectsGuidanceCueV1
  | GeometryViewportGuidanceCueV1;

export type GeometryViewPropertiesV1 = Readonly<{
  xMin: number;
  yMin: number;
  invXscale: number;
  invYscale: number;
  width: number;
  height: number;
}>;

export type GeometryScreenPointV1 = Readonly<{ x: number; y: number }>;

export type GeometryScreenBoxV1 = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export function parseGeometryViewPropertiesV1(
  source: string | Record<string, unknown> | undefined,
): GeometryViewPropertiesV1 | undefined {
  if (!source) return undefined;
  let value: Record<string, unknown>;
  try {
    value = typeof source === "string" ? JSON.parse(source) : source;
  } catch {
    return undefined;
  }
  const xMin = finite(value.xMin);
  const yMin = finite(value.yMin);
  const invXscale = finite(value.invXscale);
  const invYscale = finite(value.invYscale);
  const width = finite(value.width);
  const height = finite(value.height);
  if (
    xMin === undefined ||
    yMin === undefined ||
    invXscale === undefined ||
    invYscale === undefined ||
    width === undefined ||
    height === undefined ||
    invXscale <= 0 ||
    invYscale <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { xMin, yMin, invXscale, invYscale, width, height };
}

export function geometryAnchorForNamesV1(
  world: GeometryWorldV2,
  names: readonly string[],
): GeometryScreenPointV1 | undefined {
  const objects = new Map(world.objects.map((object) => [object.name, object]));
  const anchors = names.flatMap((name) => {
    const anchor = geometryAnchorForObject(objects.get(name), objects);
    return anchor ? [anchor] : [];
  });
  return averagePoints(anchors);
}

export function projectGeometryPointV1(
  point: GeometryScreenPointV1,
  view: GeometryViewPropertiesV1,
): GeometryScreenPointV1 {
  return {
    x: (point.x - view.xMin) / view.invXscale,
    y: view.height - (point.y - view.yMin) / view.invYscale,
  };
}

export function projectGeometryBoxV1(
  box: GeometryLogicalBoxV1,
  view: GeometryViewPropertiesV1,
): GeometryScreenBoxV1 {
  const topLeft = projectGeometryPointV1(
    { x: box.xMin, y: box.yMax },
    view,
  );
  const bottomRight = projectGeometryPointV1(
    { x: box.xMax, y: box.yMin },
    view,
  );
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: Math.max(0, bottomRight.x - topLeft.x),
    height: Math.max(0, bottomRight.y - topLeft.y),
  };
}

export function findGeoGebraToolButtonV1(
  root: ParentNode,
  mode: number,
): HTMLButtonElement | undefined {
  return (
    root.querySelector<HTMLButtonElement>(
      `button.toolButton[mode="${String(mode)}"]`,
    ) ?? undefined
  );
}

export function findGeoGebraMoreButtonV1(
  root: ParentNode,
): HTMLButtonElement | undefined {
  const candidates = [
    ...root.querySelectorAll<HTMLButtonElement>("button.materialTextButton"),
  ].filter((button) => isRendered(button));
  return candidates.find((button) => {
    const label = button.textContent?.trim().toLocaleLowerCase() ?? "";
    return label === "more" || label === "plus";
  }) ?? (candidates.length === 1 ? candidates[0] : undefined);
}

function geometryAnchorForObject(
  object: GeometryWorldObjectV2 | undefined,
  objects: ReadonlyMap<string, GeometryWorldObjectV2>,
): GeometryScreenPointV1 | undefined {
  if (!object) return undefined;
  if (Number.isFinite(object.x) && Number.isFinite(object.y)) {
    return { x: object.x as number, y: object.y as number };
  }
  return averagePoints(
    object.parents.flatMap((name) => {
      const parent = objects.get(name);
      return parent && Number.isFinite(parent.x) && Number.isFinite(parent.y)
        ? [{ x: parent.x as number, y: parent.y as number }]
        : [];
    }),
  );
}

function averagePoints(
  points: readonly GeometryScreenPointV1[],
): GeometryScreenPointV1 | undefined {
  if (points.length === 0) return undefined;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRendered(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

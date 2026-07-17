import type { GeometryConfigurationV1 } from "./contracts";
import {
  geometryScale,
  hasDistinctPoints,
  isFiniteGeometryPoint,
  orientationCross,
  orientationTolerance,
  type GeometryPointV1,
} from "./numeric";

export const ORDERED_QUADRILATERAL_TOLERANCE_VERSION =
  "ordered-quadrilateral-v1" as const;

export type OrderedQuadrilateralClassificationV1 = Readonly<{
  type: GeometryConfigurationV1["type"];
  orientation: GeometryConfigurationV1["orientation"];
  intersections: GeometryConfigurationV1["intersections"];
  tolerance: number;
  toleranceVersion: typeof ORDERED_QUADRILATERAL_TOLERANCE_VERSION;
}>;

export function classifyOrderedQuadrilateralV1(
  points: readonly GeometryPointV1[],
): OrderedQuadrilateralClassificationV1 {
  const scale = geometryScale(points);
  if (
    points.length !== 4 ||
    scale === undefined ||
    points.some((point) => !isFiniteGeometryPoint(point))
  ) {
    return degenerate(0);
  }
  const tolerance = orientationTolerance(scale);
  if (!hasDistinctPoints(points, scale)) return degenerate(tolerance);

  const turns = points.map((point, index) =>
    orientationCross(
      point,
      points[(index + 1) % points.length],
      points[(index + 2) % points.length],
    ),
  );
  if (turns.some((turn) => Math.abs(turn) <= tolerance)) {
    return degenerate(tolerance);
  }

  const intersections: GeometryConfigurationV1["intersections"] = [];
  if (strictlyIntersects(points[0], points[1], points[2], points[3], tolerance)) {
    intersections.push("AB_CD");
  }
  if (strictlyIntersects(points[1], points[2], points[3], points[0], tolerance)) {
    intersections.push("BC_DA");
  }
  if (intersections.length > 0) {
    return {
      type: "crossed",
      orientation: "none",
      intersections,
      tolerance,
      toleranceVersion: ORDERED_QUADRILATERAL_TOLERANCE_VERSION,
    };
  }

  const signedAreaTwice = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - point.y * next.x;
  }, 0);
  if (Math.abs(signedAreaTwice) <= tolerance) return degenerate(tolerance);
  const orientation =
    signedAreaTwice > 0 ? "counterclockwise" : "clockwise";
  const firstSign = Math.sign(turns[0]);
  const type = turns.every((turn) => Math.sign(turn) === firstSign)
    ? "convex"
    : "concave";
  return {
    type,
    orientation,
    intersections,
    tolerance,
    toleranceVersion: ORDERED_QUADRILATERAL_TOLERANCE_VERSION,
  };
}
function strictlyIntersects(
  firstStart: GeometryPointV1,
  firstEnd: GeometryPointV1,
  secondStart: GeometryPointV1,
  secondEnd: GeometryPointV1,
  tolerance: number,
): boolean {
  const firstSideStart = orientationCross(firstStart, firstEnd, secondStart);
  const firstSideEnd = orientationCross(firstStart, firstEnd, secondEnd);
  const secondSideStart = orientationCross(secondStart, secondEnd, firstStart);
  const secondSideEnd = orientationCross(secondStart, secondEnd, firstEnd);
  if (
    [firstSideStart, firstSideEnd, secondSideStart, secondSideEnd].some(
      (value) => Math.abs(value) <= tolerance,
    )
  ) {
    return false;
  }
  return (
    Math.sign(firstSideStart) !== Math.sign(firstSideEnd) &&
    Math.sign(secondSideStart) !== Math.sign(secondSideEnd)
  );
}

function degenerate(tolerance: number): OrderedQuadrilateralClassificationV1 {
  return {
    type: "degenerate",
    orientation: "none",
    intersections: [],
    tolerance,
    toleranceVersion: ORDERED_QUADRILATERAL_TOLERANCE_VERSION,
  };
}

export type GeometryPointV1 = Readonly<{ x: number; y: number }>;
export type GeometryVectorV1 = Readonly<{ x: number; y: number }>;

export const GEOMETRY_NUMERIC_TOLERANCES_V1 = Object.freeze({
  coordinateFactor: 1e-6,
  normalizedCross: 1e-7,
  normalizedDot: 1e-7,
  normalizedPointOn: 1e-7,
  orientationFactor: 1e-9,
  distinctFactor: 1e-8,
});

export function isFiniteGeometryPoint(
  point: GeometryPointV1 | undefined,
): point is GeometryPointV1 {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}
export function geometryVector(
  from: GeometryPointV1,
  to: GeometryPointV1,
): GeometryVectorV1 {
  return { x: to.x - from.x, y: to.y - from.y };
}

export function vectorLength(vector: GeometryVectorV1): number {
  return Math.hypot(vector.x, vector.y);
}

export function pointDistance(
  left: GeometryPointV1,
  right: GeometryPointV1,
): number {
  return vectorLength(geometryVector(left, right));
}

export function vectorCross(
  left: GeometryVectorV1,
  right: GeometryVectorV1,
): number {
  return left.x * right.y - left.y * right.x;
}

export function vectorDot(
  left: GeometryVectorV1,
  right: GeometryVectorV1,
): number {
  return left.x * right.x + left.y * right.y;
}

export function orientationCross(
  first: GeometryPointV1,
  second: GeometryPointV1,
  third: GeometryPointV1,
): number {
  return vectorCross(geometryVector(first, second), geometryVector(second, third));
}

export function geometryScale(
  points: readonly GeometryPointV1[],
): number | undefined {
  if (points.length === 0 || points.some((point) => !isFiniteGeometryPoint(point))) {
    return undefined;
  }
  let scale = 1;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      scale = Math.max(scale, pointDistance(points[left], points[right]));
    }
  }
  return Number.isFinite(scale) ? scale : undefined;
}

export function coordinateTolerance(scale: number): number {
  return GEOMETRY_NUMERIC_TOLERANCES_V1.coordinateFactor * scale;
}

export function orientationTolerance(scale: number): number {
  return GEOMETRY_NUMERIC_TOLERANCES_V1.orientationFactor * scale * scale;
}

export function distinctTolerance(scale: number): number {
  return GEOMETRY_NUMERIC_TOLERANCES_V1.distinctFactor * scale;
}

export function hasDistinctPoints(
  points: readonly GeometryPointV1[],
  scale: number,
): boolean {
  const tolerance = distinctTolerance(scale);
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      if (pointDistance(points[left], points[right]) <= tolerance) return false;
    }
  }
  return true;
}

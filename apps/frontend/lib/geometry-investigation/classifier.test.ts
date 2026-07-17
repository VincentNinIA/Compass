import { describe, expect, it } from "vitest";

import { classifyOrderedQuadrilateralV1 } from "./classifier";
import type { GeometryPointV1 } from "./numeric";

const CASES = [
  {
    expected: "convex",
    points: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 3 },
    ],
  },
  {
    expected: "concave",
    points: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 3 },
    ],
  },
  {
    expected: "crossed",
    points: [
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
      { x: 3, y: 0 },
    ],
  },
] as const;

describe("classifyOrderedQuadrilateralV1", () => {
  for (const { expected, points } of CASES) {
    it.each([0.1, 1, 1_000])(
      `classifies ${expected} deterministically at scale %s`,
      (scale) => {
        const transformed = points.map(({ x, y }) => ({
          x: 100_000 + x * scale,
          y: -100_000 + y * scale,
        }));
        expect(classifyOrderedQuadrilateralV1(transformed).type).toBe(expected);
      },
    );
  }

  it.each([
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ],
    },
    {
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ],
    },
    {
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: Number.NaN },
        { x: 0, y: 2 },
      ],
    },
  ] satisfies Array<{ points: GeometryPointV1[] }>)(
    "fails closed as degenerate for collinear, coincident or non-finite points",
    ({ points }) => {
      expect(classifyOrderedQuadrilateralV1(points)).toMatchObject({
        type: "degenerate",
        orientation: "none",
        intersections: [],
        toleranceVersion: "ordered-quadrilateral-v1",
      });
    },
  );

  it("records the exact opposite-side intersection for a crossed order", () => {
    expect(classifyOrderedQuadrilateralV1(CASES[2].points)).toMatchObject({
      type: "crossed",
      intersections: ["AB_CD"],
    });
  });
});

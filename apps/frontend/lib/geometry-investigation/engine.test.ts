import { describe, expect, it } from "vitest";

import {
  GeometryWorldV2,
  type GeometryRelationDefinitionV1,
  type GeometryWorldObjectV2,
  type GeometryWorldV2 as GeometryWorldV2Type,
} from "./contracts";
import {
  evaluateGeometryRelationV1,
  evaluateGeometryWorldV2,
  GEOMETRY_TOLERANCE_VERSION_BY_RELATION_V1,
} from "./engine";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

describe("evaluateGeometryWorldV2", () => {
  it("produces current deterministic Varignon facts and the convex classification", () => {
    const result = evaluateGeometryWorldV2(
      VARIGNON_ACTIVITY_FR_V1,
      varignonWorld(),
    );

    expect(result.facts).toHaveLength(10);
    expect(result.facts.filter(({ pass }) => pass)).toHaveLength(8);
    expect(result.configuration).toMatchObject({
      type: "convex",
      epoch: 2,
      revision: 5,
      snapshotHash: "fnv1a32:varignon",
    });
    expect(
      ["rel_midpoint_e", "rel_midpoint_f", "rel_midpoint_g", "rel_midpoint_h"].map(
        (id) => result.facts.find((fact) => fact.id === id)?.pass,
      ),
    ).toEqual([true, true, true, true]);
    expect(result.facts.find(({ id }) => id === "rel_parallel_ef_gh")?.pass).toBe(
      true,
    );
    expect(result.facts.find(({ id }) => id === "rel_parallel_fg_he")?.pass).toBe(
      true,
    );
    expect(
      result.facts.find(({ id }) => id === "rel_parallelogram_efgh")?.observed,
    ).toEqual([0, 0]);
    expect(
      result.evaluations.find(
        ({ definitionId }) => definitionId === "rel_parallelogram_efgh",
      )?.componentFactIds,
    ).toEqual(["rel_parallel_ef_gh", "rel_parallel_fg_he"]);
    expect(result.world.facts).toEqual(result.facts);
  });

  it("does not turn an activity/world mismatch into current evidence", () => {
    const world = GeometryWorldV2.parse({
      ...varignonWorld(),
      activityId: "another_activity",
    });
    const result = evaluateGeometryWorldV2(VARIGNON_ACTIVITY_FR_V1, world);

    expect(result.facts).toEqual([]);
    expect(result.evaluations).toHaveLength(10);
    expect(result.evaluations.every(({ status }) => status === "unknown")).toBe(
      true,
    );
    expect(result.evaluations[0].reason).toBe("activity_mismatch");
  });

  it("does not let passing parallel components turn a degenerate shape into a parallelogram", () => {
    const world = varignonWorld({
      G: point("G", -2.5, -2, "G=Midpoint(C,D)", ["C", "D"], "known"),
      H: point("H", 1.5, -2, "H=Midpoint(D,A)", ["D", "A"], "known"),
    });
    const result = evaluateGeometryWorldV2(VARIGNON_ACTIVITY_FR_V1, world);
    const parallelogram = result.evaluations.find(
      ({ definitionId }) => definitionId === "rel_parallelogram_efgh",
    );

    expect(parallelogram).toMatchObject({
      status: "unknown",
      reason: "degenerate_configuration",
      componentFactIds: ["rel_parallel_ef_gh", "rel_parallel_fg_he"],
    });
    expect(parallelogram?.fact).toBeUndefined();
  });
});

describe("evaluateGeometryRelationV1", () => {
  it("fails an exact-looking free midpoint because its dependency is not Midpoint", () => {
    const world = varignonWorld({
      E: point("E", -2.5, -2, "E=(-2.5,-2)", [], "unknown"),
    });
    const definition = VARIGNON_ACTIVITY_FR_V1.relationDefinitions[0];
    const evaluation = evaluateGeometryRelationV1(world, definition);

    expect(evaluation).toMatchObject({ status: "fail" });
    expect(evaluation.fact).toMatchObject({
      id: "rel_midpoint_e",
      pass: false,
      observed: [0, 0],
    });
  });

  it("evaluates every simple MVP relation with finite scale-normalized measures", () => {
    const world = relationWorld();
    const definitions = [
      definition("parallel", ["A", "B", "C", "D"]),
      definition("perpendicular", ["A", "B", "A", "C"]),
      definition("equal_length", ["A", "B", "C", "D"]),
      definition("point_on", ["P", "A", "B"]),
      definition("non_collinear", ["A", "B", "C"]),
      definition("parallelogram", ["A", "B", "D", "C"]),
    ];

    const evaluations = definitions.map((item) =>
      evaluateGeometryRelationV1(world, item),
    );
    expect(evaluations.map(({ status }) => status)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
    expect(
      evaluations.every(({ fact }) =>
        fact?.observed.every((measurement) => Number.isFinite(measurement)),
      ),
    ).toBe(true);
  });

  it.each([0.1, 1, 10_000])(
    "keeps midpoint, parallel and equal-length outcomes stable at scale %s",
    (scale) => {
      const world = scaledRelationWorld(scale);
      const definitions = [
        definition("midpoint", ["M", "A", "B"]),
        definition("parallel", ["A", "B", "C", "D"]),
        definition("equal_length", ["A", "B", "C", "D"]),
      ];
      expect(
        definitions.map(
          (item) => evaluateGeometryRelationV1(world, item).status,
        ),
      ).toEqual(["pass", "pass", "pass"]);
    },
  );

  it("returns unknown for quasi-zero segments, non-finite values and unknown tolerances", () => {
    const quasiZero = relationWorld({
      B: point("B", 0, 0, "B=(0,0)"),
    });
    const malformed = structuredClone(relationWorld()) as GeometryWorldV2Type;
    malformed.objects.find(({ name }) => name === "A")!.x = Number.NaN;
    const unsupported = {
      ...definition("parallel", ["A", "B", "C", "D"]),
      toleranceVersion: "parallel-unversioned",
    };

    expect(
      evaluateGeometryRelationV1(
        quasiZero,
        definition("parallel", ["A", "B", "C", "D"]),
      ),
    ).toMatchObject({ status: "unknown", reason: "degenerate_segment" });
    expect(
      evaluateGeometryRelationV1(
        malformed,
        definition("parallel", ["A", "B", "C", "D"]),
      ),
    ).toMatchObject({ status: "unknown", reason: "non_finite_coordinate" });
    expect(evaluateGeometryRelationV1(relationWorld(), unsupported)).toMatchObject({
      status: "unknown",
      reason: "unsupported_tolerance_version",
    });
  });

  it("returns a degenerate classification without a fabricated fact", () => {
    const world = relationWorld({
      C: point("C", 4, 0, "C=(4,0)"),
    });
    const evaluation = evaluateGeometryRelationV1(world, {
      id: "rel_configuration",
      relation: "configuration_type",
      objects: ["A", "B", "C", "D"],
      expected: "convex",
      toleranceVersion: "ordered-quadrilateral-v1",
    });

    expect(evaluation).toMatchObject({
      status: "unknown",
      reason: "degenerate_configuration",
      configuration: { type: "degenerate" },
    });
    expect(evaluation.fact).toBeUndefined();
  });
});

function varignonWorld(
  replacements: Record<string, GeometryWorldObjectV2> = {},
): GeometryWorldV2Type {
  const objects = [
    point("A", -4, -1, "A=(-4,-1)", [], "unknown", "scaffold"),
    point("B", -1, -3, "B=(-1,-3)", [], "unknown", "scaffold"),
    point("C", 4, -1, "C=(4,-1)", [], "unknown", "scaffold"),
    point("D", 1, 3, "D=(1,3)", [], "unknown", "scaffold"),
    point("E", -2.5, -2, "E=Midpoint(A,B)", ["A", "B"], "known"),
    point("F", 1.5, -2, "F=Midpoint(B,C)", ["B", "C"], "known"),
    point("G", 2.5, 1, "G=Midpoint(C,D)", ["C", "D"], "known"),
    point("H", -1.5, 1, "H=Midpoint(D,A)", ["D", "A"], "known"),
  ].map((object) => replacements[object.name] ?? object);
  return makeWorld(objects, "varignon_fr_v1", "fnv1a32:varignon");
}

function relationWorld(
  replacements: Record<string, GeometryWorldObjectV2> = {},
): GeometryWorldV2Type {
  const objects = [
    point("A", 0, 0, "A=(0,0)"),
    point("B", 2, 0, "B=(2,0)"),
    point("C", 0, 1, "C=(0,1)"),
    point("D", 2, 1, "D=(2,1)"),
    point("P", 1, 0, "P=(1,0)"),
  ].map((object) => replacements[object.name] ?? object);
  return makeWorld(objects, "relations_v1", "fnv1a32:relations");
}

function scaledRelationWorld(scale: number): GeometryWorldV2Type {
  return makeWorld(
    [
      point("A", 0, 0, "A=(0,0)"),
      point("B", 2 * scale, 0, "B=(2,0)"),
      point("C", 0, scale, "C=(0,1)"),
      point("D", 2 * scale, scale, "D=(2,1)"),
      point("M", scale, 0, "M=Midpoint(A,B)", ["A", "B"], "known"),
    ],
    "scaled_v1",
    `fnv1a32:scaled_${scale}`,
  );
}

function makeWorld(
  objects: GeometryWorldObjectV2[],
  activityId: string,
  snapshotHash: string,
): GeometryWorldV2Type {
  return GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId,
    epoch: 2,
    revision: 5,
    snapshotHash,
    objectCount: objects.length,
    truncated: false,
    objects,
    facts: [],
    change: {
      kind: "initial",
      objectNames: objects.map(({ name }) => name),
      terminal: true,
      actor: "system",
      occurredAt: 10,
    },
  });
}

function point(
  name: string,
  x: number,
  y: number,
  command: string,
  parents: string[] = [],
  dependencyStatus: "known" | "unknown" = "unknown",
  owner: GeometryWorldObjectV2["owner"] = "student",
): GeometryWorldObjectV2 {
  return {
    name,
    type: "point",
    command,
    parents,
    dependencyStatus,
    owner,
    x,
    y,
    visible: true,
  };
}

function definition(
  relation: GeometryRelationDefinitionV1["relation"],
  objects: string[],
): GeometryRelationDefinitionV1 {
  return {
    id: `rel_${relation}`,
    relation,
    objects,
    expected: true,
    toleranceVersion: GEOMETRY_TOLERANCE_VERSION_BY_RELATION_V1[relation],
  };
}

import {
  GeometryFactV1,
  GeometryWorldV2,
  type GeometryConfigurationV1,
  type GeometryInvestigationV1,
  type GeometryRelationDefinitionV1,
  type GeometryWorldObjectV2,
} from "./contracts";
import {
  classifyOrderedQuadrilateralV1,
  ORDERED_QUADRILATERAL_TOLERANCE_VERSION,
} from "./classifier";
import {
  coordinateTolerance,
  distinctTolerance,
  geometryScale,
  geometryVector,
  hasDistinctPoints,
  orientationCross,
  orientationTolerance,
  pointDistance,
  vectorCross,
  vectorDot,
  vectorLength,
  GEOMETRY_NUMERIC_TOLERANCES_V1,
  type GeometryPointV1,
} from "./numeric";

export const GEOMETRY_TOLERANCE_VERSION_BY_RELATION_V1 = Object.freeze({
  midpoint: "scaled-midpoint-v1",
  parallel: "normalized-cross-product-v1",
  perpendicular: "normalized-dot-product-v1",
  equal_length: "scaled-length-v1",
  point_on: "normalized-point-on-v1",
  non_collinear: "scaled-area-v1",
  parallelogram: "opposite-sides-parallel-v1",
  configuration_type: ORDERED_QUADRILATERAL_TOLERANCE_VERSION,
} satisfies Record<GeometryRelationDefinitionV1["relation"], string>);

const RELATION_ARITY = Object.freeze({
  midpoint: 3,
  parallel: 4,
  perpendicular: 4,
  equal_length: 4,
  point_on: 3,
  non_collinear: 3,
  parallelogram: 4,
  configuration_type: 4,
} satisfies Record<GeometryRelationDefinitionV1["relation"], number>);

export type GeometryEvaluationUnknownReasonV1 =
  | "activity_mismatch"
  | "unsupported_tolerance_version"
  | "invalid_arity"
  | "missing_object"
  | "non_point_object"
  | "non_finite_coordinate"
  | "degenerate_segment"
  | "degenerate_configuration";

export type GeometryRelationEvaluationV1 = Readonly<{
  definitionId: string;
  relation: GeometryRelationDefinitionV1["relation"];
  status: "pass" | "fail" | "unknown";
  reason?: GeometryEvaluationUnknownReasonV1;
  fact?: GeometryFactV1;
  configuration?: GeometryConfigurationV1;
  componentFactIds?: readonly string[];
}>;

export type GeometryEngineResultV1 = Readonly<{
  world: GeometryWorldV2;
  evaluations: readonly GeometryRelationEvaluationV1[];
  facts: readonly GeometryFactV1[];
  configuration?: GeometryConfigurationV1;
}>;

export function evaluateGeometryWorldV2(
  activity: GeometryInvestigationV1,
  world: GeometryWorldV2,
): GeometryEngineResultV1 {
  if (activity.id !== world.activityId) {
    const evaluations = activity.relationDefinitions.map((definition) =>
      unknownEvaluation(definition, "activity_mismatch"),
    );
    return {
      world: GeometryWorldV2.parse({
        ...world,
        facts: [],
        configuration: undefined,
      }),
      evaluations,
      facts: [],
    };
  }

  const directEvaluations = activity.relationDefinitions.map((definition) =>
    evaluateGeometryRelationV1(world, definition),
  );
  const evaluations = activity.relationDefinitions.map((definition, index) => {
    if (definition.relation !== "parallelogram") {
      return directEvaluations[index];
    }
    return (
      evaluateParallelogramFromDeclaredFacts(
        world,
        definition,
        activity.relationDefinitions,
        directEvaluations,
        directEvaluations[index],
      ) ?? directEvaluations[index]
    );
  });
  const facts = evaluations.flatMap((evaluation) =>
    evaluation.fact ? [evaluation.fact] : [],
  );
  const configuration = evaluations.find(
    (evaluation) => evaluation.configuration,
  )?.configuration;
  const evaluatedWorld = GeometryWorldV2.parse({
    ...world,
    facts,
    ...(configuration ? { configuration } : {}),
  });
  return { world: evaluatedWorld, evaluations, facts, configuration };
}

export function evaluateGeometryRelationV1(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
): GeometryRelationEvaluationV1 {
  if (
    definition.toleranceVersion !==
    GEOMETRY_TOLERANCE_VERSION_BY_RELATION_V1[definition.relation]
  ) {
    return unknownEvaluation(definition, "unsupported_tolerance_version");
  }
  if (definition.objects.length !== RELATION_ARITY[definition.relation]) {
    return unknownEvaluation(definition, "invalid_arity");
  }
  const objectByName = new Map(world.objects.map((object) => [object.name, object]));
  const objects = definition.objects.map((name) => objectByName.get(name));
  if (objects.some((object) => !object)) {
    return unknownEvaluation(definition, "missing_object");
  }
  if (objects.some((object) => object?.type.toLowerCase() !== "point")) {
    return unknownEvaluation(definition, "non_point_object");
  }
  const points = objects.map(toPoint);
  if (points.some((point) => !point)) {
    return unknownEvaluation(definition, "non_finite_coordinate");
  }
  return evaluateFiniteRelation(
    world,
    definition,
    objects as GeometryWorldObjectV2[],
    points as GeometryPointV1[],
  );
}

function evaluateFiniteRelation(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  objects: GeometryWorldObjectV2[],
  points: GeometryPointV1[],
): GeometryRelationEvaluationV1 {
  const scale = geometryScale(points);
  if (scale === undefined) {
    return unknownEvaluation(definition, "non_finite_coordinate");
  }
  switch (definition.relation) {
    case "midpoint":
      return evaluateMidpoint(world, definition, objects, points, scale);
    case "parallel":
      return evaluateParallel(world, definition, points, scale);
    case "perpendicular":
      return evaluatePerpendicular(world, definition, points, scale);
    case "equal_length":
      return evaluateEqualLength(world, definition, points, scale);
    case "point_on":
      return evaluatePointOn(world, definition, points, scale);
    case "non_collinear":
      return evaluateNonCollinear(world, definition, points, scale);
    case "parallelogram":
      return evaluateParallelogram(world, definition, points, scale);
    case "configuration_type":
      return evaluateConfiguration(world, definition, points);
  }
}

function evaluateMidpoint(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  objects: GeometryWorldObjectV2[],
  points: GeometryPointV1[],
  scale: number,
): GeometryRelationEvaluationV1 {
  const [candidate, first, second] = points;
  if (pointDistance(first, second) <= distinctTolerance(scale)) {
    return unknownEvaluation(definition, "degenerate_segment");
  }
  const expectedPoint = {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
  const distance = pointDistance(candidate, expectedPoint);
  const dependencyPass = hasExactMidpointDependency(
    objects[0],
    definition.objects[1],
    definition.objects[2],
  );
  return booleanEvaluation(
    world,
    definition,
    dependencyPass && distance <= coordinateTolerance(scale),
    [distance, dependencyPass ? 1 : 0],
    coordinateTolerance(scale),
  );
}

function evaluateParallel(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  points: GeometryPointV1[],
  scale: number,
): GeometryRelationEvaluationV1 {
  const measurement = parallelMeasurement(points, scale);
  if (measurement === undefined) {
    return unknownEvaluation(definition, "degenerate_segment");
  }
  return booleanEvaluation(
    world,
    definition,
    measurement <= GEOMETRY_NUMERIC_TOLERANCES_V1.normalizedCross,
    [measurement],
    GEOMETRY_NUMERIC_TOLERANCES_V1.normalizedCross,
  );
}

function evaluatePerpendicular(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  points: GeometryPointV1[],
  scale: number,
): GeometryRelationEvaluationV1 {
  const first = geometryVector(points[0], points[1]);
  const second = geometryVector(points[2], points[3]);
  const firstLength = vectorLength(first);
  const secondLength = vectorLength(second);
  if (
    firstLength <= distinctTolerance(scale) ||
    secondLength <= distinctTolerance(scale)
  ) {
    return unknownEvaluation(definition, "degenerate_segment");
  }
  const denominator = firstLength * secondLength;
  const measurement = Math.abs(vectorDot(first, second)) / denominator;
  return booleanEvaluation(
    world,
    definition,
    measurement <= GEOMETRY_NUMERIC_TOLERANCES_V1.normalizedDot,
    [measurement],
    GEOMETRY_NUMERIC_TOLERANCES_V1.normalizedDot,
  );
}

function evaluateEqualLength(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  points: GeometryPointV1[],
  scale: number,
): GeometryRelationEvaluationV1 {
  const firstLength = pointDistance(points[0], points[1]);
  const secondLength = pointDistance(points[2], points[3]);
  if (
    firstLength <= distinctTolerance(scale) ||
    secondLength <= distinctTolerance(scale)
  ) {
    return unknownEvaluation(definition, "degenerate_segment");
  }
  const difference = Math.abs(firstLength - secondLength);
  return booleanEvaluation(
    world,
    definition,
    difference <= coordinateTolerance(scale),
    [firstLength, secondLength, difference],
    coordinateTolerance(scale),
  );
}

function evaluatePointOn(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  points: GeometryPointV1[],
  scale: number,
): GeometryRelationEvaluationV1 {
  const line = geometryVector(points[1], points[2]);
  const lineLength = vectorLength(line);
  if (lineLength <= distinctTolerance(scale)) {
    return unknownEvaluation(definition, "degenerate_segment");
  }
  const distance =
    Math.abs(vectorCross(line, geometryVector(points[1], points[0]))) / lineLength;
  const normalizedDistance = distance / scale;
  return booleanEvaluation(
    world,
    definition,
    normalizedDistance <= GEOMETRY_NUMERIC_TOLERANCES_V1.normalizedPointOn,
    [normalizedDistance],
    GEOMETRY_NUMERIC_TOLERANCES_V1.normalizedPointOn,
  );
}

function evaluateNonCollinear(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  points: GeometryPointV1[],
  scale: number,
): GeometryRelationEvaluationV1 {
  if (!hasDistinctPoints(points, scale)) {
    return unknownEvaluation(definition, "degenerate_segment");
  }
  const area = Math.abs(orientationCross(points[0], points[1], points[2]));
  const tolerance = orientationTolerance(scale);
  return booleanEvaluation(
    world,
    definition,
    area > tolerance,
    [area],
    tolerance,
  );
}

function evaluateParallelogram(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  points: GeometryPointV1[],
  scale: number,
): GeometryRelationEvaluationV1 {
  const configuration = classifyOrderedQuadrilateralV1(points);
  if (configuration.type === "degenerate") {
    return unknownEvaluation(definition, "degenerate_configuration");
  }
  const firstPair = parallelMeasurement(
    [points[0], points[1], points[2], points[3]],
    scale,
  );
  const secondPair = parallelMeasurement(
    [points[1], points[2], points[3], points[0]],
    scale,
  );
  if (firstPair === undefined || secondPair === undefined) {
    return unknownEvaluation(definition, "degenerate_segment");
  }
  const tolerance = GEOMETRY_NUMERIC_TOLERANCES_V1.normalizedCross;
  return booleanEvaluation(
    world,
    definition,
    configuration.type !== "crossed" &&
      firstPair <= tolerance &&
      secondPair <= tolerance,
    [firstPair, secondPair],
    tolerance,
  );
}

function evaluateConfiguration(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  points: GeometryPointV1[],
): GeometryRelationEvaluationV1 {
  const result = classifyOrderedQuadrilateralV1(points);
  const configuration = geometryConfigurationFromClassification(world, result);
  if (result.type === "degenerate") {
    return {
      ...unknownEvaluation(definition, "degenerate_configuration"),
      configuration,
    };
  }
  const observed = [configurationCode(result.type)];
  return {
    ...booleanEvaluation(
      world,
      definition,
      result.type === definition.expected,
      observed,
      result.tolerance,
    ),
    configuration,
  };
}

function booleanEvaluation(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  observedPass: boolean,
  observed: number[],
  tolerance: number,
): GeometryRelationEvaluationV1 {
  const expected = definition.expected;
  const pass =
    typeof expected === "boolean" ? observedPass === expected : observedPass;
  const fact = GeometryFactV1.parse({
    id: definition.id,
    relation: definition.relation,
    objects: definition.objects,
    pass,
    observed,
    tolerance,
    toleranceVersion: definition.toleranceVersion,
    epoch: world.epoch,
    revision: world.revision,
    snapshotHash: world.snapshotHash,
  });
  return {
    definitionId: definition.id,
    relation: definition.relation,
    status: pass ? "pass" : "fail",
    fact,
  };
}

function unknownEvaluation(
  definition: GeometryRelationDefinitionV1,
  reason: GeometryEvaluationUnknownReasonV1,
): GeometryRelationEvaluationV1 {
  return {
    definitionId: definition.id,
    relation: definition.relation,
    status: "unknown",
    reason,
  };
}

function parallelMeasurement(
  points: readonly GeometryPointV1[],
  scale: number,
): number | undefined {
  const first = geometryVector(points[0], points[1]);
  const second = geometryVector(points[2], points[3]);
  const firstLength = vectorLength(first);
  const secondLength = vectorLength(second);
  if (
    firstLength <= distinctTolerance(scale) ||
    secondLength <= distinctTolerance(scale)
  ) {
    return undefined;
  }
  const denominator = firstLength * secondLength;
  return Math.abs(vectorCross(first, second)) / denominator;
}

function hasExactMidpointDependency(
  candidate: GeometryWorldObjectV2,
  first: string,
  second: string,
): boolean {
  if (candidate.dependencyStatus !== "known") return false;
  if (
    candidate.parents.length !== 2 ||
    [...candidate.parents].sort().join(",") !== [first, second].sort().join(",")
  ) {
    return false;
  }
  const expression = candidate.command.includes("=")
    ? candidate.command.slice(candidate.command.indexOf("=") + 1)
    : candidate.command;
  return /^Midpoint[([]/i.test(expression.trim());
}

function toPoint(object: GeometryWorldObjectV2 | undefined): GeometryPointV1 | undefined {
  if (!object || !Number.isFinite(object.x) || !Number.isFinite(object.y)) {
    return undefined;
  }
  return { x: object.x as number, y: object.y as number };
}

function geometryConfigurationFromClassification(
  world: GeometryWorldV2,
  result: ReturnType<typeof classifyOrderedQuadrilateralV1>,
): GeometryConfigurationV1 {
  return {
    type: result.type,
    orientation: result.orientation,
    intersections: [...result.intersections],
    toleranceVersion: result.toleranceVersion,
    epoch: world.epoch,
    revision: world.revision,
    snapshotHash: world.snapshotHash,
  };
}

function evaluateParallelogramFromDeclaredFacts(
  world: GeometryWorldV2,
  definition: GeometryRelationDefinitionV1,
  definitions: readonly GeometryRelationDefinitionV1[],
  evaluations: readonly GeometryRelationEvaluationV1[],
  standalone: GeometryRelationEvaluationV1,
): GeometryRelationEvaluationV1 | undefined {
  if (definition.objects.length !== 4) return undefined;
  const requiredPairs = [
    [
      definition.objects[0],
      definition.objects[1],
      definition.objects[2],
      definition.objects[3],
    ],
    [
      definition.objects[1],
      definition.objects[2],
      definition.objects[3],
      definition.objects[0],
    ],
  ];
  const components = requiredPairs.map((objects) => {
    const expectedKey = parallelObjectsKey(objects);
    const index = definitions.findIndex(
      (candidate) =>
        candidate.relation === "parallel" &&
        candidate.expected === true &&
        parallelObjectsKey(candidate.objects) === expectedKey,
    );
    return index === -1 ? undefined : evaluations[index];
  });
  if (components.some((component) => !component)) return undefined;
  const declared = components as GeometryRelationEvaluationV1[];
  const componentFactIds = declared.flatMap((component) =>
    component.fact ? [component.fact.id] : [],
  );
  if (standalone.status === "unknown") {
    return { ...standalone, componentFactIds };
  }
  if (declared.some(({ status }) => status === "unknown")) {
    const reason = declared.find(({ status }) => status === "unknown")?.reason;
    return {
      ...unknownEvaluation(definition, reason ?? "degenerate_segment"),
      componentFactIds,
    };
  }
  const observed = declared.map((component) => component.fact?.observed[0] ?? 1);
  const composed = {
    ...booleanEvaluation(
      world,
      definition,
      declared.every(({ status }) => status === "pass"),
      observed,
      GEOMETRY_NUMERIC_TOLERANCES_V1.normalizedCross,
    ),
    componentFactIds,
  };
  return standalone.status === composed.status
    ? composed
    : { ...standalone, componentFactIds };
}

function parallelObjectsKey(objects: readonly string[]): string {
  if (objects.length !== 4) return "";
  return [
    [objects[0], objects[1]].sort().join(":"),
    [objects[2], objects[3]].sort().join(":"),
  ]
    .sort()
    .join("|");
}

function configurationCode(type: GeometryConfigurationV1["type"]): number {
  return { convex: 0, concave: 1, crossed: 2, degenerate: 3 }[type];
}

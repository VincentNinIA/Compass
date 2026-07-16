import { describe, expect, it } from "vitest";

import type { GeneralExerciseReadyV1 } from "@/lib/exercise/general-exercise-contracts";
import type { GeoGebraApi } from "@/types/geogebra";
import {
  evaluateGeoGebraMissions,
  readGeoGebraWorldState,
} from "./mission-progress";

const EXERCISE: GeneralExerciseReadyV1 = {
  schemaVersion: "general_exercise.v1",
  outcome: "ready",
  language: "fr",
  subject: "mathematics",
  title: "Exercice 1",
  statement: "Construire les objets demandés.",
  tasks: [
    "Placer trois points E, F et G non alignés.",
    "Tracer en vert la droite passant par les points F et G.",
    "Tracer en bleu la demi-droite d'origine E et passant par le point F.",
    "Tracer en rouge le segment d'extrémités E et G.",
    "Placer un point K tel que K appartienne à la demi-droite EF et pas au segment EF.",
    "Écrire les deux relations avec les notations du cours.",
  ],
  concepts: ["géométrie"],
  ambiguityCode: null,
  clarificationQuestion: null,
};

type ObjectFixture = {
  type: string;
  command: string;
  color?: string;
  x?: number;
  y?: number;
};

function apiFor(objects: Record<string, ObjectFixture>): GeoGebraApi {
  return {
    evalCommand: () => false,
    exists: (name) => name in objects,
    isDefined: (name) => name in objects,
    getAllObjectNames: () => Object.keys(objects),
    getObjectType: (name) => objects[name]?.type ?? "",
    getCommandString: (name) => objects[name]?.command ?? "",
    getColor: (name) => objects[name]?.color ?? "#19221d",
    getXcoord: (name) => objects[name]?.x ?? Number.NaN,
    getYcoord: (name) => objects[name]?.y ?? Number.NaN,
    setCoordSystem: () => undefined,
    setLabelVisible: () => undefined,
  };
}

describe("GeoGebra deterministic mission progress", () => {
  it("awards only the first mission for three non-aligned named points", () => {
    const api = apiFor({
      E: { type: "point", command: "E = (0,0)", x: 0, y: 0 },
      F: { type: "point", command: "F = (2,0)", x: 2, y: 0 },
      G: { type: "point", command: "G = (0,2)", x: 0, y: 2 },
    });

    expect(evaluateGeoGebraMissions(api, EXERCISE)).toEqual([0]);
  });

  it("rejects aligned E, F and G instead of inventing XP", () => {
    const api = apiFor({
      E: { type: "point", command: "E = (0,0)", x: 0, y: 0 },
      F: { type: "point", command: "F = (1,1)", x: 1, y: 1 },
      G: { type: "point", command: "G = (2,2)", x: 2, y: 2 },
    });

    expect(evaluateGeoGebraMissions(api, EXERCISE)).toEqual([]);
  });

  it("verifies color, construction order and the point beyond F on ray EF", () => {
    const api = apiFor({
      E: { type: "point", command: "E = (0,0)", x: 0, y: 0 },
      F: { type: "point", command: "F = (2,0)", x: 2, y: 0 },
      G: { type: "point", command: "G = (0,2)", x: 0, y: 2 },
      K: { type: "point", command: "K = (3,0)", x: 3, y: 0 },
      lineFG: { type: "line", command: "lineFG = Line(F, G)", color: "#2E7D32" },
      rayEF: { type: "ray", command: "rayEF = Ray(E, F)", color: "#2563EB" },
      segmentEG: { type: "segment", command: "segmentEG = Segment(E, G)", color: "#C63D2F" },
    });

    expect(evaluateGeoGebraMissions(api, EXERCISE)).toEqual([0, 1, 2, 3, 4]);
  });

  it("publishes a bounded world snapshot with deterministic progress", () => {
    const objects = Object.fromEntries(
      Array.from({ length: 45 }, (_, index) => [
        `P${index}`,
        { type: "point", command: `P${index} = (${index},0)`, x: index, y: 0 },
      ]),
    );
    const state = readGeoGebraWorldState(
      apiFor(objects),
      EXERCISE,
      7,
      { type: "add", target: "P44" },
    );

    expect(state).toMatchObject({
      schemaVersion: "geogebra_world.v1",
      revision: 7,
      objectCount: 45,
      truncated: true,
      verifiedTaskIndexes: [],
      change: { type: "add", target: "P44" },
    });
    expect(state.objects).toHaveLength(40);
  });
});

import type { GeoGebraAdapter } from "./adapter";
import type { SceneRegistry } from "./scene";
import type { BisectorValidation, RelationEvidence } from "@/types/geogebra";

export const MIDPOINT_DISTANCE_TOLERANCE = 1e-6;

export type ValidationResult =
  | { ok: true; value: BisectorValidation }
  | {
      ok: false;
      error: {
        code: "candidate_missing" | "candidate_ambiguous" | "adapter_unavailable" | "measurement_failed";
        message: string;
      };
    };

export class PerpendicularBisectorValidator {
  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly registry: SceneRegistry,
  ) {}

  validate(revision: number, candidateName?: string): ValidationResult {
    const candidates = this.registry
      .list()
      .filter((object) => object.owner === "student" && object.kind === "line")
      .map(({ name }) => name);
    const selected = candidateName ? candidates.filter((name) => name === candidateName) : candidates;
    if (selected.length === 0) {
      return { ok: false, error: { code: "candidate_missing", message: "No student line can be validated." } };
    }
    if (selected.length > 1) {
      return { ok: false, error: { code: "candidate_ambiguous", message: "Several student lines could be validated." } };
    }

    const candidate = selected[0];
    const namespace = `gtR${revision}`;
    const perpendicularName = `${namespace}Perpendicular`;
    const midpointName = `${namespace}Midpoint`;
    const distanceName = `${namespace}MidpointDistance`;
    const helpers = [perpendicularName, midpointName, distanceName];

    const measured = this.adapter.withApi((api) => {
      try {
        if (helpers.some((name) => api.exists(name))) {
          return { ok: false as const, message: "Temporary validation labels already exist." };
        }
        const commands = [
          `${perpendicularName} = ArePerpendicular(${candidate}, AB)`,
          `${midpointName} = Midpoint(A, B)`,
          `${distanceName} = Distance(${midpointName}, ${candidate})`,
        ];
        for (const command of commands) {
          if (!api.evalCommand(command)) {
            return { ok: false as const, message: `GeoGebra rejected ${command}.` };
          }
          const name = command.split("=")[0].trim();
          this.registry.register(name, "temporary", name === midpointName ? "point" : name === perpendicularName ? "boolean" : "number");
        }
        if (!api.getValue || !api.isDefined(perpendicularName) || !api.isDefined(distanceName)) {
          return { ok: false as const, message: "GeoGebra returned a non-finite validation measurement." };
        }
        const perpendicular = Number(api.getValue(perpendicularName));
        const midpointDistance = Number(api.getValue(distanceName));
        if (!Number.isFinite(perpendicular) || !Number.isFinite(midpointDistance)) {
          return { ok: false as const, message: "GeoGebra returned a non-finite validation measurement." };
        }
        return { ok: true as const, perpendicular, midpointDistance };
      } finally {
        for (const name of helpers.toReversed()) {
          if (api.exists(name)) api.deleteObject?.(name);
          this.registry.remove(name);
        }
      }
    });

    if (!measured.ok) {
      return { ok: false, error: { code: "adapter_unavailable", message: measured.error.message } };
    }
    if (!measured.value.ok) {
      return { ok: false, error: { code: "measurement_failed", message: measured.value.message } };
    }

    const perpendicularEvidence = evidence(
      revision,
      "perpendicular",
      measured.value.perpendicular,
      0,
      measured.value.perpendicular === 1,
      [candidate, "AB"],
    );
    const midpointEvidence = evidence(
      revision,
      "passes_midpoint",
      measured.value.midpointDistance,
      MIDPOINT_DISTANCE_TOLERANCE,
      measured.value.midpointDistance <= MIDPOINT_DISTANCE_TOLERANCE,
      [candidate, "A", "B"],
    );
    const score = Number(perpendicularEvidence.pass) + Number(midpointEvidence.pass);
    return {
      ok: true,
      value: {
        candidate,
        revision,
        score: score as 0 | 1 | 2,
        evidence: [perpendicularEvidence, midpointEvidence],
      },
    };
  }
}

function evidence(
  revision: number,
  relation: RelationEvidence["relation"],
  observed: number,
  tolerance: number,
  pass: boolean,
  objects: string[],
): RelationEvidence {
  return {
    id: `evidence-r${revision}-${relation}`,
    relation,
    pass,
    observed,
    tolerance,
    revision,
    objects,
  };
}

import { describe, expect, it } from "vitest";

import { applyValidationResult, initialProgress, markProgressVerifying, reduceProgress } from "./progress";
import type { BisectorValidation, RelationEvidence } from "@/types/geogebra";

function validation(revision: number, perpendicular: boolean, midpoint: boolean): BisectorValidation {
  const evidence = [
    { id: `p${revision}`, relation: "perpendicular", pass: perpendicular, observed: perpendicular ? 1 : 0, tolerance: 0, revision, objects: ["candidate", "AB"] },
    { id: `m${revision}`, relation: "passes_midpoint", pass: midpoint, observed: midpoint ? 0 : 1, tolerance: 1e-6, revision, objects: ["candidate", "A", "B"] },
  ] satisfies [RelationEvidence, RelationEvidence];
  return { candidate: "candidate", revision, score: (Number(perpendicular) + Number(midpoint)) as 0 | 1 | 2, evidence };
}

describe("progress reducer", () => {
  it("follows 0/2, 1/2 and 2/2 from same-revision evidence", () => {
    const zero = reduceProgress(initialProgress(), validation(1, false, false));
    const one = reduceProgress(zero, validation(2, true, false));
    const two = reduceProgress(one, validation(3, true, true));
    expect([zero.score, one.score, two.score]).toEqual([0, 1, 2]);
    expect(two.evidenceIds).toEqual(["p3", "m3"]);
  });

  it("ignores stale evidence", () => {
    const current = reduceProgress(initialProgress(), validation(4, true, true));
    expect(reduceProgress(current, validation(3, false, false))).toBe(current);
  });

  it("keeps the last confirmed score while verification is incomplete", () => {
    const current = reduceProgress(initialProgress(), validation(2, true, false));
    const incomplete = {
      ...validation(3, true, true),
      evidence: [validation(3, true, true).evidence[0], { ...validation(3, true, true).evidence[1], revision: 2 }],
    } as BisectorValidation;
    expect(reduceProgress(current, incomplete)).toMatchObject({ score: 1, revision: 2, verifying: true });
    expect(markProgressVerifying(current)).toMatchObject({ score: 1, verifying: true });
  });

  it("returns from 2/2 to 0/2 when the last candidate is removed", () => {
    const complete = reduceProgress(initialProgress(), validation(2, true, true));
    const removed = applyValidationResult(
      complete,
      {
        ok: false,
        error: {
          code: "candidate_missing",
          message: "No student line can be validated.",
        },
      },
      3,
    );
    expect(removed).toEqual(initialProgress(3));
  });
});

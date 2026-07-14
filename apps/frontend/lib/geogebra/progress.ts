import type { BisectorValidation, ProgressState } from "@/types/geogebra";
import type { ValidationResult } from "./validator";

export function initialProgress(revision = 0): ProgressState {
  return {
    score: 0,
    criteria: { perpendicular: false, passesMidpoint: false },
    revision,
    evidenceIds: [],
    verifying: false,
  };
}

export function reduceProgress(
  current: ProgressState,
  validation: BisectorValidation,
): ProgressState {
  if (validation.revision < current.revision) return current;
  if (
    validation.evidence.length !== 2 ||
    validation.evidence.some((item) => item.revision !== validation.revision)
  ) {
    return { ...current, verifying: true };
  }
  const perpendicular = validation.evidence.find(
    ({ relation }) => relation === "perpendicular",
  );
  const midpoint = validation.evidence.find(
    ({ relation }) => relation === "passes_midpoint",
  );
  if (!perpendicular || !midpoint) return { ...current, verifying: true };
  return {
    score: validation.score,
    criteria: {
      perpendicular: perpendicular.pass,
      passesMidpoint: midpoint.pass,
    },
    revision: validation.revision,
    evidenceIds: [perpendicular.id, midpoint.id],
    verifying: false,
  };
}

export function markProgressVerifying(current: ProgressState) {
  return { ...current, verifying: true };
}

export function applyValidationResult(
  current: ProgressState,
  validation: ValidationResult,
  revision: number,
): ProgressState {
  if (validation.ok) return reduceProgress(current, validation.value);
  if (
    validation.error.code === "candidate_missing" ||
    validation.error.code === "candidate_ambiguous"
  ) {
    return initialProgress(revision);
  }
  return markProgressVerifying(current);
}

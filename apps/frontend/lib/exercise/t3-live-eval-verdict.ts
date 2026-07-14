export type T3LiveEvalVerdictInput = {
  requestId: unknown;
  schemaValid: boolean;
  outcomeMatches: boolean;
  ambiguityMatches: boolean;
  canonicalPlanOnly: boolean;
};

export type T3LiveEvalInvariants = {
  schemaValid: boolean;
  outcomeMatches: boolean;
  ambiguityMatches: boolean;
  canonicalPlanOnly: boolean;
  requestIdPresent: boolean;
};

export function evaluateT3LiveEvalVerdict(
  input: T3LiveEvalVerdictInput,
): {
  pass: boolean;
  invariants: T3LiveEvalInvariants;
} {
  const invariants = {
    schemaValid: input.schemaValid,
    outcomeMatches: input.outcomeMatches,
    ambiguityMatches: input.ambiguityMatches,
    canonicalPlanOnly: input.canonicalPlanOnly,
    requestIdPresent:
      typeof input.requestId === "string" && input.requestId.trim().length > 0,
  } satisfies T3LiveEvalInvariants;

  return {
    pass: Object.values(invariants).every(Boolean),
    invariants,
  };
}

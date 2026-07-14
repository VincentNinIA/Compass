import { describe, expect, it } from "vitest";

import { evaluateT3LiveEvalVerdict } from "./t3-live-eval-verdict";

const matchingFixture = {
  schemaValid: true,
  outcomeMatches: true,
  ambiguityMatches: true,
  canonicalPlanOnly: true,
} as const;

describe("T3 live eval verdict", () => {
  it.each([null, undefined, "", "   "])(
    "fails a matching fixture when the OpenAI request ID is %j",
    (requestId) => {
      expect(
        evaluateT3LiveEvalVerdict({ requestId, ...matchingFixture }),
      ).toEqual({
        pass: false,
        invariants: {
          ...matchingFixture,
          requestIdPresent: false,
        },
      });
    },
  );

  it("passes only when the request ID is non-empty and every other invariant matches", () => {
    expect(
      evaluateT3LiveEvalVerdict({
        requestId: "req_server_123",
        ...matchingFixture,
      }),
    ).toEqual({
      pass: true,
      invariants: {
        ...matchingFixture,
        requestIdPresent: true,
      },
    });
  });

  it("does not let a request ID hide another failed invariant", () => {
    expect(
      evaluateT3LiveEvalVerdict({
        requestId: "req_server_123",
        ...matchingFixture,
        outcomeMatches: false,
      }),
    ).toMatchObject({
      pass: false,
      invariants: {
        outcomeMatches: false,
        requestIdPresent: true,
      },
    });
  });
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import {
  deriveExercisePlanV1,
  validateExerciseExtractionWireV1,
} from "../lib/exercise/exercise-contracts";
import {
  EXERCISE_EXTRACTION_PROMPT,
  EXERCISE_PARSE_PROFILE,
  createExerciseExtractionTextFormatV1,
} from "../lib/exercise/exercise-parse-route";
import { normalizeExerciseImage } from "../lib/exercise/image-normalization";
import { FixtureManifestV1 } from "../lib/exercise/t3-fixture-manifest";
import { evaluateT3LiveEvalVerdict } from "../lib/exercise/t3-live-eval-verdict";

const FIXTURE_DIR = join(process.cwd(), "test-fixtures", "t3-exercise");

function report(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function errorField(error: unknown, field: "status" | "request_id") {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return null;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" || typeof value === "number" ? value : null;
}

const apiKey = process.env.OPENAI_API_KEY;
const liveIt = apiKey ? it : it.skip;

if (!apiKey) {
  report({
    schemaVersion: "t3_live_eval_report.v1",
    status: "not_run_missing_credential",
    model: EXERCISE_PARSE_PROFILE.model,
  });
}

describe("T3 exercise credentialed OpenAI eval", () => {
  liveIt(
    "evaluates only the seven normalized, authorized fixtures",
    async () => {
      const manifest = FixtureManifestV1.parse(
        JSON.parse(
          await readFile(join(FIXTURE_DIR, "manifest.json"), "utf8"),
        ),
      );
      const fixtures = manifest.fixtures.filter(({ evalAllowed }) => evalAllowed);
      const excluded = manifest.fixtures
        .filter(({ evalAllowed }) => !evalAllowed)
        .map(({ fixtureId }) => fixtureId);

      expect(fixtures).toHaveLength(7);
      expect(excluded).toEqual(["corrupt", "mime-spoof"]);

      const client = new OpenAI({
        apiKey,
        maxRetries: EXERCISE_PARSE_PROFILE.maxRetries,
        timeout: 60_000,
      });
      let passed = 0;
      let failed = 0;

      for (const fixture of fixtures) {
        let normalizedBytes: Buffer | null = null;
        try {
          const normalized = await normalizeExerciseImage(
            Buffer.from(
              await readFile(join(FIXTURE_DIR, fixture.fileName)),
            ),
          );
          normalizedBytes = normalized.bytes;
          const response = await client.responses.parse(
            {
              model: EXERCISE_PARSE_PROFILE.model,
              store: EXERCISE_PARSE_PROFILE.store,
              tools: [...EXERCISE_PARSE_PROFILE.tools],
              input: [
                {
                  role: "user",
                  content: [
                    { type: "input_text", text: EXERCISE_EXTRACTION_PROMPT },
                    {
                      type: "input_image",
                      image_url: `data:${normalized.mime};base64,${normalized.bytes.toString("base64")}`,
                      detail: EXERCISE_PARSE_PROFILE.imageDetail,
                    },
                  ],
                },
              ],
              text: { format: createExerciseExtractionTextFormatV1() },
            },
            {
              maxRetries: EXERCISE_PARSE_PROFILE.maxRetries,
              timeout: 60_000,
            },
          );

          const refused = response.output.some(
            (item) =>
              item.type === "message" &&
              item.content.some((content) => content.type === "refusal"),
          );
          let outcome = refused ? "refused" : "invalid_model_output";
          let ambiguityCode: string | null = null;
          let canonicalPlan = false;
          let schemaValid = false;

          if (!refused && response.status === "completed") {
            const validated = validateExerciseExtractionWireV1(
              response.output_parsed,
            );
            if (validated.success) {
              schemaValid = true;
              outcome = validated.data.outcome;
              ambiguityCode = validated.data.ambiguityCode;
              if (outcome === "ready") {
                const plan = deriveExercisePlanV1(validated.data);
                canonicalPlan =
                  JSON.stringify(plan.givens) ===
                    JSON.stringify([
                      {
                        kind: "point",
                        label: "A",
                        coordinates: { x: -3, y: 0 },
                      },
                      {
                        kind: "point",
                        label: "B",
                        coordinates: { x: 3, y: 0 },
                      },
                      {
                        kind: "segment",
                        label: "AB",
                        endpoints: ["A", "B"],
                      },
                    ]) &&
                  Object.keys(plan).join(",") ===
                    "schemaVersion,exerciseId,givens,studentMustCreate,targetRelations,initializationPolicy";
              }
            }
          }

          const outcomeMatches = outcome === fixture.expectedOutcome;
          const ambiguityMatches =
            fixture.expectedAmbiguityCode === null ||
            ambiguityCode === fixture.expectedAmbiguityCode;
          const planInvariant =
            outcome === "ready" ? canonicalPlan : canonicalPlan === false;
          const verdict = evaluateT3LiveEvalVerdict({
            requestId: response._request_id,
            schemaValid,
            outcomeMatches,
            ambiguityMatches,
            canonicalPlanOnly: planInvariant,
          });
          const { pass } = verdict;
          if (pass) passed += 1;
          else failed += 1;

          report({
            schemaVersion: "t3_live_eval_report.v1",
            status: pass ? "pass" : "fail",
            model: EXERCISE_PARSE_PROFILE.model,
            fixtureId: fixture.fixtureId,
            requestId: response._request_id ?? null,
            responseId: response.id,
            expectedOutcome: fixture.expectedOutcome,
            outcome,
            invariants: verdict.invariants,
          });
        } catch (error) {
          failed += 1;
          report({
            schemaVersion: "t3_live_eval_report.v1",
            status: "error",
            model: EXERCISE_PARSE_PROFILE.model,
            fixtureId: fixture.fixtureId,
            errorType:
              error instanceof Error
                ? error.constructor.name
                : "UnknownError",
            httpStatus: errorField(error, "status"),
            requestId: errorField(error, "request_id"),
          });
        } finally {
          normalizedBytes?.fill(0);
          normalizedBytes = null;
        }
      }

      report({
        schemaVersion: "t3_live_eval_report.v1",
        status: failed === 0 ? "pass" : "fail",
        model: EXERCISE_PARSE_PROFILE.model,
        evaluated: fixtures.length,
        passed,
        failed,
        excludedBeforeOpenAI: excluded,
      });
      expect(failed).toBe(0);
      expect(passed).toBe(fixtures.length);
    },
    10 * 60_000,
  );
});

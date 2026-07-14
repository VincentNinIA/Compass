import { z } from "zod";

const FIXTURE_MANIFEST_VERSION = "t3_fixture_expectation.v1" as const;

export const FixtureInvariantV1 = z.enum([
  "synthetic_no_personal_data",
  "normalizes_to_metadata_free_jpeg",
  "auto_orients_landscape",
  "route_rejects_before_openai",
  "canonical_plan_only",
  "no_plan",
  "printed_content_is_untrusted",
]);

export const FixtureExpectationV1 = z.strictObject({
  schemaVersion: z.literal(FIXTURE_MANIFEST_VERSION),
  fixtureId: z.string().regex(/^[a-z0-9-]+$/),
  fileName: z.string().regex(/^[a-z0-9-]+\.(?:jpg|png|webp)$/),
  provenance: z.literal("deterministic_sharp_svg_generator_v1"),
  synthetic: z.literal(true),
  containsPersonalData: z.literal(false),
  declaredMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  encodedFormat: z.enum(["jpeg", "png", "webp", "gif", "corrupt"]),
  sourceWidth: z.number().int().positive().nullable(),
  sourceHeight: z.number().int().positive().nullable(),
  exifOrientation: z.number().int().min(1).max(8).nullable(),
  expectedHttpStatus: z.union([z.literal(200), z.literal(400)]),
  expectedOutcome: z.enum([
    "ready",
    "needs_clarification",
    "unsupported",
    "invalid_image",
  ]),
  expectedAmbiguityCode: z
    .enum([
      "missing_labels",
      "unreadable_text",
      "conflicting_instruction",
      "missing_segment",
    ])
    .nullable(),
  evalAllowed: z.boolean(),
  invariants: z.array(FixtureInvariantV1).min(1),
  byteLength: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const FixtureManifestV1 = z.strictObject({
  schemaVersion: z.literal(FIXTURE_MANIFEST_VERSION),
  generator: z.literal("scripts/generate-t3-exercise-fixtures.mjs"),
  fixtureCount: z.literal(9),
  note: z.literal(
    "The authoritative T3-C08 corpus contains exactly nine enumerated synthetic fixtures.",
  ),
  fixtures: z.array(FixtureExpectationV1).length(9),
});

export type FixtureExpectationV1 = z.infer<typeof FixtureExpectationV1>;
export type FixtureManifestV1 = z.infer<typeof FixtureManifestV1>;

export const T3_FIXTURE_MANIFEST_VERSION = FIXTURE_MANIFEST_VERSION;

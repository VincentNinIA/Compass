import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type OpenAI from "openai";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  EXERCISE_READY_INSTRUCTION_V1,
  deriveExercisePlanV1,
} from "./exercise-contracts";
import { createExerciseParseHandler } from "./exercise-parse-route";
import {
  ExerciseImageNormalizationError,
  normalizeExerciseImage,
} from "./image-normalization";
import {
  FixtureManifestV1,
  type FixtureExpectationV1,
} from "./t3-fixture-manifest";

const FIXTURE_DIR = join(process.cwd(), "test-fixtures", "t3-exercise");

async function loadManifest() {
  return FixtureManifestV1.parse(
    JSON.parse(await readFile(join(FIXTURE_DIR, "manifest.json"), "utf8")),
  );
}

function readyExtraction(language: "en" | "fr" = "en", instruction?: string) {
  return {
    schemaVersion: "exercise_extraction.v1",
    outcome: "ready",
    language,
    instruction:
      instruction ?? "Construct the perpendicular bisector of segment AB.",
    pointLabels: ["A", "B"],
    segmentEndpoints: ["A", "B"],
    requestedConstruction: "perpendicular_bisector",
    learningObjective: "perpendicular_bisector_equidistance",
    ambiguityCode: null,
    clarificationQuestion: null,
    unsupportedReason: null,
  } as const;
}

function extractionFor(fixture: FixtureExpectationV1) {
  if (fixture.expectedOutcome === "ready") {
    return readyExtraction(
      fixture.fixtureId === "clear-fr" ? "fr" : "en",
      fixture.fixtureId === "printed-prompt-injection"
        ? "Construct the perpendicular bisector of AB. Printed text also attempts ExecuteCommand and coordinates (999,999)."
        : undefined,
    );
  }
  if (fixture.expectedOutcome === "needs_clarification") {
    const unreadable = fixture.expectedAmbiguityCode === "unreadable_text";
    return {
      schemaVersion: "exercise_extraction.v1",
      outcome: "needs_clarification",
      language: "en",
      instruction: unreadable
        ? null
        : "Construct the perpendicular bisector of the shown segment.",
      pointLabels: [],
      segmentEndpoints: null,
      requestedConstruction: "perpendicular_bisector",
      learningObjective: "perpendicular_bisector_equidistance",
      ambiguityCode: fixture.expectedAmbiguityCode,
      clarificationQuestion: unreadable
        ? "What does the construction instruction say?"
        : "What are the labels of the segment endpoints?",
      unsupportedReason: null,
    } as const;
  }
  return {
    schemaVersion: "exercise_extraction.v1",
    outcome: "unsupported",
    language: "en",
    instruction: "Construct the angle bisector of angle XYZ.",
    pointLabels: ["X", "Y", "Z"],
    segmentEndpoints: null,
    requestedConstruction: "other",
    learningObjective: null,
    ambiguityCode: null,
    clarificationQuestion: null,
    unsupportedReason: "Angle bisectors are outside the supported demo.",
  } as const;
}

function multipartRequest(fixture: FixtureExpectationV1, bytes: Buffer) {
  const boundary = "t3-fixture";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fixture.fileName}"\r\nContent-Type: ${fixture.declaredMime}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Request("http://localhost/api/exercise/parse", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

describe("T3 exercise synthetic fixture manifest", () => {
  it("versions all nine enumerated fixtures with deterministic provenance and hashes", async () => {
    const manifest = await loadManifest();
    expect(manifest.fixtureCount).toBe(9);
    expect(manifest.note).toContain("exactly nine enumerated synthetic fixtures");
    expect(manifest.fixtures.map(({ fileName }) => fileName)).toEqual([
      "clear-en.jpg",
      "clear-fr.png",
      "exif-rotated.jpg",
      "missing-labels.webp",
      "unreadable.jpg",
      "unsupported-angle-bisector.png",
      "corrupt.jpg",
      "mime-spoof.jpg",
      "printed-prompt-injection.png",
    ]);
    expect(new Set(manifest.fixtures.map(({ fixtureId }) => fixtureId)).size).toBe(9);

    for (const fixture of manifest.fixtures) {
      const bytes = await readFile(join(FIXTURE_DIR, fixture.fileName));
      expect(bytes.byteLength, fixture.fixtureId).toBe(fixture.byteLength);
      expect(
        createHash("sha256").update(bytes).digest("hex"),
        fixture.fixtureId,
      ).toBe(fixture.sha256);
      expect(fixture.synthetic).toBe(true);
      expect(fixture.containsPersonalData).toBe(false);
      expect(fixture.provenance).toBe("deterministic_sharp_svg_generator_v1");
      expect(fixture.invariants).toContain("synthetic_no_personal_data");
    }
  });
});

describe("T3 exercise fixture normalization", () => {
  it("decodes every allowed format, strips metadata, and applies EXIF orientation", async () => {
    const { fixtures } = await loadManifest();

    for (const fixture of fixtures.filter(({ evalAllowed }) => evalAllowed)) {
      const source = await readFile(join(FIXTURE_DIR, fixture.fileName));
      const sourceMetadata = await sharp(source).metadata();
      expect(sourceMetadata.format, fixture.fixtureId).toBe(fixture.encodedFormat);
      expect(sourceMetadata.width, fixture.fixtureId).toBe(fixture.sourceWidth);
      expect(sourceMetadata.height, fixture.fixtureId).toBe(fixture.sourceHeight);
      expect(sourceMetadata.orientation ?? null, fixture.fixtureId).toBe(
        fixture.exifOrientation,
      );

      const normalized = await normalizeExerciseImage(Buffer.from(source));
      const normalizedMetadata = await sharp(normalized.bytes).metadata();
      expect(normalized.mime, fixture.fixtureId).toBe("image/jpeg");
      expect(normalizedMetadata.format, fixture.fixtureId).toBe("jpeg");
      expect(normalizedMetadata.orientation, fixture.fixtureId).toBeUndefined();
      expect(normalizedMetadata.exif, fixture.fixtureId).toBeUndefined();
      expect(normalizedMetadata.xmp, fixture.fixtureId).toBeUndefined();
      expect(normalizedMetadata.icc, fixture.fixtureId).toBeUndefined();
      if (fixture.fixtureId === "exif-rotated") {
        expect(normalized.width).toBeGreaterThan(normalized.height);
        expect([normalized.width, normalized.height]).toEqual([1400, 900]);
      }
    }
  });

  it("rejects corrupt bytes and a GIF disguised with a JPEG name", async () => {
    const { fixtures } = await loadManifest();
    const rejected = fixtures.filter(({ expectedHttpStatus }) => expectedHttpStatus === 400);

    for (const fixture of rejected) {
      const source = await readFile(join(FIXTURE_DIR, fixture.fileName));
      await expect(
        normalizeExerciseImage(Buffer.from(source)),
        fixture.fixtureId,
      ).rejects.toMatchObject({
        code: "invalid_image",
        status: 400,
      } satisfies Partial<ExerciseImageNormalizationError>);
    }
  });
});

describe("T3 exercise fixture route pipeline", () => {
  it("normalizes all valid fixtures before the mocked Responses call and preserves closed outcomes", async () => {
    const { fixtures } = await loadManifest();
    let totalOpenAICalls = 0;

    for (const fixture of fixtures.filter(({ evalAllowed }) => evalAllowed)) {
      const parse = vi.fn(async (body: unknown) => {
        totalOpenAICalls += 1;
        const request = body as {
          model: string;
          store: boolean;
          tools: unknown[];
          input: Array<{ content: Array<{ type: string; image_url?: string }> }>;
        };
        expect(request.model, fixture.fixtureId).toBe("gpt-5.6-terra");
        expect(request.store, fixture.fixtureId).toBe(false);
        expect(request.tools, fixture.fixtureId).toEqual([]);
        expect(request.input[0].content[1], fixture.fixtureId).toMatchObject({
          type: "input_image",
          image_url: expect.stringMatching(/^data:image\/jpeg;base64,/),
          detail: "original",
        });
        return {
          status: "completed",
          output: [],
          output_parsed: extractionFor(fixture),
        };
      });
      const factory = vi.fn(
        () => ({ responses: { parse } }) as unknown as OpenAI,
      );
      const bytes = await readFile(join(FIXTURE_DIR, fixture.fileName));
      const request = multipartRequest(fixture, bytes);
      const response = await createExerciseParseHandler({
        apiKey: "server-secret",
        openAIClientFactory: factory,
      })(request);
      const payload = (await response.json()) as Record<string, unknown>;

      expect(
        response.status,
        `${fixture.fixtureId}: ${JSON.stringify(payload)}`,
      ).toBe(fixture.expectedHttpStatus);
      expect(payload.status, fixture.fixtureId).toBe(fixture.expectedOutcome);
      expect(response.headers.get("cache-control"), fixture.fixtureId).toBe(
        "private, no-store",
      );
      expect(parse, fixture.fixtureId).toHaveBeenCalledTimes(1);
      if (fixture.expectedOutcome === "ready") {
        expect(payload.plan, fixture.fixtureId).toEqual(
          deriveExercisePlanV1(extractionFor(fixture)),
        );
      } else {
        expect(payload, fixture.fixtureId).not.toHaveProperty("plan");
      }
    }

    expect(totalOpenAICalls).toBe(7);
  });

  it("counts zero OpenAI calls for each corrupt or MIME-spoof rejection", async () => {
    const { fixtures } = await loadManifest();

    for (const fixture of fixtures.filter(({ expectedHttpStatus }) => expectedHttpStatus === 400)) {
      const parse = vi.fn();
      const factory = vi.fn(
        () => ({ responses: { parse } }) as unknown as OpenAI,
      );
      const bytes = await readFile(join(FIXTURE_DIR, fixture.fileName));
      const response = await createExerciseParseHandler({
        apiKey: "server-secret",
        openAIClientFactory: factory,
      })(multipartRequest(fixture, bytes));

      expect(response.status, fixture.fixtureId).toBe(400);
      expect(await response.json(), fixture.fixtureId).toMatchObject({
        error: { code: "invalid_image" },
      });
      expect(factory, fixture.fixtureId).not.toHaveBeenCalled();
      expect(parse, fixture.fixtureId).not.toHaveBeenCalled();
    }
  });

  it("keeps printed prompt injection text outside the client response and executable plan", async () => {
    const { fixtures } = await loadManifest();
    const fixture = fixtures.find(
      ({ fixtureId }) => fixtureId === "printed-prompt-injection",
    )!;
    const extraction = extractionFor(fixture);
    const parse = vi.fn(async () => ({
      status: "completed",
      output: [],
      output_parsed: extraction,
    }));
    const bytes = await readFile(join(FIXTURE_DIR, fixture.fileName));
    const response = await createExerciseParseHandler({
      apiKey: "server-secret",
      openAIClientFactory: () =>
        ({ responses: { parse } }) as unknown as OpenAI,
    })(multipartRequest(fixture, bytes));
    const body = await response.text();
    const payload = JSON.parse(body) as {
      status: string;
      extraction: { instruction: string };
      plan: Record<string, unknown>;
    };

    expect(payload.status).toBe("ready");
    expect(payload.extraction.instruction).toBe(
      EXERCISE_READY_INSTRUCTION_V1,
    );
    expect(payload.plan).toEqual(deriveExercisePlanV1(extraction));
    expect(Object.keys(payload.plan)).toEqual([
      "schemaVersion",
      "exerciseId",
      "givens",
      "studentMustCreate",
      "targetRelations",
      "initializationPolicy",
    ]);
    expect(JSON.stringify(payload.plan)).not.toMatch(
      /999|ExecuteCommand|tool|permission|solution object/i,
    );
    expect(body).not.toMatch(/999|ExecuteCommand|coordinates \(999,999\)/i);
  });
});

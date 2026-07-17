// @vitest-environment node

import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createImageNormalizationFixtures,
  type ImageNormalizationFixtures,
} from "./__fixtures__/image-normalization-fixtures";
import {
  EXERCISE_IMAGE_LIMITS,
  ExerciseImageNormalizationError,
  createExerciseImageNormalizer,
  normalizeExerciseImage,
} from "./image-normalization";

let fixtures: ImageNormalizationFixtures;

beforeAll(async () => {
  fixtures = await createImageNormalizationFixtures();
});

async function expectNormalizationError(
  input: Buffer,
  expected: {
    code: string;
    status: number;
    category: "request" | "configuration";
    message: string;
  },
) {
  try {
    await normalizeExerciseImage(input);
    throw new Error("Expected image normalization to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ExerciseImageNormalizationError);
    expect(error).toMatchObject(expected);
  }
}

describe("server-authoritative exercise image normalization", () => {
  it("applies EXIF orientation 6 and strips EXIF, XMP and ICC metadata", async () => {
    const inputMetadata = await sharp(fixtures.exifOrientation6Jpeg).metadata();
    expect(inputMetadata).toMatchObject({
      format: "jpeg",
      width: 80,
      height: 40,
      orientation: 6,
      hasProfile: true,
    });
    expect(inputMetadata.exif).toBeDefined();
    expect(inputMetadata.xmp).toBeDefined();
    expect(inputMetadata.icc).toBeDefined();

    const normalized = await normalizeExerciseImage(
      fixtures.exifOrientation6Jpeg,
    );
    const outputMetadata = await sharp(normalized.bytes).metadata();
    const jpegMarkers = normalized.bytes.toString("latin1");

    expect(normalized).toMatchObject({
      mime: "image/jpeg",
      width: 40,
      height: 80,
      byteLength: normalized.bytes.byteLength,
    });
    expect(outputMetadata).toMatchObject({
      format: "jpeg",
      width: 40,
      height: 80,
      hasProfile: false,
    });
    expect(outputMetadata.orientation).toBeUndefined();
    expect(outputMetadata.exif).toBeUndefined();
    expect(outputMetadata.xmp).toBeUndefined();
    expect(outputMetadata.icc).toBeUndefined();
    expect(outputMetadata.iptc).toBeUndefined();
    expect(jpegMarkers).not.toContain("Exif\u0000\u0000");
    expect(jpegMarkers).not.toContain("xmpmeta");
    expect(jpegMarkers).not.toContain("ICC_PROFILE");
  });

  it("resizes 5000x3000 inside 2400x2400 without distortion", async () => {
    const normalized = await normalizeExerciseImage(fixtures.largePng);

    expect(normalized.mime).toBe("image/jpeg");
    expect(normalized.width).toBe(2_400);
    expect(normalized.height).toBe(1_440);
    expect(normalized.byteLength).toBe(normalized.bytes.byteLength);
  });

  it("accepts decoded WebP and does not enlarge a small image", async () => {
    const inputMetadata = await sharp(fixtures.webp).metadata();
    expect(inputMetadata.format).toBe("webp");

    const normalized = await normalizeExerciseImage(fixtures.webp);

    expect(normalized).toMatchObject({
      mime: "image/jpeg",
      width: 64,
      height: 32,
    });
    await expect(sharp(normalized.bytes).metadata()).resolves.toMatchObject({
      format: "jpeg",
      width: 64,
      height: 32,
    });
  });

  it("flattens transparent PNG pixels onto an opaque white background", async () => {
    const normalized = await normalizeExerciseImage(fixtures.transparentPng);
    const { data, info } = await sharp(normalized.bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(normalized).toMatchObject({
      mime: "image/jpeg",
      width: 32,
      height: 24,
    });
    expect(info.channels).toBe(3);
    expect(Math.min(...data)).toBeGreaterThanOrEqual(250);
  });

  it.each([
    ["an empty buffer", Buffer.alloc(0)],
    ["a corrupted JPEG", () => fixtures.corruptedJpeg],
    ["a payload spoofing JPEG", () => fixtures.spoofedJpeg],
    ["invalid dimensions", () => fixtures.invalidDimensionsPng],
  ])("rejects %s with the stable 400 contract", async (_label, input) => {
    const bytes = typeof input === "function" ? input() : input;
    await expectNormalizationError(bytes, {
      code: "invalid_image",
      status: 400,
      category: "request",
      message: "The image is invalid or uses an unsupported format.",
    });
  });

  it("rejects animated WebP and multi-page images before transformation", async () => {
    await expect(sharp(fixtures.animatedWebp).metadata()).resolves.toMatchObject({
      format: "webp",
      pages: 2,
    });
    await expect(sharp(fixtures.multipageTiff).metadata()).resolves.toMatchObject({
      format: "tiff",
      pages: 2,
    });

    for (const bytes of [fixtures.animatedWebp, fixtures.multipageTiff]) {
      await expectNormalizationError(bytes, {
        code: "invalid_image",
        status: 400,
        category: "request",
        message: "The image is invalid or uses an unsupported format.",
      });
    }
  });

  it("maps an input above 40 million decoded pixels to 413", async () => {
    const metadata = await sharp(fixtures.overPixelLimitPng).metadata();
    expect((metadata.width ?? 0) * (metadata.height ?? 0)).toBeGreaterThan(
      EXERCISE_IMAGE_LIMITS.maxInputPixels,
    );
    expect(fixtures.overPixelLimitPng.byteLength).toBeLessThan(
      EXERCISE_IMAGE_LIMITS.maxInputBytes,
    );

    await expectNormalizationError(fixtures.overPixelLimitPng, {
      code: "image_too_large",
      status: 413,
      category: "request",
      message: "The image exceeds the allowed size or pixel limit.",
    });
  });

  it("rejects more than 10 MiB before loading the decoder", async () => {
    const sharpLoader = vi.fn(async () => sharp);
    const normalize = createExerciseImageNormalizer(sharpLoader);
    const input = Buffer.alloc(EXERCISE_IMAGE_LIMITS.maxInputBytes + 1);

    await expect(normalize(input)).rejects.toMatchObject({
      code: "image_too_large",
      status: 413,
      category: "request",
    });
    expect(sharpLoader).not.toHaveBeenCalled();
  });

  it("returns an explicit configuration error when Sharp cannot load", async () => {
    const normalize = createExerciseImageNormalizer(async () => {
      throw new Error("native module details must not escape");
    });

    await expect(normalize(fixtures.webp)).rejects.toMatchObject({
      code: "image_normalization_unavailable",
      status: 500,
      category: "configuration",
      message: "Image normalization is unavailable on this server.",
    });
  });
});

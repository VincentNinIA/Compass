const MIN_INPUT_BYTES = 1;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_OUTPUT_EDGE = 2_400;
const JPEG_QUALITY = 90;

const ALLOWED_INPUT_FORMATS = new Set(["jpeg", "png", "webp"]);

export const EXERCISE_IMAGE_LIMITS = {
  minInputBytes: MIN_INPUT_BYTES,
  maxInputBytes: MAX_INPUT_BYTES,
  maxInputPixels: MAX_INPUT_PIXELS,
  maxOutputEdge: MAX_OUTPUT_EDGE,
  jpegQuality: JPEG_QUALITY,
} as const;

export type NormalizedExerciseImage = {
  bytes: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
  byteLength: number;
};

export type ExerciseImageNormalizationErrorCode =
  | "invalid_image"
  | "image_too_large"
  | "image_normalization_unavailable";

type ExerciseImageNormalizationErrorDefinition = {
  status: 400 | 413 | 500;
  category: "request" | "configuration";
  message: string;
};

const ERROR_DEFINITIONS: Record<
  ExerciseImageNormalizationErrorCode,
  ExerciseImageNormalizationErrorDefinition
> = {
  invalid_image: {
    status: 400,
    category: "request",
    message: "The image is invalid or uses an unsupported format.",
  },
  image_too_large: {
    status: 413,
    category: "request",
    message: "The image exceeds the allowed size or pixel limit.",
  },
  image_normalization_unavailable: {
    status: 500,
    category: "configuration",
    message: "Image normalization is unavailable on this server.",
  },
};

export class ExerciseImageNormalizationError extends Error {
  readonly code: ExerciseImageNormalizationErrorCode;
  readonly status: 400 | 413 | 500;
  readonly category: "request" | "configuration";

  constructor(code: ExerciseImageNormalizationErrorCode) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = "ExerciseImageNormalizationError";
    this.code = code;
    this.status = definition.status;
    this.category = definition.category;
  }
}

type SharpFactory = typeof import("sharp")["default"];
type SharpLoader = () => Promise<SharpFactory>;

async function loadSharp(): Promise<SharpFactory> {
  const sharpPackage = await import("sharp");
  return sharpPackage.default;
}

function normalizationError(
  code: ExerciseImageNormalizationErrorCode,
): ExerciseImageNormalizationError {
  return new ExerciseImageNormalizationError(code);
}

function hasValidDimensions(
  value: { width?: number; height?: number },
): value is { width: number; height: number } {
  return (
    Number.isSafeInteger(value.width) &&
    Number.isSafeInteger(value.height) &&
    (value.width ?? 0) > 0 &&
    (value.height ?? 0) > 0
  );
}

function isPixelLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}

function validateInputBuffer(input: Buffer): void {
  if (!Buffer.isBuffer(input) || input.byteLength < MIN_INPUT_BYTES) {
    throw normalizationError("invalid_image");
  }
  if (input.byteLength > MAX_INPUT_BYTES) {
    throw normalizationError("image_too_large");
  }
}

export function createExerciseImageNormalizer(
  sharpLoader: SharpLoader = loadSharp,
) {
  return async function normalizeExerciseImage(
    input: Buffer,
  ): Promise<NormalizedExerciseImage> {
    validateInputBuffer(input);

    let sharp: SharpFactory;
    try {
      sharp = await sharpLoader();
      if (typeof sharp !== "function") {
        throw new TypeError("Sharp factory is unavailable.");
      }
    } catch {
      throw normalizationError("image_normalization_unavailable");
    }

    try {
      const pipeline = sharp(input, {
        failOn: "warning",
        limitInputPixels: MAX_INPUT_PIXELS,
      });
      const metadata = await pipeline.metadata();

      if (
        !hasValidDimensions(metadata) ||
        metadata.format === undefined
      ) {
        throw normalizationError("invalid_image");
      }
      if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
        throw normalizationError("image_too_large");
      }
      if ((metadata.pages ?? 1) !== 1) {
        throw normalizationError("invalid_image");
      }
      if (!ALLOWED_INPUT_FORMATS.has(metadata.format)) {
        throw normalizationError("invalid_image");
      }

      const { data, info } = await pipeline
        .autoOrient()
        .resize({
          width: MAX_OUTPUT_EDGE,
          height: MAX_OUTPUT_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer({ resolveWithObject: true });

      if (
        info.format !== "jpeg" ||
        !hasValidDimensions(info) ||
        info.width > MAX_OUTPUT_EDGE ||
        info.height > MAX_OUTPUT_EDGE ||
        data.byteLength < 1 ||
        info.size !== data.byteLength
      ) {
        throw normalizationError("invalid_image");
      }

      return {
        bytes: data,
        mime: "image/jpeg",
        width: info.width,
        height: info.height,
        byteLength: data.byteLength,
      };
    } catch (error) {
      if (error instanceof ExerciseImageNormalizationError) {
        throw error;
      }
      if (isPixelLimitError(error)) {
        throw normalizationError("image_too_large");
      }
      throw normalizationError("invalid_image");
    }
  };
}

export const normalizeExerciseImage = createExerciseImageNormalizer();

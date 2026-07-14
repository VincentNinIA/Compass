import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  EXERCISE_EXTRACTION_WIRE_V1_JSON_SCHEMA,
  deriveExercisePlanV1,
} from "./exercise-contracts";
import {
  EXERCISE_PARSE_PROFILE,
  EXERCISE_PARSE_ROUTE_LIMITS,
  createExerciseParseHandler,
  type ExerciseParseRouteDependencies,
} from "./exercise-parse-route";
import { ExerciseImageNormalizationError } from "./image-normalization";

const READY_EXTRACTION = {
  schemaVersion: "exercise_extraction.v1",
  outcome: "ready",
  language: "en",
  instruction: "Construct the perpendicular bisector of segment AB.",
  pointLabels: ["A", "B"],
  segmentEndpoints: ["A", "B"],
  requestedConstruction: "perpendicular_bisector",
  learningObjective: "perpendicular_bisector_equidistance",
  ambiguityCode: null,
  clarificationQuestion: null,
  unsupportedReason: null,
} as const;

const CLARIFICATION_EXTRACTION = {
  schemaVersion: "exercise_extraction.v1",
  outcome: "needs_clarification",
  language: "en",
  instruction: "Construct the perpendicular bisector.",
  pointLabels: [],
  segmentEndpoints: null,
  requestedConstruction: "perpendicular_bisector",
  learningObjective: "perpendicular_bisector_equidistance",
  ambiguityCode: "missing_labels",
  clarificationQuestion: "What are the labels of the segment endpoints?",
  unsupportedReason: null,
} as const;

const UNSUPPORTED_EXTRACTION = {
  schemaVersion: "exercise_extraction.v1",
  outcome: "unsupported",
  language: "en",
  instruction: "Construct the angle bisector.",
  pointLabels: ["A", "B", "C"],
  segmentEndpoints: null,
  requestedConstruction: "other",
  learningObjective: null,
  ambiguityCode: null,
  clarificationQuestion: null,
  unsupportedReason: "This construction is outside the supported demo.",
} as const;

const NORMALIZED_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function multipartRequest(options: {
  image?: Buffer;
  clarification?: string;
  duplicateImage?: boolean;
  duplicateClarification?: boolean;
} = {}) {
  const form = new FormData();
  if (options.image !== undefined) {
    form.append(
      "image",
      new File([Uint8Array.from(options.image).buffer], "exercise.png", {
        type: "image/png",
      }),
    );
  }
  if (options.duplicateImage) {
    form.append(
      "image",
      new File([Buffer.from("second")], "second.png", { type: "image/png" }),
    );
  }
  if (options.clarification !== undefined) {
    form.append("clarification", options.clarification);
  }
  if (options.duplicateClarification) {
    form.append("clarification", "second answer");
  }
  return new Request("http://localhost/api/exercise/parse", {
    method: "POST",
    body: form,
  });
}

function parsedResponse(
  outputParsed: unknown,
  status: string | undefined = "completed",
) {
  return {
    status,
    output: [],
    output_parsed: outputParsed,
  };
}

function createSdkMock(result: unknown) {
  const parse = vi.fn(
    async (
      _body: unknown,
      _options?: {
        maxRetries?: number;
        timeout?: number;
        signal?: AbortSignal;
      },
    ) => {
      void _body;
      void _options;
      return result;
    },
  );
  const factory = vi.fn(
    () => ({ responses: { parse } }) as unknown as OpenAI,
  );
  return { parse, factory };
}

function dependencies(
  result: unknown,
): ExerciseParseRouteDependencies & ReturnType<typeof createSdkMock> {
  const sdk = createSdkMock(result);
  return {
    ...sdk,
    apiKey: "server-secret",
    normalizeImage: vi.fn(async () => ({
      bytes: Buffer.from(NORMALIZED_BYTES),
      mime: "image/jpeg" as const,
      width: 20,
      height: 10,
      byteLength: NORMALIZED_BYTES.byteLength,
    })),
    openAIClientFactory: sdk.factory,
  };
}

async function errorPayload(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; retryable: boolean };
  };
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
}

describe("POST /api/exercise/parse", () => {
  it("returns ready with the application-derived plan and exact SDK request", async () => {
    const deps = dependencies(parsedResponse(READY_EXTRACTION));
    const response = await createExerciseParseHandler(deps)(
      multipartRequest({
        image: Buffer.from("untrusted original bytes"),
        clarification: "The endpoints are labelled A and B.",
      }),
    );

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    expect(await response.json()).toEqual({
      status: "ready",
      extraction: READY_EXTRACTION,
      plan: deriveExercisePlanV1(READY_EXTRACTION),
    });

    expect(deps.factory).toHaveBeenCalledWith({
      apiKey: "server-secret",
      maxRetries: 0,
      timeout: EXERCISE_PARSE_ROUTE_LIMITS.timeoutMs,
    });
    expect(deps.parse).toHaveBeenCalledTimes(1);
    const [rawBody, requestOptions] = deps.parse.mock.calls[0]!;
    const body = rawBody as {
      input: Array<{
        content: Array<{ text?: string }>;
      }>;
      text: {
        format: {
          $brand: string;
          $parseRaw: (content: string) => unknown;
        };
      };
    };
    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      store: false,
      tools: [],
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: expect.any(String) },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${NORMALIZED_BYTES.toString("base64")}`,
              detail: "original",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "exercise_extraction_v1",
          strict: true,
          schema: EXERCISE_EXTRACTION_WIRE_V1_JSON_SCHEMA,
        },
      },
    });
    const inputText = body.input[0].content[0].text as string;
    expect(inputText).toContain("untrusted exercise data");
    expect(inputText).toContain("The endpoints are labelled A and B.");
    expect(inputText.length).toBeLessThanOrEqual(
      EXERCISE_PARSE_ROUTE_LIMITS.maxInputTextCharacters,
    );
    expect(body.text.format.$brand).toBe("auto-parseable-response-format");
    expect(body.text.format.$parseRaw).toEqual(expect.any(Function));
    expect(requestOptions).toMatchObject({
      maxRetries: 0,
      timeout: EXERCISE_PARSE_ROUTE_LIMITS.timeoutMs,
      signal: expect.any(AbortSignal),
    });
    expect(EXERCISE_PARSE_PROFILE).toEqual({
      model: "gpt-5.6-terra",
      store: false,
      tools: [],
      imageDetail: "original",
      formatName: "exercise_extraction_v1",
      maxRetries: 0,
    });
  });

  it("returns the closed clarification branch without a plan", async () => {
    const deps = dependencies(parsedResponse(CLARIFICATION_EXTRACTION));
    const response = await createExerciseParseHandler(deps)(
      multipartRequest({ image: Buffer.from("image") }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "needs_clarification",
      question: "What are the labels of the segment endpoints?",
      code: "missing_labels",
    });
  });

  it("returns the closed unsupported branch without a plan", async () => {
    const deps = dependencies(parsedResponse(UNSUPPORTED_EXTRACTION));
    const response = await createExerciseParseHandler(deps)(
      multipartRequest({ image: Buffer.from("image") }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "unsupported",
      reason: "This construction is outside the supported demo.",
    });
  });

  it("detects refusal before reading parsed output and returns a generic message", async () => {
    const refusal = {
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "refusal",
              refusal: "provider refusal containing untrusted details",
            },
          ],
        },
      ],
    } as { status: string; output: unknown[]; output_parsed?: unknown };
    Object.defineProperty(refusal, "output_parsed", {
      get: () => {
        throw new Error("parsed output must not be read for a refusal");
      },
    });
    const deps = dependencies(refusal);
    const response = await createExerciseParseHandler(deps)(
      multipartRequest({ image: Buffer.from("image") }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"status":"refused"');
    expect(body).not.toContain("provider refusal");
    expect(body).not.toContain("untrusted details");
  });

  it.each([
    ["incomplete", parsedResponse(null, "incomplete")],
    ["missing status", { output: [], output_parsed: null }],
    ["missing parsed output", { status: "completed", output: [] }],
    [
      "semantically incoherent extraction",
      parsedResponse({ ...READY_EXTRACTION, pointLabels: ["A", "C"] }),
    ],
    [
      "semantically incoherent clarification",
      parsedResponse({
        ...CLARIFICATION_EXTRACTION,
        pointLabels: ["A", "B"],
      }),
    ],
    [
      "semantically incoherent unsupported outcome",
      parsedResponse({
        ...READY_EXTRACTION,
        outcome: "unsupported",
        unsupportedReason: "Incorrectly classified as unsupported.",
      }),
    ],
  ])("rejects %s as invalid model output", async (_label, result) => {
    const deps = dependencies(result);
    const response = await createExerciseParseHandler(deps)(
      multipartRequest({ image: Buffer.from("image") }),
    );

    expect(response.status).toBe(502);
    expectPrivateNoStore(response);
    expect((await errorPayload(response)).error.code).toBe(
      "invalid_model_output",
    );
  });

  it.each([
    [
      "ZodError",
      () => z.string().parse(42),
      "expected string, received number",
    ],
    [
      "SyntaxError",
      () => {
        throw new SyntaxError("provider parser detail with server-secret");
      },
      "provider parser detail",
    ],
  ])(
    "maps a Structured Output %s to an expurgated invalid_model_output",
    async (_label, throwProviderError, providerDetail) => {
      let providerError: unknown;
      try {
        throwProviderError();
      } catch (error) {
        providerError = error;
      }

      const deps = dependencies(parsedResponse(null));
      deps.parse.mockRejectedValueOnce(providerError);
      const response = await createExerciseParseHandler(deps)(
        multipartRequest({ image: Buffer.from("image") }),
      );
      const body = await response.text();

      expect(response.status).toBe(502);
      expectPrivateNoStore(response);
      expect(body).toContain('"code":"invalid_model_output"');
      expect(body).not.toContain(providerDetail);
      expect(body).not.toContain("server-secret");
      expect(deps.parse).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403])(
    "maps upstream authentication status %s without provider details",
    async (status) => {
      const providerError = Object.assign(
        new Error("provider detail with server-secret"),
        { status },
      );
      const deps = dependencies(parsedResponse(null));
      deps.parse.mockRejectedValueOnce(providerError);
      const response = await createExerciseParseHandler(deps)(
        multipartRequest({ image: Buffer.from("image") }),
      );
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(body).toContain("openai_not_configured");
      expect(body).not.toContain("provider detail");
      expect(body).not.toContain("server-secret");
      expect(deps.parse).toHaveBeenCalledTimes(1);
    },
  );

  it.each([429, 500, 502])(
    "maps retryable upstream status %s to parse_unavailable",
    async (status) => {
      const deps = dependencies(parsedResponse(null));
      deps.parse.mockRejectedValueOnce(
        Object.assign(new Error("provider payload"), { status }),
      );
      const response = await createExerciseParseHandler(deps)(
        multipartRequest({ image: Buffer.from("image") }),
      );

      expect(response.status).toBe(503);
      expect((await errorPayload(response)).error).toMatchObject({
        code: "parse_unavailable",
        retryable: true,
      });
      expect(deps.parse).toHaveBeenCalledTimes(1);
    },
  );

  it("maps a network failure to parse_unavailable without an automatic retry", async () => {
    const deps = dependencies(parsedResponse(null));
    deps.parse.mockRejectedValueOnce(new Error("socket included payload"));
    const response = await createExerciseParseHandler(deps)(
      multipartRequest({ image: Buffer.from("image") }),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain("parse_unavailable");
    expect(body).not.toContain("socket included payload");
    expect(deps.parse).toHaveBeenCalledTimes(1);
  });

  it("aborts at the route timeout and returns parse_timeout", async () => {
    const deps = dependencies(parsedResponse(null));
    deps.timeoutMs = 5;
    deps.parse.mockImplementationOnce(
      async (_body: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const response = await createExerciseParseHandler(deps)(
      multipartRequest({ image: Buffer.from("image") }),
    );

    expect(response.status).toBe(504);
    expect((await errorPayload(response)).error.code).toBe("parse_timeout");
    expect(deps.parse).toHaveBeenCalledTimes(1);
  });

  it("rejects a decoded invalid image before creating or calling OpenAI", async () => {
    const factory = vi.fn(
      () => ({ responses: { parse: vi.fn() } }) as unknown as OpenAI,
    );
    const normalizeImage = vi.fn(async () => {
      throw new ExerciseImageNormalizationError("invalid_image");
    });
    const response = await createExerciseParseHandler({
      apiKey: "server-secret",
      normalizeImage,
      openAIClientFactory: factory,
    })(multipartRequest({ image: Buffer.from("not an image") }));

    expect(response.status).toBe(400);
    expectPrivateNoStore(response);
    expect((await errorPayload(response)).error.code).toBe("invalid_image");
    expect(normalizeImage).toHaveBeenCalledTimes(1);
    expect(factory).not.toHaveBeenCalled();
  });

  it("integrates the C03 normalizer and makes zero OpenAI calls for corrupt bytes", async () => {
    const factory = vi.fn(
      () => ({ responses: { parse: vi.fn() } }) as unknown as OpenAI,
    );
    const response = await createExerciseParseHandler({
      apiKey: "server-secret",
      openAIClientFactory: factory,
    })(multipartRequest({ image: Buffer.from("corrupt image bytes") }));

    expect(response.status).toBe(400);
    expect((await errorPayload(response)).error.code).toBe("invalid_image");
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ["missing image", {}],
    ["clarification above 500 characters", { image: Buffer.from("image"), clarification: "x".repeat(501) }],
    ["oversized clarification cannot be hidden by trimming", { image: Buffer.from("image"), clarification: `${" ".repeat(500)}x` }],
    ["duplicate image", { image: Buffer.from("image"), duplicateImage: true }],
    ["duplicate clarification", { image: Buffer.from("image"), clarification: "first", duplicateClarification: true }],
  ])("rejects invalid multipart input: %s", async (_label, options) => {
    const deps = dependencies(parsedResponse(READY_EXTRACTION));
    const response = await createExerciseParseHandler(deps)(
      multipartRequest(options),
    );

    expect(response.status).toBe(400);
    expect((await errorPayload(response)).error.code).toBe("invalid_request");
    expect(deps.factory).not.toHaveBeenCalled();
  });

  it("rejects a missing server key without exposing configuration details", async () => {
    const normalizeImage = vi.fn(async () => ({
      bytes: Buffer.from(NORMALIZED_BYTES),
      mime: "image/jpeg" as const,
      width: 20,
      height: 10,
      byteLength: NORMALIZED_BYTES.byteLength,
    }));
    const response = await createExerciseParseHandler({
      apiKey: "",
      normalizeImage,
    })(multipartRequest({ image: Buffer.from("image") }));

    expect(response.status).toBe(503);
    expect((await errorPayload(response)).error.code).toBe(
      "openai_not_configured",
    );
  });

  it("rejects non-multipart input before normalization or OpenAI", async () => {
    const normalizeImage = vi.fn();
    const factory = vi.fn(
      () => ({ responses: { parse: vi.fn() } }) as unknown as OpenAI,
    );
    const response = await createExerciseParseHandler({
      apiKey: "server-secret",
      normalizeImage,
      openAIClientFactory: factory,
    })(
      new Request("http://localhost/api/exercise/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(400);
    expectPrivateNoStore(response);
    expect(normalizeImage).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });
});

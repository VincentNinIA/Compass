// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createTeacherDraftHandler,
  type TeacherDraftGenerationInput,
} from "./draft-service";

const MODEL_DRAFT = {
  exercise: {
    schemaVersion: "general_exercise.v1",
    outcome: "ready",
    language: "en",
    subject: "mathematics",
    title: "Compare fractions",
    statement: "Compare fractions with unlike denominators.",
    tasks: ["Find a common denominator.", "Compare the numerators."],
    concepts: ["fractions"],
    ambiguityCode: null,
    clarificationQuestion: null,
  },
  level: "middle_school",
  theme: "Fractions",
  guidance: {
    learningObjective: "Compare fractions using equivalent forms.",
    teacherInstructions: "Ask for a visual explanation.",
    targetDifficulties: ["Common denominators"],
    likelyMisconceptions: ["Comparing denominators directly"],
    hintSequence: ["List multiples of each denominator."],
  },
  estimatedMinutes: 20,
} as const;

function form(source: "generated" | "upload" = "generated") {
  const data = new FormData();
  data.set("source", source);
  data.set("subject", "mathematics");
  data.set("level", "middle_school");
  data.set("theme", "Fractions");
  data.set("difficulties", "Common denominators");
  data.set("teacherInstructions", "Ask for a visual explanation.");
  data.set("language", "en");
  if (source === "upload") {
    data.set("image", new File([new Uint8Array([1, 2, 3])], "exercise.png", {
      type: "image/png",
    }));
  }
  return data;
}

function request(data: FormData) {
  return new Request("http://localhost/api/teacher/draft", {
    method: "POST",
    body: data,
  });
}

describe("frugal teacher draft service", () => {
  it("uses exactly one generation call and reports the enforced budget", async () => {
    const generate = vi.fn(async (input: TeacherDraftGenerationInput) => {
      void input;
      return MODEL_DRAFT;
    });
    const response = await createTeacherDraftHandler({ generate })(request(form()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      draft: { schemaVersion: "teacher_exercise.v1", source: "generated" },
      review: { publishable: true },
      usage: {
        model: "gpt-5.6-luna",
        maxModelCalls: 1,
        actualModelCalls: 1,
      },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      source: "generated",
      prompt: expect.stringContaining("Requested level: middle_school"),
    });
  });

  it("normalizes an upload before the same single model call", async () => {
    const generate = vi.fn(async (input: TeacherDraftGenerationInput) => {
      void input;
      return MODEL_DRAFT;
    });
    const normalizeImage = vi.fn(async () => ({
      bytes: Buffer.from([4, 5, 6]),
      mime: "image/jpeg" as const,
      width: 10,
      height: 10,
      byteLength: 3,
    }));
    const uploadForm = form("upload");
    uploadForm.set("theme", "");
    const response = await createTeacherDraftHandler({
      generate,
      normalizeImage,
    })(request(uploadForm));

    expect(response.status).toBe(200);
    expect(normalizeImage).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      source: "upload",
      imageDataUrl: "data:image/jpeg;base64,BAUG",
      prompt: expect.stringContaining(
        "transcribe and structure the supplied exercise image",
      ),
    });
  });

  it("returns a zero-cost manual fallback when AI is not configured", async () => {
    const response = await createTeacherDraftHandler()(request(form()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "draft_unconfigured" },
    });
  });

  it("rejects output outside the closed schema without retrying", async () => {
    const generate = vi.fn(async (input: TeacherDraftGenerationInput) => {
      void input;
      return { ...MODEL_DRAFT, extra: true };
    });
    const response = await createTeacherDraftHandler({ generate })(request(form()));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_model_output" },
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

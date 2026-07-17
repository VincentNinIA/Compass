import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import {
  GENERAL_EXERCISE_EXTRACTION_PROMPT,
  createExerciseParseHandler,
} from "./exercise-parse-route";

const READY = {
  schemaVersion: "general_exercise.v1",
  outcome: "ready",
  language: "fr",
  subject: "mathematics",
  title: "Exercice 1",
  statement: "Six consignes de géométrie.",
  tasks: ["Étape a", "Étape b", "Étape c", "Étape d", "Étape e", "Étape f"],
  concepts: ["droite", "segment"],
  ambiguityCode: null,
  clarificationQuestion: null,
} as const;

function request() {
  const body = new FormData();
  body.set("image", new File([new Uint8Array([1, 2, 3])], "exercise.png", {
    type: "image/png",
  }));
  return new Request("http://localhost/api/exercise/parse", {
    method: "POST",
    body,
  });
}

describe("general exercise parse profile", () => {
  it("returns every readable subject as ready_general with no unsupported branch", async () => {
    const parse = vi.fn(async (body: unknown) => {
      void body;
      return {
        status: "completed",
        output: [],
        output_parsed: READY,
      };
    });
    const response = await createExerciseParseHandler({
      profile: "general",
      apiKey: "server-secret",
      normalizeImage: vi.fn(async () => ({
        bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        mime: "image/jpeg" as const,
        width: 20,
        height: 10,
        byteLength: 4,
      })),
      openAIClientFactory: vi.fn(
        () => ({ responses: { parse } }) as unknown as OpenAI,
      ),
    })(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ready_general",
      exercise: READY,
    });
    const body = parse.mock.calls[0]![0] as {
      store: boolean;
      tools: unknown[];
      input: Array<{ content: Array<{ text?: string }> }>;
      text: { format: { name: string; strict: boolean } };
    };
    expect(body.store).toBe(false);
    expect(body.tools).toEqual([]);
    expect(body.input[0]?.content[0]?.text).toBe(GENERAL_EXERCISE_EXTRACTION_PROMPT);
    expect(body.text.format).toMatchObject({
      name: "general_exercise_v1",
      strict: true,
    });
  });

  it("maps an unreadable image to application-owned clarification", async () => {
    const parse = vi.fn(async (body: unknown) => {
      void body;
      return {
        status: "completed",
        output: [],
        output_parsed: {
        schemaVersion: "general_exercise.v1",
        outcome: "needs_clarification",
        language: "unknown",
        subject: "unknown",
        title: null,
        statement: null,
        tasks: [],
        concepts: [],
        ambiguityCode: "unreadable_text",
        clarificationQuestion: "Printed model wording is not authoritative.",
        },
      };
    });
    const response = await createExerciseParseHandler({
      profile: "general",
      apiKey: "server-secret",
      normalizeImage: vi.fn(async () => ({
        bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        mime: "image/jpeg" as const,
        width: 20,
        height: 10,
        byteLength: 4,
      })),
      openAIClientFactory: vi.fn(
        () => ({ responses: { parse } }) as unknown as OpenAI,
      ),
    })(request());

    expect(await response.json()).toEqual({
      status: "needs_clarification_general",
      code: "unreadable_text",
      question: "What does the exercise say?",
    });
  });
});

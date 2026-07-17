import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTeacherGeometryDraftV2 } from "@/lib/teacher/geometry-exercise";
import { clearTeacherExercisesForTests } from "@/lib/teacher/store";

import { GET, POST } from "./route";

describe("teacher exercises route v2", () => {
  beforeEach(clearTeacherExercisesForTests);
  afterEach(clearTeacherExercisesForTests);

  it("publishes and lists the exact geometry discriminant", async () => {
    const draft = createTeacherGeometryDraftV2("fr");
    const published = await POST(
      new Request("http://localhost/api/teacher/exercises", {
        method: "POST",
        body: JSON.stringify({ draft }),
      }),
    );
    expect(published.status).toBe(201);
    const payload = (await published.json()) as {
      publication: { id: string; content: unknown };
    };
    expect(payload.publication.content).toMatchObject({
      kind: "geometry_investigation",
      exercise: { id: "varignon_fr_v1" },
    });

    const listed = (await (await GET()).json()) as {
      exercises: Array<{ id: string }>;
    };
    expect(listed.exercises.map(({ id }) => id)).toEqual([
      payload.publication.id,
    ]);
  });

  it("rejects a red geometry review without a partial publication", async () => {
    const draft = createTeacherGeometryDraftV2("en");
    const response = await POST(
      new Request("http://localhost/api/teacher/exercises", {
        method: "POST",
        body: JSON.stringify({
          draft: {
            ...draft,
            content: {
              ...draft.content,
              exercise: { ...draft.content.exercise, title: "" },
            },
          },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await (await GET()).json()).exercises).toEqual([]);
  });
});

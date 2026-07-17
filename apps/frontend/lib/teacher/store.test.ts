import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TeacherExerciseDraftV1 } from "./exercise";
import { createTeacherGeometryDraftV2 } from "./geometry-exercise";
import {
  clearTeacherExercisesForTests,
  listTeacherExercises,
  publishTeacherExercise,
  publishTeacherGeometryExercise,
  TEACHER_EXERCISE_STORE_LIMIT,
} from "./store";

const VALID_DRAFT = TeacherExerciseDraftV1.parse({
  schemaVersion: "teacher_exercise.v1",
  source: "manual",
  level: "middle_school",
  theme: "Fractions",
  estimatedMinutes: 20,
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
  guidance: {
    learningObjective: "Compare fractions using equivalent forms.",
    teacherInstructions: "Ask for a visual explanation.",
    targetDifficulties: ["Common denominators"],
    likelyMisconceptions: ["Comparing denominators directly"],
    hintSequence: ["List multiples of each denominator."],
  },
});

describe("teacher exercise server-memory store", () => {
  beforeEach(clearTeacherExercisesForTests);
  afterEach(clearTeacherExercisesForTests);

  it("publishes newest first and keeps the shared catalog bounded", () => {
    for (let index = 0; index <= TEACHER_EXERCISE_STORE_LIMIT; index += 1) {
      publishTeacherExercise(VALID_DRAFT, {
        id: `teacher_${String(index).padStart(8, "0")}`,
        now: index,
      });
    }

    const publications = listTeacherExercises();
    expect(publications).toHaveLength(TEACHER_EXERCISE_STORE_LIMIT);
    expect(publications[0]).toMatchObject({
      id: "teacher_00000064",
      publishedAt: 64,
    });
    expect(publications.at(-1)?.id).toBe("teacher_00000001");
    expect(Object.isFrozen(publications)).toBe(true);
  });

  it("refuses a locally blocked draft", () => {
    expect(() =>
      publishTeacherExercise({
        ...VALID_DRAFT,
        exercise: {
          ...VALID_DRAFT.exercise,
          tasks: ["Same mission.", "Same mission."],
        },
      }),
    ).toThrow("teacher_draft_not_publishable");
    expect(listTeacherExercises()).toHaveLength(0);
  });

  it("stores general and geometry publications in the same bounded catalog", () => {
    const general = publishTeacherExercise(VALID_DRAFT, {
      id: "teacher_general-001",
      now: 10,
    });
    const geometry = publishTeacherGeometryExercise(
      createTeacherGeometryDraftV2("fr"),
      { id: "teacher_geometry-001", now: 20 },
    );

    expect(listTeacherExercises()).toEqual([geometry, general]);
    expect(geometry.content).toMatchObject({
      kind: "geometry_investigation",
      exercise: { id: "varignon_fr_v1" },
    });
  });
});

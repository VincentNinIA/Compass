import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "./language-provider";
import { TeacherExerciseLibrary } from "./teacher-exercise-library";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TeacherExerciseLibrary", () => {
  it("keeps the empty student library focused on the next useful action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ exercises: [] })),
    );

    render(
      <LanguageProvider>
        <TeacherExerciseLibrary onBack={() => undefined} onStart={() => undefined} />
      </LanguageProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "No exercise has been published yet.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ask your teacher to publish one, or bring your own homework from the home screen.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/prototype/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/server/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/model/i)).not.toBeInTheDocument();
  });

  it("keeps an exercise published in this tab when the remote catalog fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const onStart = vi.fn();

    render(
      <LanguageProvider>
        <TeacherExerciseLibrary
          onBack={() => undefined}
          onStart={onStart}
          initialExercises={[
            {
              schemaVersion: "teacher_exercise.v1",
              source: "manual",
              id: "teacher_local-001",
              publishedAt: 123,
              exercise: {
                schemaVersion: "general_exercise.v1",
                outcome: "ready",
                language: "en",
                subject: "history",
                title: "The Enlightenment",
                statement: "Explain two ideas.",
                tasks: ["Name one idea.", "Give one example."],
                concepts: ["Enlightenment"],
                ambiguityCode: null,
                clarificationQuestion: null,
              },
              level: "middle_school",
              theme: "The Enlightenment",
              guidance: {
                learningObjective: "Connect an idea to an example.",
                teacherInstructions: "Ask for evidence.",
                targetDifficulties: [],
                likelyMisconceptions: [],
                hintSequence: ["Restate the idea."],
              },
              estimatedMinutes: 15,
            },
          ]}
        />
      </LanguageProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "The Enlightenment" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start this exercise" }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "teacher_local-001" }),
    );
  });
});

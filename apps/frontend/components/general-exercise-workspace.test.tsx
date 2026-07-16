import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { GeneralExerciseReadyV1 } from "@/lib/exercise/general-exercise-contracts";
import { GeneralExerciseWorkspace } from "./general-exercise-workspace";

const EXERCISE: GeneralExerciseReadyV1 = {
  schemaVersion: "general_exercise.v1",
  outcome: "ready",
  language: "fr",
  subject: "mathematics",
  title: "Exercice 1",
  statement: "Construire les objets demandés.",
  tasks: [
    "Placer E, F et G.",
    "Tracer la droite FG.",
    "Tracer la demi-droite EF.",
    "Tracer le segment EG.",
    "Placer K.",
    "Écrire la notation.",
  ],
  concepts: ["géométrie"],
  ambiguityCode: null,
  clarificationQuestion: null,
};

afterEach(cleanup);

describe("GeneralExerciseWorkspace mission rail", () => {
  it("shows verified progress only from provided deterministic task indexes", () => {
    const { container } = render(
      <GeneralExerciseWorkspace
        exercise={EXERCISE}
        layout="rail"
        verifiedTaskIndexes={new Set([0, 1])}
      />,
    );

    expect(screen.getByLabelText("Exercise missions")).toBeInTheDocument();
    expect(screen.getByLabelText("Verified exploration points")).toHaveTextContent(
      "40XP",
    );
    expect(
      container.querySelectorAll('[data-mission-status="verified"]'),
    ).toHaveLength(2);
    expect(
      container.querySelector('[data-mission-status="active"] button'),
    ).toHaveTextContent("3");
  });

  it("lets the learner inspect another mission without claiming it is verified", () => {
    render(<GeneralExerciseWorkspace exercise={EXERCISE} layout="rail" />);

    fireEvent.click(screen.getByRole("button", { name: /Mission 4:/ }));

    expect(screen.getByText(/4\. Tracer le segment EG\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Verified exploration points")).toHaveTextContent(
      "0XP",
    );
  });
});

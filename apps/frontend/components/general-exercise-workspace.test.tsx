import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";

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
    expect(screen.getByLabelText("Exercise XP")).toHaveTextContent(
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
    expect(screen.getByLabelText("Exercise XP")).toHaveTextContent(
      "0XP",
    );
  });

  it("turns every general exercise task into a sequential XP mission", () => {
    function Harness() {
      const [completed, setCompleted] = useState<ReadonlySet<number>>(
        new Set(),
      );
      return (
        <GeneralExerciseWorkspace
          exercise={{ ...EXERCISE, tasks: EXERCISE.tasks.slice(0, 2) }}
          completedTaskIndexes={completed}
          score={completed.size * 10}
          onCompleteTask={(taskIndex) =>
            setCompleted((current) => new Set([...current, taskIndex]))
          }
        />
      );
    }

    const { container } = render(<Harness />);

    expect(screen.getByLabelText("Exercise XP")).toHaveTextContent("0XP");
    expect(
      screen.getByRole("button", { name: "Complete mission 1 for 10 XP" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Complete mission 2 for 10 XP" }),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Before claiming progress, what did you try?",
      }),
      { target: { value: "I found a common denominator." } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Complete mission 1 for 10 XP" }),
    );
    expect(screen.getByLabelText("Exercise XP")).toHaveTextContent("10XP");
    expect(
      container.querySelectorAll('[data-mission-status="completed"]'),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Complete mission 2 for 10 XP" }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Before claiming progress, what did you try?",
      }),
      { target: { value: "I compared the numerators." } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Complete mission 2 for 10 XP" }),
    );
    expect(screen.getByLabelText("Exercise XP")).toHaveTextContent("20XP");
    expect(screen.getByText("Exercise complete!")).toBeInTheDocument();
  });

  it("keeps the transfer answer local and reports only completion", () => {
    function Harness() {
      const [transferCompleted, setTransferCompleted] = useState(false);
      return (
        <GeneralExerciseWorkspace
          exercise={{ ...EXERCISE, tasks: EXERCISE.tasks.slice(0, 1) }}
          completedTaskIndexes={new Set([0])}
          transferCompleted={transferCompleted}
          onTransferComplete={() => setTransferCompleted(true)}
        />
      );
    }

    render(<Harness />);

    const answer = screen.getByRole("textbox", {
      name: /Where could you reuse one idea/,
    });
    const finish = screen.getByRole("button", { name: "Finish reflection" });
    expect(finish).toBeDisabled();
    fireEvent.change(answer, {
      target: { value: "I could use the same method with ratios." },
    });
    fireEvent.click(finish);

    expect(screen.getByText("Transfer reflection complete")).toBeInTheDocument();
    expect(
      screen.getByText("Your teacher sees only that you completed it — not your answer."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/same method with ratios/)).not.toBeInTheDocument();
  });

  it("labels learner completion separately from deterministic verification", () => {
    const { container } = render(
      <GeneralExerciseWorkspace
        exercise={{ ...EXERCISE, tasks: EXERCISE.tasks.slice(0, 2) }}
        completedTaskIndexes={new Set([0, 1])}
        verifiedTaskIndexes={new Set([1])}
        score={30}
      />,
    );

    expect(screen.getByText("Completed by you · 10 XP")).toBeInTheDocument();
    expect(
      screen.getByText("Verified by the workspace · 20 XP"),
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-mission-status="completed"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-mission-status="verified"]'),
    ).toHaveLength(1);
  });
});

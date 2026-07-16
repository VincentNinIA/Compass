"use client";

import { useMemo, useState } from "react";

import type { GeneralExerciseReadyV1 } from "@/lib/exercise/general-exercise-contracts";
import { useLanguage } from "./language-provider";

export function GeneralExerciseWorkspace({
  exercise,
  layout = "card",
  verifiedTaskIndexes,
}: {
  exercise?: GeneralExerciseReadyV1;
  layout?: "card" | "sidebar" | "rail";
  verifiedTaskIndexes?: ReadonlySet<number>;
}) {
  const { text } = useLanguage();
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const verified = useMemo(
    () => verifiedTaskIndexes ?? new Set<number>(),
    [verifiedTaskIndexes],
  );
  const firstPending = exercise?.tasks.findIndex((_, index) => !verified.has(index)) ?? 0;
  const activeTask = firstPending >= 0 ? firstPending : Math.max(0, (exercise?.tasks.length ?? 1) - 1);

  if (layout === "rail" && exercise) {
    const visibleTask = Math.min(selectedTask ?? activeTask, exercise.tasks.length - 1);
    const score = verified.size * 20;
    return (
      <section
        className="general-exercise-workspace general-exercise-workspace--rail"
        aria-labelledby="general-workspace-title"
        data-exercise-ready="true"
        data-score={score}
      >
        <div className="mission-current">
          <span>{text("Current mission", "Mission en cours")}</span>
          <strong id="general-workspace-title">
            {visibleTask + 1}. {exercise.tasks[visibleTask]}
          </strong>
        </div>
        <ol
          className="mission-track"
          aria-label={text("Exercise missions", "Missions de l'exercice")}
        >
          {exercise.tasks.map((task, index) => {
            const status = verified.has(index)
              ? "verified"
              : index === activeTask
                ? "active"
                : "pending";
            return (
              <li key={`${index}-${task}`} data-mission-status={status}>
                <button
                  type="button"
                  className="button-secondary"
                  aria-current={index === visibleTask ? "step" : undefined}
                  aria-label={text(
                    `Mission ${index + 1}: ${task}`,
                    `Mission ${index + 1} : ${task}`,
                  )}
                  onClick={() => setSelectedTask(index)}
                >
                  {verified.has(index) ? "✓" : index + 1}
                </button>
              </li>
            );
          })}
        </ol>
        <output
          className="mission-score"
          aria-live="polite"
          aria-atomic="true"
          aria-label={text(
            "Verified exploration points",
            "Points d'exploration vérifiés",
          )}
        >
          <strong>{score}</strong>
          <span>XP</span>
        </output>
      </section>
    );
  }

  return (
    <section
      className={`general-exercise-workspace spike workspace-card workspace-card-canvas general-exercise-workspace--${layout}`}
      aria-labelledby="general-workspace-title"
      data-exercise-ready={exercise ? "true" : "false"}
    >
      <div className="spike-heading">
        <div>
          <p className="section-index">
            {text("Step 2 · Work through it", "Étape 2 · Avance pas à pas")}
          </p>
          <h2 id="general-workspace-title">
            {exercise
              ? text("Your exercise, one step at a time", "Ton exercice, étape par étape")
              : text("Every subject is welcome here", "Toutes les matières ont leur place ici")}
          </h2>
        </div>
        <p>
          {exercise
            ? text(
                "Choose the step you're working on, try it, then ask Compass for the smallest useful hint.",
                "Choisis l'étape sur laquelle tu travailles, essaie, puis demande à Compass le plus petit indice utile.",
              )
            : text(
                "Add and confirm a readable exercise. Compass will keep its original order without forcing it into a geometry template.",
                "Ajoute puis confirme un exercice lisible. Compass gardera son ordre d'origine sans l'enfermer dans un modèle de géométrie.",
              )}
        </p>
      </div>

      {exercise ? (
        <div className="general-exercise-board">
          <div className="general-exercise-meta">
            <span>{exercise.subject.replaceAll("_", " ")}</span>
            {exercise.title ? <strong>{exercise.title}</strong> : null}
          </div>
          <ol className="general-task-list">
            {exercise.tasks.map((task, index) => (
              <li key={`${index}-${task}`}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <p>{task}</p>
              </li>
            ))}
          </ol>
          <p className="general-honesty-note">
            {text(
              "Compass can explain and question you across subjects. Automatic checking is shown only when a verified specialist tool is actually available.",
              "Compass peut t'expliquer et te questionner dans toutes les matières. Une vérification automatique n'est affichée que lorsqu'un outil spécialisé fiable est réellement disponible.",
            )}
          </p>
        </div>
      ) : (
        <div className="general-workspace-empty" role="status">
          <span aria-hidden="true">Aa + ∑ + ?</span>
          <h3>{text("Waiting for your exercise", "J'attends ton exercice")}</h3>
          <p>
            {text(
              "Mathematics, languages, history, science… if the exercise is readable, Compass can help you reason through it.",
              "Mathématiques, langues, histoire, sciences… si l'exercice est lisible, Compass peut t'aider à raisonner.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}

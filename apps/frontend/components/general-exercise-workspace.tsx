"use client";

import { useMemo, useState, type FormEvent } from "react";

import type { GeneralExerciseReadyV1 } from "@/lib/exercise/general-exercise-contracts";
import {
  COMPLETED_MISSION_XP,
  VERIFIED_MISSION_XP,
} from "@/lib/gamification/progress";
import { useLanguage } from "./language-provider";

type MissionStatus = "pending" | "active" | "completed" | "verified";

export function GeneralExerciseWorkspace({
  exercise,
  layout = "card",
  verifiedTaskIndexes,
  completedTaskIndexes,
  score,
  onCompleteTask,
  transferCompleted = false,
  onTransferComplete,
}: {
  exercise?: GeneralExerciseReadyV1;
  layout?: "card" | "sidebar" | "rail";
  verifiedTaskIndexes?: ReadonlySet<number>;
  completedTaskIndexes?: ReadonlySet<number>;
  score?: number;
  onCompleteTask?(taskIndex: number, learnerReflection: string): void;
  transferCompleted?: boolean;
  onTransferComplete?(): void;
}) {
  const { text } = useLanguage();
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const [missionReflections, setMissionReflections] = useState<
    Readonly<Record<number, string>>
  >({});
  const verified = useMemo(
    () => verifiedTaskIndexes ?? new Set<number>(),
    [verifiedTaskIndexes],
  );
  const completed = useMemo(
    () => completedTaskIndexes ?? new Set<number>(),
    [completedTaskIndexes],
  );
  const earned = useMemo(
    () => new Set([...completed, ...verified]),
    [completed, verified],
  );
  const firstPending =
    exercise?.tasks.findIndex((_, index) => !earned.has(index)) ?? 0;
  const allComplete = Boolean(exercise && firstPending < 0);
  const activeTask =
    firstPending >= 0
      ? firstPending
      : Math.max(0, (exercise?.tasks.length ?? 1) - 1);
  const exerciseScore =
    score ??
    [...earned].reduce(
      (total, index) =>
        total +
        (verified.has(index) ? VERIFIED_MISSION_XP : COMPLETED_MISSION_XP),
      0,
    );

  const missionStatus = (index: number): MissionStatus =>
    verified.has(index)
      ? "verified"
      : completed.has(index)
        ? "completed"
        : !allComplete && index === activeTask
          ? "active"
          : "pending";

  if (layout === "rail" && exercise) {
    const visibleTask = Math.min(
      selectedTask ?? activeTask,
      exercise.tasks.length - 1,
    );
    return (
      <section
        className="general-exercise-workspace general-exercise-workspace--rail"
        aria-labelledby="general-workspace-title"
        data-exercise-ready="true"
        data-score={exerciseScore}
      >
        {allComplete ? (
          <TransferPrompt
            compact
            completed={transferCompleted}
            onComplete={onTransferComplete}
            titleId="general-workspace-title"
          />
        ) : (
          <div className="mission-current">
            <span>{text("Current mission", "Mission en cours")}</span>
            <strong id="general-workspace-title">
              {visibleTask + 1}. {exercise.tasks[visibleTask]}
            </strong>
            {visibleTask === activeTask && onCompleteTask ? (
              <MissionReflectionAction
                compact
                taskIndex={visibleTask}
                value={missionReflections[visibleTask] ?? ""}
                onChange={(value) =>
                  setMissionReflections((current) => ({
                    ...current,
                    [visibleTask]: value,
                  }))
                }
                onComplete={() =>
                  onCompleteTask(
                    visibleTask,
                    (missionReflections[visibleTask] ?? "").trim(),
                  )
                }
              />
            ) : null}
          </div>
        )}
        <ol
          className="mission-track"
          aria-label={text("Exercise missions", "Missions de l'exercice")}
        >
          {exercise.tasks.map((task, index) => {
            const status = missionStatus(index);
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
                  {status === "verified"
                    ? "✓"
                    : status === "completed"
                      ? "+"
                      : index + 1}
                </button>
              </li>
            );
          })}
        </ol>
        <MissionScore score={exerciseScore} />
      </section>
    );
  }

  return (
    <section
      className={`general-exercise-workspace spike workspace-card workspace-card-canvas general-exercise-workspace--${layout}`}
      aria-labelledby="general-workspace-title"
      data-exercise-ready={exercise ? "true" : "false"}
      data-score={exerciseScore}
    >
      <div className="spike-heading">
        <div>
          <p className="section-index">
            {text("Your mission path", "Ton parcours de missions")}
          </p>
          <h2 id="general-workspace-title">
            {exercise
              ? text(
                  "Your exercise, one step at a time",
                  "Ton exercice, étape par étape",
                )
              : text(
                  "Every subject is welcome here",
                  "Toutes les matières ont leur place ici",
                )}
          </h2>
        </div>
        <p>
          {exercise
            ? text(
                "Complete one mission at a time. You earn progress XP for moving forward, while verified XP appears only when a reliable checker is available.",
                "Termine une mission à la fois. Tu gagnes des XP de progression en avançant; les XP vérifiés apparaissent seulement lorsqu'un correcteur fiable est disponible.",
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
            <MissionScore score={exerciseScore} compact />
          </div>
          <div className="mission-level" aria-hidden="true">
            <span>
              {allComplete
                ? text("All missions complete", "Toutes les missions sont terminées")
                : text(
                    `Mission ${activeTask + 1} of ${exercise.tasks.length}`,
                    `Mission ${activeTask + 1} sur ${exercise.tasks.length}`,
                  )}
            </span>
            <i
              style={{
                width: `${Math.round((earned.size / exercise.tasks.length) * 100)}%`,
              }}
            />
          </div>
          <ol
            className="general-task-list general-task-list--missions"
            aria-label={text("Exercise missions", "Missions de l'exercice")}
          >
            {exercise.tasks.map((task, index) => {
              const status = missionStatus(index);
              return (
                <li key={`${index}-${task}`} data-mission-status={status}>
                  <span className="mission-number" aria-hidden="true">
                    {status === "verified"
                      ? "✓"
                      : status === "completed"
                        ? "+"
                        : String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="mission-copy">
                    <p>{task}</p>
                    <small>{statusCopy(status, text)}</small>
                  </div>
                  {status === "active" && onCompleteTask ? (
                    <MissionReflectionAction
                      taskIndex={index}
                      value={missionReflections[index] ?? ""}
                      onChange={(value) =>
                        setMissionReflections((current) => ({
                          ...current,
                          [index]: value,
                        }))
                      }
                      onComplete={() =>
                        onCompleteTask(
                          index,
                          (missionReflections[index] ?? "").trim(),
                        )
                      }
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
          {allComplete ? (
            <>
              <div className="mission-complete-banner" role="status">
                <strong>{text("Exercise complete!", "Exercice terminé !")}</strong>
                <span>
                  {text(
                    "Nice work — your session XP are safely banked.",
                    "Bravo — tes XP de session sont bien acquis.",
                  )}
                </span>
              </div>
              <TransferPrompt
                completed={transferCompleted}
                onComplete={onTransferComplete}
              />
            </>
          ) : null}
          <p className="general-honesty-note">
            {text(
              "Marking a mission complete records your progress, not a grade. Compass labels a mission verified only when a reliable specialist checker proves it.",
              "Terminer une mission enregistre ta progression, pas une note. Compass indique « vérifiée » uniquement lorsqu'un correcteur spécialisé fiable l'a prouvée.",
            )}
          </p>
        </div>
      ) : (
        <div className="general-workspace-empty" role="status">
          <span aria-hidden="true">Aa + ∑ + ?</span>
          <h3>{text("Waiting for your exercise", "J'attends ton exercice")}</h3>
          <p>
            {text(
              "Mathematics, languages, history, science… if the exercise is readable, Compass can turn its steps into missions.",
              "Mathématiques, langues, histoire, sciences… si l'exercice est lisible, Compass peut transformer ses étapes en missions.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}

function MissionReflectionAction({
  taskIndex,
  value,
  compact = false,
  onChange,
  onComplete,
}: {
  taskIndex: number;
  value: string;
  compact?: boolean;
  onChange(value: string): void;
  onComplete(): void;
}) {
  const { text } = useLanguage();
  const reflectionReady = value.trim().length >= 3;
  const inputId = `mission-reflection-${taskIndex}`;

  return (
    <div className={`mission-reflection${compact ? " mission-reflection--compact" : ""}`}>
      <label htmlFor={inputId}>
        {text(
          "Before claiming progress, what did you try?",
          "Avant de valider, qu'as-tu essayé ?",
        )}
      </label>
      <div>
        <input
          id={inputId}
          value={value}
          maxLength={180}
          placeholder={text(
            "One short note about your approach",
            "Une courte note sur ta démarche",
          )}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="mission-complete-button"
          aria-label={text(
            `Complete mission ${taskIndex + 1} for ${COMPLETED_MISSION_XP} XP`,
            `Terminer la mission ${taskIndex + 1} pour ${COMPLETED_MISSION_XP} XP`,
          )}
          disabled={!reflectionReady}
          onClick={onComplete}
        >
          <span>{text("I finished this step", "J'ai terminé cette étape")}</span>
          <strong>+{COMPLETED_MISSION_XP} XP</strong>
        </button>
      </div>
    </div>
  );
}

function TransferPrompt({
  compact = false,
  completed,
  onComplete,
  titleId,
}: {
  compact?: boolean;
  completed: boolean;
  onComplete?(): void;
  titleId?: string;
}) {
  const { text } = useLanguage();
  const [answer, setAnswer] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (answer.trim().length < 8 || !onComplete) return;
    onComplete();
  };

  if (completed) {
    return (
      <div className={`transfer-prompt transfer-prompt--complete${compact ? " transfer-prompt--compact" : ""}`} role="status">
        <strong id={titleId}>{text("Transfer reflection complete", "Réflexion de transfert terminée")}</strong>
        <span>
          {text(
            "Your teacher sees only that you completed it — not your answer.",
            "Ton professeur voit seulement que tu l'as terminée — pas ta réponse.",
          )}
        </span>
      </div>
    );
  }

  return (
    <form
      className={`transfer-prompt${compact ? " transfer-prompt--compact" : ""}`}
      onSubmit={handleSubmit}
    >
      <label htmlFor={compact ? "transfer-answer-rail" : "transfer-answer-card"}>
        <strong id={titleId}>{text("One last thought", "Une dernière réflexion")}</strong>
        <span>
          {text(
            "Where could you reuse one idea from this exercise?",
            "Où pourrais-tu réutiliser une idée de cet exercice ?",
          )}
        </span>
      </label>
      <div>
        <input
          id={compact ? "transfer-answer-rail" : "transfer-answer-card"}
          value={answer}
          maxLength={240}
          placeholder={text("In a new problem, I could…", "Dans un nouveau problème, je pourrais…")}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <button type="submit" disabled={answer.trim().length < 8 || !onComplete}>
          {text("Finish reflection", "Terminer la réflexion")}
        </button>
      </div>
    </form>
  );
}

function MissionScore({ score, compact = false }: { score: number; compact?: boolean }) {
  const { text } = useLanguage();
  return (
    <output
      className={`mission-score${compact ? " mission-score--compact" : ""}`}
      aria-live="polite"
      aria-atomic="true"
      aria-label={text("Exercise XP", "XP de l'exercice")}
    >
      <strong>{score}</strong>
      <span>XP</span>
    </output>
  );
}

function statusCopy(
  status: MissionStatus,
  text: (english: string, french: string) => string,
): string {
  switch (status) {
    case "verified":
      return text(
        `Verified by the workspace · ${VERIFIED_MISSION_XP} XP`,
        `Vérifiée par l'espace de travail · ${VERIFIED_MISSION_XP} XP`,
      );
    case "completed":
      return text(
        `Completed by you · ${COMPLETED_MISSION_XP} XP`,
        `Terminée par toi · ${COMPLETED_MISSION_XP} XP`,
      );
    case "active":
      return text(
        `In progress · +${COMPLETED_MISSION_XP} XP when complete`,
        `En cours · +${COMPLETED_MISSION_XP} XP une fois terminée`,
      );
    case "pending":
      return text("Unlock the previous mission first", "Termine d'abord la mission précédente");
  }
}

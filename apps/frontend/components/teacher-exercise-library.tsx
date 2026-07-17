"use client";

import { useCallback, useEffect, useState } from "react";

import {
  parseTeacherExercisePublication,
  type TeacherExercisePublication,
} from "@/lib/teacher/exercise";
import type { TeacherExercisePublicationV2 } from "@/lib/teacher/geometry-exercise";
import { useLanguage } from "./language-provider";

const LIBRARY_SUBJECT_LABELS_FR: Record<string, string> = {
  mathematics: "mathématiques",
  physics: "physique",
  chemistry: "chimie",
  biology: "biologie",
  history: "histoire",
  geography: "géographie",
  language_arts: "langue et littérature",
  foreign_language: "langue étrangère",
  computer_science: "informatique",
  economics: "économie",
  other: "autre",
};

const LIBRARY_LEVEL_LABELS_FR: Record<string, string> = {
  primary: "primaire",
  middle_school: "collège",
  high_school: "lycée",
  higher_education: "enseignement supérieur",
  adult_learning: "formation adulte",
};

async function readTeacherExercises(): Promise<TeacherExercisePublication[]> {
  const response = await fetch("/api/teacher/exercises", { cache: "no-store" });
  const payload = (await response.json()) as { exercises?: unknown[] };
  if (!response.ok || !Array.isArray(payload.exercises)) throw new Error();
  return payload.exercises.map((exercise) =>
    parseTeacherExercisePublication(exercise),
  );
}

export function TeacherExerciseLibrary({
  onBack,
  onStart,
  initialExercises = [],
}: {
  onBack(): void;
  onStart(exercise: TeacherExercisePublication): void;
  initialExercises?: readonly TeacherExercisePublication[];
}) {
  const { language, text } = useLanguage();
  const french = language === "fr";
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; exercises: TeacherExercisePublication[] }
  >({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({
        status: "ready",
        exercises: mergeExercises(initialExercises, await readTeacherExercises()),
      });
    } catch {
      setState(
        initialExercises.length > 0
          ? { status: "ready", exercises: [...initialExercises] }
          : { status: "error" },
      );
    }
  }, [initialExercises]);

  useEffect(() => {
    let active = true;
    void readTeacherExercises()
      .then((exercises) => {
        if (active) {
          setState({
            status: "ready",
            exercises: mergeExercises(initialExercises, exercises),
          });
        }
      })
      .catch(() => {
        if (!active) return;
        setState(
          initialExercises.length > 0
            ? { status: "ready", exercises: [...initialExercises] }
            : { status: "error" },
        );
      });
    return () => {
      active = false;
    };
  }, [initialExercises]);

  return (
    <section className="teacher-library-screen" aria-labelledby="library-title">
      <div className="teacher-screen-topbar">
        <button type="button" className="screen-back" onClick={onBack}>
          {text("Back home", "Retour à l'accueil")}
        </button>
        <span>{text("Exercises prepared for you", "Exercices préparés pour toi")}</span>
      </div>
      <header className="library-hero">
        <p className="eyebrow">{text("Practice library", "Bibliothèque d'exercices")}</p>
        <h1 id="library-title" tabIndex={-1} data-screen-title>
          {text("Choose what you want to practise.", "Choisis ce que tu veux travailler.")}
        </h1>
        <p>{text("Compass uses your teacher's instructions to help you, without grading you.", "Compass utilise les consignes de ton professeur pour t'aider, sans te noter.")}</p>
      </header>

      {state.status === "loading" ? (
        <div className="library-skeleton" role="status">
          <span />
          <span />
          <span />
          <p>{text("Loading the exercises…", "Chargement des exercices…")}</p>
        </div>
      ) : state.status === "error" ? (
        <div className="library-empty" role="alert">
          <h2>{text("The library is unavailable.", "La bibliothèque est indisponible.")}</h2>
          <button type="button" onClick={() => void load()}>{text("Try again", "Réessayer")}</button>
        </div>
      ) : state.exercises.length === 0 ? (
        <div className="library-empty">
          <span aria-hidden="true">00</span>
          <h2>{text("No exercise has been published yet.", "Aucun exercice n'a encore été publié.")}</h2>
          <p>{text("Ask your teacher to publish one, or bring your own homework from the home screen.", "Demande à ton professeur d'en publier un, ou apporte ton devoir depuis l'accueil.")}</p>
        </div>
      ) : (
        <ol className="teacher-exercise-list">
          {state.exercises.map((exercise, index) => (
            <li key={exercise.id} style={{ "--library-index": index } as React.CSSProperties}>
              <div className="teacher-exercise-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
              <div className="teacher-exercise-copy">
                <div className="teacher-exercise-meta">
                  <span>{publicationSubject(exercise, french)}</span>
                  <span>{publicationLevel(exercise, french)}</span>
                  <span>{exercise.estimatedMinutes} min</span>
                </div>
                <h2>{publicationTitle(exercise)}</h2>
                <p>{publicationObjective(exercise)}</p>
                <small>{publicationMissionCount(exercise)} {text("missions", "missions")}</small>
              </div>
              <button type="button" onClick={() => onStart(exercise)}>
                {text("Start this exercise", "Commencer cet exercice")}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function isGeometryPublication(
  exercise: TeacherExercisePublication,
): exercise is TeacherExercisePublicationV2 {
  return exercise.schemaVersion === "teacher_exercise_publication.v2";
}

function publicationSubject(
  exercise: TeacherExercisePublication,
  french: boolean,
): string {
  if (isGeometryPublication(exercise)) {
    return french ? "géométrie dynamique" : "dynamic geometry";
  }
  const subject = exercise.exercise.subject;
  return french
    ? LIBRARY_SUBJECT_LABELS_FR[subject] ?? subject
    : subject.replaceAll("_", " ");
}

function publicationLevel(
  exercise: TeacherExercisePublication,
  french: boolean,
): string {
  if (isGeometryPublication(exercise)) {
    return exercise.content.exercise.level;
  }
  return french
    ? LIBRARY_LEVEL_LABELS_FR[exercise.level] ?? exercise.level
    : exercise.level.replaceAll("_", " ");
}

function publicationTitle(exercise: TeacherExercisePublication): string {
  return isGeometryPublication(exercise)
    ? exercise.content.exercise.title
    : exercise.exercise.title ?? exercise.theme;
}

function publicationObjective(exercise: TeacherExercisePublication): string {
  return isGeometryPublication(exercise)
    ? exercise.content.exercise.objective
    : exercise.guidance.learningObjective;
}

function publicationMissionCount(exercise: TeacherExercisePublication): number {
  return isGeometryPublication(exercise)
    ? exercise.content.exercise.missions.length
    : exercise.exercise.tasks.length;
}

function mergeExercises(
  preferred: readonly TeacherExercisePublication[],
  remote: readonly TeacherExercisePublication[],
): TeacherExercisePublication[] {
  const byId = new Map<string, TeacherExercisePublication>();
  for (const exercise of remote) byId.set(exercise.id, exercise);
  for (const exercise of preferred) byId.set(exercise.id, exercise);
  return [...byId.values()].sort((left, right) => right.publishedAt - left.publishedAt);
}

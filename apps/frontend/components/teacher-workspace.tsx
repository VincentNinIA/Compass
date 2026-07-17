"use client";

import { useMemo, useState, type FormEvent } from "react";

import {
  GENERAL_EXERCISE_SUBJECTS_V1,
  GeneralExerciseReadyV1,
} from "@/lib/exercise/general-exercise-contracts";
import {
  normalizeTeacherSubject,
  reviewTeacherExerciseDraft,
  TEACHER_EXERCISE_SCHEMA_VERSION,
  TEACHER_LEVELS_V1,
  TeacherExerciseDraftV1,
  TeacherExercisePublicationV1,
  type TeacherExerciseDraftV1 as TeacherExerciseDraft,
  type TeacherReviewCheck,
} from "@/lib/teacher/exercise";
import type { LearningSessionReportV1 } from "@/lib/learning/session-report";
import type { GeometryLearningSessionReportV1 } from "@/lib/geometry-investigation/contracts";
import type { TeacherExercisePublication } from "@/lib/teacher/exercise";
import { GeometryTeacherStudio } from "./geometry-teacher-studio";
import { ClassroomTeacherPanel } from "./classroom-teacher-panel";
import { useLanguage } from "./language-provider";

type DraftMode = "generated" | "upload" | "manual";

const SUBJECT_LABELS_FR: Record<string, string> = {
  mathematics: "Mathématiques",
  physics: "Physique",
  chemistry: "Chimie",
  biology: "Biologie",
  history: "Histoire",
  geography: "Géographie",
  language_arts: "Langue et littérature",
  foreign_language: "Langue étrangère",
  computer_science: "Informatique",
  economics: "Économie",
  other: "Autre",
};

const LEVEL_LABELS_FR: Record<string, string> = {
  primary: "Primaire",
  middle_school: "Collège",
  high_school: "Lycée",
  higher_education: "Enseignement supérieur",
  adult_learning: "Formation adulte",
};

function optionLabel(value: string, french: boolean, frenchLabels: Record<string, string>) {
  return french ? frenchLabels[value] ?? value : value.replaceAll("_", " ");
}

function reviewRoleLabel(role: TeacherReviewCheck["role"], french: boolean) {
  const labels = {
    didactics: ["Step structure", "Structure des étapes"],
    difficulty: ["Support context", "Contexte d'accompagnement"],
    safety: ["Risk wording scan", "Repérage de formulations à risque"],
    cost: ["", ""],
  } as const;
  return labels[role][french ? 1 : 0];
}

function reviewMessage(check: TeacherReviewCheck, french: boolean) {
  const messages = {
    didactics: {
      pass: [
        "Every step is present and no exact duplicate was found.",
        "Chaque étape est présente et aucun doublon exact n'a été trouvé.",
      ],
      warning: [
        "Review the order of the steps.",
        "Relisez l'ordre des étapes.",
      ],
      blocked: [
        "Rewrite or separate repeated steps before sharing.",
        "Reformulez ou séparez les étapes répétées avant de partager.",
      ],
    },
    difficulty: {
      pass: [
        "At least one learner difficulty or support instruction is present.",
        "Au moins une difficulté ou une consigne d'accompagnement est présente.",
      ],
      warning: [
        "Add a common difficulty or explain how Compass should help.",
        "Ajoutez une difficulté fréquente ou précisez comment Compass doit aider.",
      ],
      blocked: [
        "Complete the exercise before checking the support.",
        "Complétez l'exercice avant de vérifier l'accompagnement.",
      ],
    },
    safety: {
      pass: [
        "The local scan found no prompt override or request for secrets.",
        "Le scan local n'a trouvé ni contournement de consigne ni demande de secret.",
      ],
      warning: [
        "Read the wording once more before sharing.",
        "Relisez une dernière fois la formulation avant de partager.",
      ],
      blocked: [
        "Revise the wording highlighted by Compass before sharing.",
        "Revoyez la formulation signalée par Compass avant de partager.",
      ],
    },
    cost: {
      pass: ["", ""],
      warning: ["", ""],
      blocked: ["", ""],
    },
  } as const;
  return messages[check.role][check.status][french ? 1 : 0];
}

export function TeacherWorkspace({
  onBack,
  onOpenLibrary,
  onPublished,
  learningReports = [],
  geometryLearningReports = [],
}: {
  onBack(): void;
  onOpenLibrary(): void;
  onPublished?(publication: TeacherExercisePublication): void;
  learningReports?: readonly LearningSessionReportV1[];
  geometryLearningReports?: readonly GeometryLearningSessionReportV1[];
}) {
  const { language, text } = useLanguage();
  const french = language === "fr";
  const [mode, setMode] = useState<DraftMode>("generated");
  const [subject, setSubject] = useState("mathematics");
  const [level, setLevel] = useState<(typeof TEACHER_LEVELS_V1)[number]>(
    "middle_school",
  );
  const [theme, setTheme] = useState("");
  const [difficulties, setDifficulties] = useState("");
  const [teacherInstructions, setTeacherInstructions] = useState("");
  const [manualTasks, setManualTasks] = useState("");
  const [image, setImage] = useState<File>();
  const [draft, setDraft] = useState<TeacherExerciseDraft>();
  const [status, setStatus] = useState<
    "idle" | "loading" | "ready" | "publishing" | "published" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [publication, setPublication] =
    useState<TeacherExercisePublicationV1>();

  const review = useMemo(
    () => (draft ? reviewTeacherExerciseDraft(draft) : undefined),
    [draft],
  );

  const chooseMode = (nextMode: DraftMode) => {
    setMode(nextMode);
    setMessage("");
    if (status === "error") setStatus(draft ? "ready" : "idle");
  };

  const buildManualDraft = (): TeacherExerciseDraft => {
    const tasks = manualTasks
      .split("\n")
      .map((task) => task.trim())
      .filter(Boolean)
      .slice(0, 8);
    const safeTasks = tasks.length > 0 ? tasks : [theme.trim()];
    const readyExercise = GeneralExerciseReadyV1.parse({
      schemaVersion: "general_exercise.v1",
      outcome: "ready",
      language,
      subject: normalizeTeacherSubject(subject),
      title: theme.trim(),
      statement: theme.trim(),
      tasks: safeTasks,
      concepts: [theme.trim()].filter(Boolean),
      ambiguityCode: null,
      clarificationQuestion: null,
    });
    return TeacherExerciseDraftV1.parse({
      schemaVersion: TEACHER_EXERCISE_SCHEMA_VERSION,
      source: "manual",
      exercise: readyExercise,
      level,
      theme: theme.trim(),
      guidance: {
        learningObjective: text(
          `Understand and apply: ${theme.trim()}`,
          `Comprendre et appliquer : ${theme.trim()}`,
        ),
        teacherInstructions: teacherInstructions.trim(),
        targetDifficulties: splitList(difficulties),
        likelyMisconceptions: splitList(difficulties),
        hintSequence: [
          text(
            "Ask the learner to restate the task in their own words.",
            "Demander à l'élève de reformuler la consigne avec ses mots.",
          ),
        ],
      },
      estimatedMinutes: Math.min(90, Math.max(10, safeTasks.length * 8)),
    });
  };

  const handleDraft = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setPublication(undefined);
    if (mode !== "upload" && !theme.trim()) {
      setStatus("error");
      setMessage(
        text(
          "Describe what your students should work on.",
          "Décrivez ce que vos élèves doivent travailler.",
        ),
      );
      return;
    }
    if (mode === "manual") {
      try {
        setDraft(buildManualDraft());
        setStatus("ready");
      } catch {
        setStatus("error");
        setMessage(
          text(
            "Add at least one complete step.",
            "Ajoutez au moins une étape complète.",
          ),
        );
      }
      return;
    }
    if (mode === "upload" && !image) {
      setStatus("error");
      setMessage(
        text(
          "Choose a photo or scan of the worksheet.",
          "Choisissez une photo ou un scan de la fiche.",
        ),
      );
      return;
    }

    setStatus("loading");
    try {
      const formData = new FormData();
      formData.set("source", mode);
      formData.set("subject", subject);
      formData.set("level", level);
      formData.set("theme", theme);
      formData.set("difficulties", difficulties);
      formData.set("teacherInstructions", teacherInstructions);
      formData.set("language", language);
      if (image) formData.set("image", image);
      const response = await fetch("/api/teacher/draft", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        draft?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error?.message ?? "teacher_draft_failed");
      }
      setDraft(TeacherExerciseDraftV1.parse(payload.draft));
      setStatus("ready");
    } catch {
      setStatus("error");
      setMessage(
        text(
          "Compass couldn't prepare the exercise. Try again or enter it yourself.",
          "Compass n'a pas pu préparer l'exercice. Réessayez ou saisissez-le vous-même.",
        ),
      );
    }
  };

  const handlePublish = async () => {
    if (!draft || !review?.publishable) return;
    setStatus("publishing");
    setMessage("");
    try {
      const response = await fetch("/api/teacher/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const payload = (await response.json()) as {
        publication?: unknown;
      };
      if (!response.ok || !payload.publication) throw new Error();
      const published = TeacherExercisePublicationV1.parse(payload.publication);
      setPublication(published);
      onPublished?.(published);
      setStatus("published");
      setMessage(
        text(
          "Exercise shared. It is now available in the student library.",
          "Exercice partagé. Il est maintenant disponible dans la bibliothèque des élèves.",
        ),
      );
    } catch {
      setStatus("error");
      setMessage(text("The exercise could not be published.", "L'exercice n'a pas pu être publié."));
    }
  };

  return (
    <section className="teacher-screen" aria-labelledby="teacher-title">
      <div className="teacher-screen-topbar">
        <button type="button" className="screen-back" onClick={onBack}>
          {text("Back home", "Retour à l'accueil")}
        </button>
        <span>
          {text(
            "Nothing is shared without your confirmation",
            "Rien n'est partagé sans votre confirmation",
          )}
        </span>
      </div>

      <header className="teacher-hero">
        <p className="eyebrow">{text("Create an exercise", "Préparer un exercice")}</p>
        <h1 id="teacher-title" tabIndex={-1} data-screen-title>
          {text(
            "Prepare an exercise for your students.",
            "Préparez un exercice pour vos élèves.",
          )}
        </h1>
        <p>
          {text(
            "Choose a starting point. Compass prepares a version you can edit before sharing it.",
            "Choisissez un point de départ. Compass prépare une version que vous pourrez modifier avant de la partager.",
          )}
        </p>
      </header>

      <ol className="teacher-howto" aria-label={text("How it works", "Comment ça marche")}>
        <li>
          <span aria-hidden="true">01</span>
          <div>
            <strong>{text("Choose", "Choisissez")}</strong>
            <p>{text("Start from a topic, a worksheet or your own exercise.", "Partez d'un thème, d'une fiche ou de votre propre exercice.")}</p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">02</span>
          <div>
            <strong>{text("Guide", "Précisez")}</strong>
            <p>{text("Tell Compass the level, common difficulties and support to provide.", "Indiquez le niveau, les difficultés fréquentes et l'aide à apporter.")}</p>
          </div>
        </li>
        <li>
          <span aria-hidden="true">03</span>
          <div>
            <strong>{text("Share", "Partagez")}</strong>
            <p>{text("Review every field, then make the exercise available to students.", "Relisez chaque champ, puis rendez l'exercice disponible aux élèves.")}</p>
          </div>
        </li>
      </ol>

      <ClassroomTeacherPanel />

      {learningReports.length > 0 ? (
        <section className="teacher-learning-signals" aria-labelledby="teacher-signals-title">
          <header>
            <div>
              <p className="eyebrow">{text("Learning signals", "Signaux d'apprentissage")}</p>
              <h2 id="teacher-signals-title">
                {text("What happened in this tab", "Ce qui s'est passé dans cet onglet")}
              </h2>
            </div>
            <p>
              {text(
                "Anonymous session facts only: no learner name, answer text, grade or saved history.",
                "Uniquement des faits anonymes de session : aucun nom, texte de réponse, note ou historique enregistré.",
              )}
            </p>
          </header>
          <ol>
            {learningReports.map((report) => (
              <li key={report.exerciseId}>
                <div>
                  <span>
                    {french
                      ? SUBJECT_LABELS_FR[report.subject] ?? report.subject
                      : report.subject.replaceAll("_", " ")}
                  </span>
                  <strong>{report.title}</strong>
                </div>
                <dl>
                  <div>
                    <dt>{text("Missions", "Missions")}</dt>
                    <dd>{report.completedMissions}/{report.totalMissions}</dd>
                  </div>
                  <div>
                    <dt>{text("Verified", "Vérifiées")}</dt>
                    <dd>{report.verifiedMissions}</dd>
                  </div>
                  <div>
                    <dt>{text("Approach notes", "Notes de démarche")}</dt>
                    <dd>{report.reflectedMissions}</dd>
                  </div>
                  <div>
                    <dt>{text("Transfer", "Transfert")}</dt>
                    <dd>{report.transferCompleted ? text("done", "fait") : text("pending", "en attente")}</dd>
                  </div>
                  <div>
                    <dt>XP</dt>
                    <dd>{report.exerciseXp}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {geometryLearningReports.length > 0 ? (
        <section
          className="teacher-learning-signals teacher-geometry-signals"
          aria-labelledby="teacher-geometry-signals-title"
        >
          <header>
            <div>
              <p className="eyebrow">{text("Geometry evidence", "Preuves géométriques")}</p>
              <h2 id="teacher-geometry-signals-title">
                {text("Varignon session facts", "Bilan factuel Varignon")}
              </h2>
            </div>
            <p>
              {text(
                "No learner identity, answer text or grade is included.",
                "Aucune identité, aucun texte de réponse et aucune note ne sont inclus.",
              )}
            </p>
          </header>
          <ol>
            {geometryLearningReports.map((report) => (
              <li key={`${report.exerciseId}-${report.updatedAt}`}>
                <div>
                  <span>{text("Dynamic geometry", "Géométrie dynamique")}</span>
                  <strong>Varignon</strong>
                </div>
                <dl>
                  <div><dt>{text("Missions", "Missions")}</dt><dd>{report.completedMissions}/{report.totalMissions}</dd></div>
                  <div><dt>{text("Verified", "Vérifiées")}</dt><dd>{report.verifiedMissions}</dd></div>
                  <div><dt>{text("Configurations", "Configurations")}</dt><dd>{report.capturedConfigurations.length}/3</dd></div>
                  <div><dt>{text("Midpoints", "Milieux")}</dt><dd>{report.exactMidpoints}/4</dd></div>
                  <div><dt>{text("Parallel facts", "Parallélismes")}</dt><dd>{report.verifiedParallelPairs}/6</dd></div>
                  <div><dt>{text("Highest help", "Aide maximale")}</dt><dd>L{report.assistance.highestLevelUsed}</dd></div>
                  <div><dt>XP</dt><dd>{report.exerciseXp}</dd></div>
                </dl>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <GeometryTeacherStudio onPublished={onPublished} />

      <div className="teacher-layout">
        <form className="teacher-brief" onSubmit={handleDraft}>
          <fieldset className="teacher-mode-switch">
            <legend>{text("How would you like to start?", "Comment souhaitez-vous commencer ?")}</legend>
            {(["generated", "upload", "manual"] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-active={mode === value ? "true" : "false"}
                onClick={() => chooseMode(value)}
              >
                {value === "generated"
                  ? text("From a topic", "À partir d'un thème")
                  : value === "upload"
                    ? text("From a worksheet", "À partir d'une fiche")
                    : text("Write it myself", "Je le saisis")}
              </button>
            ))}
          </fieldset>

          <div className="teacher-field-grid">
            <label>
              <span>{text("Subject", "Matière")}</span>
              <select value={subject} onChange={(event) => setSubject(event.target.value)}>
                {GENERAL_EXERCISE_SUBJECTS_V1.filter((value) => value !== "unknown").map(
                  (value) => <option key={value} value={value}>{optionLabel(value, french, SUBJECT_LABELS_FR)}</option>,
                )}
              </select>
            </label>
            <label>
              <span>{text("Class level", "Niveau de la classe")}</span>
              <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
                {TEACHER_LEVELS_V1.map((value) => (
                  <option key={value} value={value}>{optionLabel(value, french, LEVEL_LABELS_FR)}</option>
                ))}
              </select>
            </label>
          </div>

          <label>
            <span>
              {mode === "upload"
                ? text("Optional context", "Contexte facultatif")
                : mode === "manual"
                  ? text("Exercise title or instructions", "Titre ou consigne générale")
                  : text("What should students practise?", "Que doivent travailler vos élèves ?")}
            </span>
            <textarea
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
              maxLength={240}
              required={mode !== "upload"}
              placeholder={
                mode === "upload"
                  ? text("For example: revision before the test", "Par exemple : révision avant l'évaluation")
                  : mode === "manual"
                    ? text("For example: Compare two fractions and explain your method", "Par exemple : comparer deux fractions et expliquer sa méthode")
                    : text("For example: Add fractions with different denominators", "Par exemple : additionner des fractions de dénominateurs différents")
              }
            />
            <small>
              {mode === "upload"
                ? text("Compass will read the worksheet. Add context only if it helps.", "Compass lira la fiche. Ajoutez un contexte seulement s'il est utile.")
                : text("Name one precise skill or learning goal.", "Indiquez une compétence ou un objectif précis.")}
            </small>
          </label>
          <label>
            <span>{text("Where do they usually get stuck?", "Où rencontrent-ils des difficultés ?")}</span>
            <textarea
              value={difficulties}
              onChange={(event) => setDifficulties(event.target.value)}
              maxLength={1_200}
              placeholder={text("For example: They compare the denominators directly", "Par exemple : ils comparent directement les dénominateurs")}
            />
            <small>{text("Add one common difficulty per line. This field is optional.", "Ajoutez une difficulté fréquente par ligne. Ce champ est facultatif.")}</small>
          </label>
          <label>
            <span>{text("How should Compass support them?", "Comment Compass doit-il les accompagner ?")}</span>
            <textarea
              value={teacherInstructions}
              onChange={(event) => setTeacherInstructions(event.target.value)}
              maxLength={1_200}
              placeholder={text("For example: Ask for an explanation before giving a hint", "Par exemple : demander une explication avant de donner un indice")}
            />
            <small>{text("Describe the method, tone or type of help you prefer. Optional.", "Précisez la méthode, le ton ou le type d'aide souhaité. Facultatif.")}</small>
          </label>

          {mode === "upload" ? (
            <label>
              <span>{text("Choose the worksheet", "Choisissez la fiche")}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0])} />
              <small>{text("Use a clear photo or scan showing the complete exercise.", "Utilisez une photo ou un scan net montrant l'exercice en entier.")}</small>
            </label>
          ) : null}
          {mode === "manual" ? (
            <label>
              <span>{text("Steps students must complete", "Étapes à réaliser par les élèves")}</span>
              <textarea
                value={manualTasks}
                onChange={(event) => setManualTasks(event.target.value)}
                maxLength={4_000}
                placeholder={text("One step per line", "Une étape par ligne")}
              />
              <small>{text("Write the steps in the order students should follow them.", "Écrivez les étapes dans l'ordre attendu.")}</small>
            </label>
          ) : null}
          <button className="teacher-primary-action" type="submit" disabled={status === "loading"}>
            {status === "loading"
              ? text("Compass is preparing the exercise…", "Compass prépare l'exercice…")
              : mode === "manual"
                ? text("Preview my exercise", "Prévisualiser mon exercice")
                : mode === "upload"
                  ? text("Prepare this worksheet", "Préparer cette fiche")
                  : text("Create this exercise", "Créer cet exercice")}
          </button>
          {status === "error" && mode !== "manual" ? (
            <button type="button" className="teacher-fallback-action" onClick={() => chooseMode("manual")}>
              {text("Enter it myself", "Le saisir moi-même")}
            </button>
          ) : null}
          {message ? <p className="teacher-message" role="status">{message}</p> : null}
        </form>

        <div className="teacher-draft-panel" aria-live="polite">
          {draft ? (
            <>
              <div className="teacher-draft-heading">
                <p>{text("Review before sharing", "Relisez avant de partager")}</p>
                <span>
                  {draft.source === "manual"
                    ? text("written by you", "saisi par vous")
                    : draft.source === "upload"
                      ? text("from your worksheet", "depuis votre fiche")
                      : text("from your topic", "depuis votre thème")}
                </span>
              </div>
              <label>
                <span>{text("Title", "Titre")}</span>
                <input value={draft.exercise.title ?? ""} onChange={(event) => setDraft({ ...draft, exercise: { ...draft.exercise, title: event.target.value } })} />
              </label>
              <label>
                <span>{text("Instructions for students", "Consigne donnée aux élèves")}</span>
                <textarea value={draft.exercise.statement} onChange={(event) => setDraft({ ...draft, exercise: { ...draft.exercise, statement: event.target.value } })} />
              </label>
              <label>
                <span>{text("Steps, one per line", "Étapes, une par ligne")}</span>
                <textarea value={draft.exercise.tasks.join("\n")} onChange={(event) => setDraft({ ...draft, exercise: { ...draft.exercise, tasks: event.target.value.split("\n").map((task) => task.trim()).filter(Boolean) } })} />
              </label>
              <label>
                <span>{text("What students will learn", "Ce que les élèves vont apprendre")}</span>
                <textarea value={draft.guidance.learningObjective} onChange={(event) => setDraft({ ...draft, guidance: { ...draft.guidance, learningObjective: event.target.value } })} />
              </label>

              <ul className="teacher-review-list" aria-label={text("Readiness checklist", "Vérifications avant partage")}>
                {review?.checks.filter((check) => check.role !== "cost").map((check) => (
                  <li key={check.role} data-status={check.status}>
                    <strong>{reviewRoleLabel(check.role, french)}</strong>
                    <span>{reviewMessage(check, french)}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="teacher-publish-action" disabled={!review?.publishable || status === "publishing"} onClick={handlePublish}>
                {status === "publishing" ? text("Sharing…", "Partage…") : text("Share with students", "Partager avec les élèves")}
              </button>
              {publication ? (
                <button type="button" className="teacher-library-action" onClick={onOpenLibrary}>
                  {text("See it in the student library", "Voir dans la bibliothèque des élèves")}
                </button>
              ) : null}
            </>
          ) : (
            <div className="teacher-draft-empty">
              <span aria-hidden="true">01</span>
              <h2>{text("Your exercise will appear here for review.", "Votre exercice apparaîtra ici pour relecture.")}</h2>
              <p>{text("Complete the form. You can edit every field before sharing.", "Complétez le formulaire. Vous pourrez modifier chaque champ avant de partager.")}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function splitList(value: string): string[] {
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  TutorWorkspace,
  type TutorWorkspaceScreen,
} from "@/components/tutor-workspace";
import { useLanguage } from "@/components/language-provider";
import { CompassMascot, MascotProvider } from "@/components/compass-mascot";
import { TeacherExerciseLibrary } from "@/components/teacher-exercise-library";
import { TeacherWorkspace } from "@/components/teacher-workspace";
import { GeometryPublishedWorkspace } from "@/components/geometry-published-workspace";
import {
  parseTeacherExercisePublication,
  type TeacherExercisePublication,
} from "@/lib/teacher/exercise";
import type { LearningSessionReportV1 } from "@/lib/learning/session-report";
import {
  GeometryLearningSessionReportV1,
  type GeometryLearningSessionReportV1 as GeometryLearningReport,
} from "@/lib/geometry-investigation/contracts";

type AppScreen = "landing" | "teacher" | "library" | TutorWorkspaceScreen;

function LearningPlayground({ french }: { french: boolean }) {
  return (
    <div className="hero-playground" aria-hidden="true">
      <div className="playground-note playground-note-top">
        {french ? "ta question" : "your question"}
      </div>
      <svg viewBox="0 0 520 520" role="presentation">
        <path className="playground-orbit" d="M68 350C144 98 382 90 454 286" />
        <path className="playground-guide" d="M112 390C190 318 284 258 410 174" />
        <path className="playground-line" d="M120 202C220 232 310 328 404 404" />
        <circle className="playground-point" cx="120" cy="202" r="14" />
        <circle className="playground-point" cx="404" cy="404" r="14" />
        <circle className="playground-midpoint" cx="260" cy="302" r="10" />
        <text x="76" y="186">∑</text>
        <text x="410" y="438">Aa</text>
        <text x="272" y="332">?</text>
      </svg>
      <div className="playground-equation">
        <span>{french ? "comprendre" : "understand"}</span>
        <strong>→</strong>
        <span>{french ? "essayer" : "try"}</span>
      </div>
      <div className="playground-note playground-note-bottom">
        {french ? "demande · essaie · explique" : "ask · try · explain"}
      </div>
    </div>
  );
}

export default function Home() {
  const { language, text, toggleLanguage } = useLanguage();
  const french = language === "fr";
  const specialistGeometryMode = useSyncExternalStore(
    () => () => undefined,
    () =>
      new URLSearchParams(window.location.search).get("specialist") ===
      "geometry",
    () => false,
  );
  const workspaceDemoMode = useSyncExternalStore(
    () => () => undefined,
    () => ["geogebra", "gamification"].includes(
      new URLSearchParams(window.location.search).get("demo") ?? "",
    ),
    () => false,
  );
  const [screen, setScreen] = useState<AppScreen>("landing");
  const [assignedExercise, setAssignedExercise] =
    useState<TeacherExercisePublication>();
  const [localPublications, setLocalPublications] = useState<
    readonly TeacherExercisePublication[]
  >([]);
  const [learningReports, setLearningReports] = useState<
    readonly LearningSessionReportV1[]
  >([]);
  const [geometryLearningReports, setGeometryLearningReports] = useState<
    readonly GeometryLearningReport[]
  >([]);
  const visibleScreen = workspaceDemoMode ? "work" : screen;
  const mainRef = useRef<HTMLElement>(null);
  const hasMountedScreenRef = useRef(false);

  useEffect(() => {
    if (!hasMountedScreenRef.current) {
      hasMountedScreenRef.current = true;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (!window.navigator.userAgent.includes("jsdom")) {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      mainRef.current
        ?.querySelector<HTMLElement>("[data-screen-title]")
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visibleScreen]);

  const rememberPublication = useCallback(
    (publication: TeacherExercisePublication) => {
      setLocalPublications((current) => [
        publication,
        ...current.filter((exercise) => exercise.id !== publication.id),
      ]);
    },
    [],
  );

  const rememberGeometryLearningReport = useCallback(
    (report: GeometryLearningReport) => {
      setGeometryLearningReports((current) =>
        [
          report,
          ...current.filter((entry) => entry.exerciseId !== report.exerciseId),
        ]
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, 8),
      );
    },
    [],
  );

  const handleGeometryLearningReport = useCallback(
    (report: GeometryLearningReport) => {
      rememberGeometryLearningReport(report);
      if (typeof BroadcastChannel === "undefined") return;
      const channel = new BroadcastChannel(
        "compass-geometry-learning-reports",
      );
      channel.postMessage(report);
      channel.close();
    },
    [rememberGeometryLearningReport],
  );

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("compass-geometry-learning-reports");
    channel.onmessage = (event) => {
      const parsed = GeometryLearningSessionReportV1.safeParse(event.data);
      if (parsed.success) rememberGeometryLearningReport(parsed.data);
    };
    return () => channel.close();
  }, [rememberGeometryLearningReport]);

  useEffect(() => {
    const publicationId = new URLSearchParams(window.location.search).get(
      "teacherExercise",
    );
    if (!publicationId) return;
    let active = true;
    void fetch("/api/teacher/exercises", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("teacher_catalog_unavailable");
        return (await response.json()) as { exercises?: unknown[] };
      })
      .then((payload) => {
        const publication = (payload.exercises ?? [])
          .map((candidate) => parseTeacherExercisePublication(candidate))
          .find(({ id }) => id === publicationId);
        if (!active || !publication) return;
        setAssignedExercise(publication);
        setScreen("work");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const rememberLearningReport = useCallback(
    (report: LearningSessionReportV1) => {
      setLearningReports((current) =>
        [report, ...current.filter((entry) => entry.exerciseId !== report.exerciseId)]
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, 8),
      );
    },
    [],
  );

  const journeySteps = [
    {
      number: "01",
      label: text("Add your exercise", "Ajoute ton exercice"),
      detail: text(
        "Snap the question or choose a photo.",
        "Photographie l'énoncé ou choisis une image.",
      ),
    },
    {
      number: "02",
      label: text("Check the reading", "Vérifie la lecture"),
      detail: text(
        "Confirm the statement and every task before starting.",
        "Confirme l'énoncé et chaque consigne avant de commencer.",
      ),
    },
    {
      number: "03",
      label: text("Work with Compass", "Travaille avec Compass"),
      detail: text(
        "Keep the coach, the tasks and the useful workspace together.",
        "Garde le coach, les consignes et l'atelier utile au même endroit.",
      ),
    },
  ];
  const progress = [
    text("Home", "Accueil"),
    text("Photo", "Photo"),
    text("Check", "Vérification"),
    text("Workspace", "Atelier"),
  ];
  const activeStep = specialistGeometryMode
    ? 3
    : ({ landing: 0, upload: 1, confirm: 2, work: 3 } as Partial<
        Record<AppScreen, number>
      >)[visibleScreen] ?? -1;
  const showLanding = visibleScreen === "landing" || specialistGeometryMode;

  const goHome = () => {
    setAssignedExercise(undefined);
    setScreen("landing");
  };

  return (
    <>
      <a className="skip-link" href="#main-content">
        {text("Skip to your exercise", "Aller directement à ton exercice")}
      </a>

      <header className="site-header">
        <button
          type="button"
          className="brand"
          onClick={goHome}
          aria-label={text("Compass home", "Accueil Compass")}
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Compass</span>
        </button>
        <nav
          className="screen-progress"
          aria-label={text("Learning progress", "Progression du parcours")}
        >
          <ol>
            {progress.map((label, index) => (
              <li
                key={label}
                data-active={index === activeStep ? "true" : "false"}
                data-complete={index < activeStep ? "true" : "false"}
                aria-current={index === activeStep ? "step" : undefined}
              >
                <span aria-hidden="true">{index + 1}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </nav>
        <div className="header-actions">
          <p className="header-tagline">
            {text("Made for curious minds", "Pour les esprits curieux")}
          </p>
          <button
            type="button"
            className="teacher-access"
            data-active={visibleScreen === "teacher" ? "true" : "false"}
            onClick={() => setScreen("teacher")}
          >
            {text("Professor", "Professeur")}
          </button>
          <button
            type="button"
            className="language-switch"
            onClick={toggleLanguage}
            aria-label={text("Passer en français", "Switch to English")}
            title={text("Passer en français", "Switch to English")}
          >
            <span aria-hidden="true">{french ? "🇬🇧" : "🇫🇷"}</span>
            <span>{french ? "EN" : "FR"}</span>
          </button>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} ref={mainRef}>
        {visibleScreen === "landing" && !specialistGeometryMode ? (
          <MascotProvider>
            <CompassMascot />
          </MascotProvider>
        ) : null}
        {showLanding ? (
          <>
        <section className="hero" id="top" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">
              {text("Your study buddy for every subject", "Ton partenaire dans toutes les matières")}
            </p>
            <h1 id="page-title" tabIndex={-1} data-screen-title>
              {text(
                "Bring the exercise. Find your own way through it.",
                "Apporte l'exercice. Trouve ton chemin pour le comprendre.",
              )}
            </h1>
            <p className="lede">
              {text(
                "Maths, languages, history or science: Compass guides every step. Automatic checks appear only when a compatible specialist workspace is available.",
                "Maths, langues, histoire ou sciences : Compass guide chaque étape. Les vérifications automatiques apparaissent seulement lorsqu'un atelier spécialisé compatible existe.",
              )}
            </p>
            <div className="hero-student-paths" aria-label={text("Choose your starting point", "Choisis ton point de départ")}>
              <button
                type="button"
                className="primary-link"
                onClick={() => {
                  setAssignedExercise(undefined);
                  setScreen("upload");
                }}
              >
                <small>{text("I have homework", "Je viens faire un devoir")}</small>
                <strong>{text("Add my exercise", "Ajouter mon exercice")}</strong>
                <span>{text("Take or choose a photo", "Prendre ou choisir une photo")}</span>
              </button>
              <button
                type="button"
                className="student-library-link"
                onClick={() => setScreen("library")}
              >
                <small>{text("I want to practise", "Je viens m'entraîner")}</small>
                <strong>{text("Teacher exercises", "Exercices du professeur")}</strong>
                <span>{text("Choose from the shared library", "Choisir dans la bibliothèque partagée")}</span>
              </button>
            </div>
            <ul
              className="hero-reassurance"
              aria-label={text("What to expect", "Ce qui t'attend")}
            >
              <li>{text("Your work stays yours", "Ton travail reste le tien")}</li>
              <li>{text("Ask for a hint anytime", "Demande un indice à tout moment")}</li>
              <li>{text("Learn at your pace", "Apprends à ton rythme")}</li>
            </ul>
          </div>
          <LearningPlayground french={french} />
        </section>

        <section className="journey" aria-labelledby="journey-title">
          <div className="journey-heading">
            <p className="eyebrow">{text("A simple path", "Un parcours simple")}</p>
            <h2 id="journey-title">
              {text("From “I’m stuck” to “I get it”.", "De « je bloque » à « j'ai compris ».")}
            </h2>
          </div>
          <ol>
            {journeySteps.map((step) => (
              <li key={step.number}>
                <span className="journey-number">{step.number}</span>
                <div>
                  <h3>{step.label}</h3>
                  <p>{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
            {specialistGeometryMode ? <TutorWorkspace /> : null}
          </>
        ) : visibleScreen === "teacher" ? (
          <TeacherWorkspace
            onBack={goHome}
            onOpenLibrary={() => setScreen("library")}
            onPublished={rememberPublication}
            learningReports={learningReports}
            geometryLearningReports={geometryLearningReports}
          />
        ) : visibleScreen === "library" ? (
          <TeacherExerciseLibrary
            onBack={goHome}
            initialExercises={localPublications}
            onStart={(exercise) => {
              setAssignedExercise(exercise);
              setScreen("work");
            }}
          />
        ) : assignedExercise?.schemaVersion ===
          "teacher_exercise_publication.v2" ? (
          <GeometryPublishedWorkspace
            publication={assignedExercise}
            onHome={goHome}
            onReport={handleGeometryLearningReport}
          />
        ) : (
          <TutorWorkspace
            key={assignedExercise?.id ?? "student-upload"}
            assignedExercise={assignedExercise}
            screen={visibleScreen}
            onScreenChange={(nextScreen) => setScreen(nextScreen)}
            onHome={goHome}
            onLearningReport={rememberLearningReport}
          />
        )}
      </main>

      {showLanding ? (
      <footer className="presentation-footer" aria-labelledby="prototype-title">
        <div>
          <a className="brand brand-footer" href="#top">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>Compass</span>
          </a>
          <h2 id="prototype-title">
            {text("Keep wondering. Keep trying.", "Continue à chercher. Continue à essayer.")}
          </h2>
        </div>
        <div>
          <p>
            {text(
              "Compass keeps GeoGebra available for verified geometry modules in this non-commercial prototype. Commercial use requires a separate GeoGebra agreement.",
              "Compass conserve GeoGebra pour les modules de géométrie vérifiés de ce prototype non commercial. Un usage commercial exige un accord GeoGebra distinct.",
            )}
          </p>
          <p>
            <a href="https://www.geogebra.org/">GeoGebra</a>
            {" · "}
            <a href="https://www.geogebra.org/license">
              {text("License and attribution", "Licence et attribution")}
            </a>
          </p>
          <p>
            {text(
              "Live voice requires HTTPS and microphone permission. If voice is not available, you can use live text or keep learning locally.",
              "La voix en direct exige HTTPS et l'autorisation du microphone. Si elle n'est pas disponible, utilise le texte en direct ou continue localement.",
            )}
          </p>
        </div>
      </footer>
      ) : null}
    </>
  );
}

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
import { ClassroomJoin } from "@/components/classroom-join";
import {
  parseTeacherExercisePublication,
  type TeacherExercisePublication,
} from "@/lib/teacher/exercise";
import type { LearningSessionReportV1 } from "@/lib/learning/session-report";
import {
  GeometryLearningSessionReportV1,
  type GeometryLearningSessionReportV1 as GeometryLearningReport,
} from "@/lib/geometry-investigation/contracts";
import { createDemoVarignonPublicationV2 } from "@/lib/teacher/geometry-exercise";

type AppScreen =
  | "landing"
  | "teacher"
  | "library"
  | "classroom_join"
  | TutorWorkspaceScreen;

function LearningPlayground({ french }: { french: boolean }) {
  return (
    <div className="hero-playground" aria-hidden="true">
      <div className="playground-note playground-note-top">
        {french ? "quadrilatère libre" : "free quadrilateral"}
      </div>
      <svg viewBox="0 0 520 520" role="presentation">
        <path className="playground-orbit" d="M82 362C138 104 390 78 452 302" />
        <path className="playground-line" d="M112 154L416 196L348 414L92 344Z" />
        <path className="playground-guide" d="M264 175L382 305L220 379L102 249Z" />
        {[
          [112, 154, "A"],
          [416, 196, "B"],
          [348, 414, "C"],
          [92, 344, "D"],
        ].map(([cx, cy, label]) => (
          <g key={label}>
            <circle className="playground-point" cx={cx} cy={cy} r="13" />
            <text x={Number(cx) + 14} y={Number(cy) - 12}>{label}</text>
          </g>
        ))}
        {[
          [264, 175, "E"],
          [382, 305, "F"],
          [220, 379, "G"],
          [102, 249, "H"],
        ].map(([cx, cy, label]) => (
          <g key={label}>
            <circle className="playground-midpoint" cx={cx} cy={cy} r="10" />
            <text x={Number(cx) + 12} y={Number(cy) - 10}>{label}</text>
          </g>
        ))}
      </svg>
      <div className="playground-equation">
        <span>{french ? "observer" : "observe"}</span>
        <strong>→</strong>
        <span>{french ? "conjecturer" : "conjecture"}</span>
      </div>
      <div className="playground-note playground-note-bottom">
        {french ? "construis · déplace · justifie" : "build · drag · justify"}
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
  const entryScreen = useSyncExternalStore<AppScreen | undefined>(
    () => () => undefined,
    () => {
      const entry = new URLSearchParams(window.location.search).get("entry");
      if (entry === "upload") return "upload";
      if (entry === "classroom") return "classroom_join";
      return undefined;
    },
    () => undefined,
  );
  const [screen, setScreen] = useState<AppScreen>("landing");
  const [entryDismissed, setEntryDismissed] = useState(false);
  const [assignedExercise, setAssignedExercise] =
    useState<TeacherExercisePublication>();
  const [assignedFromClass, setAssignedFromClass] = useState(false);
  const [localPublications, setLocalPublications] = useState<
    readonly TeacherExercisePublication[]
  >([]);
  const [learningReports, setLearningReports] = useState<
    readonly LearningSessionReportV1[]
  >([]);
  const [geometryLearningReports, setGeometryLearningReports] = useState<
    readonly GeometryLearningReport[]
  >([]);
  const visibleScreen = workspaceDemoMode
    ? "work"
    : !entryDismissed && screen === "landing" && entryScreen
      ? entryScreen
      : screen;
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
  const showProgress =
    specialistGeometryMode ||
    (!assignedExercise && ["upload", "confirm", "work"].includes(visibleScreen));

  const goHome = () => {
    setAssignedExercise(undefined);
    setAssignedFromClass(false);
    setEntryDismissed(true);
    setScreen("landing");
  };

  const returnToClass = () => {
    setAssignedExercise(undefined);
    setAssignedFromClass(false);
    setScreen("classroom_join");
  };

  const startDemoActivity = () => {
    setAssignedExercise(createDemoVarignonPublicationV2(language));
    setAssignedFromClass(false);
    setScreen("work");
  };

  const isDirectDemoExercise = assignedExercise?.id.startsWith(
    "teacher_varignon-demo-v1-",
  );

  return (
    <>
      <a className="skip-link" href="#main-content">
        {text("Skip to your exercise", "Aller directement à ton exercice")}
      </a>

      <header className={`site-header${showProgress ? "" : " site-header--simple"}`}>
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
        {showProgress ? (
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
        ) : null}
        <div className="header-actions">
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
        <section className={`hero${specialistGeometryMode ? "" : " hero--demo"}`} id="top" aria-labelledby="page-title">
          <div className="hero-copy">
            {specialistGeometryMode ? (
              <>
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
                className="classroom-join-link"
                onClick={() => setScreen("classroom_join")}
              >
                <small>{text("My teacher sent a code", "Mon professeur m'a donné un code")}</small>
                <strong>{text("Join my class", "Rejoindre ma classe")}</strong>
                <span>{text("Use a pseudonym — no email", "Avec un pseudonyme — sans e-mail")}</span>
              </button>
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
              </>
            ) : (
              <>
                <p className="eyebrow">
                  {text("An activity from your teacher", "Un exercice de ton professeur")}
                </p>
                <h1 id="page-title" tabIndex={-1} data-screen-title>
                  {text("Build. Observe. Prove.", "Construis. Observe. Prouve.")}
                </h1>
                <p className="lede">
                  {text(
                    "Explore Varignon’s theorem directly in GeoGebra. Move the figure, test your conjecture and build the proof with Compass.",
                    "Explore le théorème de Varignon directement dans GeoGebra. Déplace la figure, teste ta conjecture et construis la preuve avec Compass.",
                  )}
                </p>
                <div className="demo-primary-action">
                  <button type="button" className="demo-start-button" onClick={startDemoActivity}>
                    <span>
                      <small>{text("Guided investigation", "Investigation guidée")}</small>
                      <strong>{text("Start the exercise", "Commencer l’exercice")}</strong>
                    </span>
                    <b aria-hidden="true">→</b>
                  </button>
                  <p>{text("No account. No class code.", "Sans compte. Sans code de classe.")}</p>
                </div>
                <ul className="demo-facts" aria-label={text("Activity details", "Détails de l’activité")}>
                  <li>{text("9 missions", "9 missions")}</li>
                  <li>GeoGebra</li>
                  <li>{text("About 35 minutes", "Environ 35 minutes")}</li>
                </ul>
              </>
            )}
          </div>
          <LearningPlayground french={french} />
        </section>

        {specialistGeometryMode ? <section className="journey" aria-labelledby="journey-title">
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
        </section> : null}
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
        ) : visibleScreen === "classroom_join" ? (
          <ClassroomJoin
            onBack={goHome}
            onStart={(publication) => {
              setAssignedExercise(publication);
              setAssignedFromClass(true);
              setScreen("work");
            }}
          />
        ) : visibleScreen === "library" ? (
          <TeacherExerciseLibrary
            onBack={goHome}
            initialExercises={localPublications}
            onStart={(exercise) => {
              setAssignedExercise(exercise);
              setAssignedFromClass(false);
              setScreen("work");
            }}
          />
        ) : assignedExercise?.schemaVersion ===
          "teacher_exercise_publication.v2" ? (
          <GeometryPublishedWorkspace
            publication={assignedExercise}
            onHome={assignedFromClass ? returnToClass : goHome}
            returnLabel={
              assignedFromClass
                ? text("Back to my class", "Retour à ma classe")
                : isDirectDemoExercise
                  ? text("Back to the demo", "Retour à la démo")
                : undefined
            }
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

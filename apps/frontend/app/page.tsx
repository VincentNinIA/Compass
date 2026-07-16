"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  TutorWorkspace,
  type TutorWorkspaceScreen,
} from "@/components/tutor-workspace";
import { useLanguage } from "@/components/language-provider";
import { CompassMascot, MascotProvider } from "@/components/compass-mascot";

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
  const panoramaDemoMode = useSyncExternalStore(
    () => () => undefined,
    () => new URLSearchParams(window.location.search).get("demo") === "geogebra",
    () => false,
  );
  const [screen, setScreen] = useState<"landing" | TutorWorkspaceScreen>(
    "landing",
  );
  const visibleScreen = panoramaDemoMode ? "work" : screen;
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (visibleScreen === "landing") return;
    const frame = window.requestAnimationFrame(() => {
      mainRef.current
        ?.querySelector<HTMLElement>("[data-screen-title]")
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visibleScreen]);

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
    : { landing: 0, upload: 1, confirm: 2, work: 3 }[visibleScreen];
  const showLanding = visibleScreen === "landing" || specialistGeometryMode;

  const goHome = () => setScreen("landing");

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
            <h1 id="page-title">
              {text(
                "Bring the exercise. Find your own way through it.",
                "Apporte l'exercice. Trouve ton chemin pour le comprendre.",
              )}
            </h1>
            <p className="lede">
              {text(
                "Maths, languages, history or science: Compass reads the question, keeps every step and helps without giving away the answer.",
                "Maths, langues, histoire ou sciences : Compass lit l'énoncé, garde chaque étape et t'aide sans te donner la réponse.",
              )}
            </p>
            <div className="hero-actions">
              <a
                className="primary-link"
                href="#exercise-photo-title"
                onClick={() => setScreen("upload")}
              >
                {text("Add my exercise", "Ajouter mon exercice")}
              </a>
              <span>{text("One photo. No account.", "Une photo. Aucun compte.")}</span>
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
        ) : (
          <TutorWorkspace
            screen={visibleScreen}
            onScreenChange={setScreen}
            onHome={goHome}
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

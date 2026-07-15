"use client";

import { TutorWorkspace } from "@/components/tutor-workspace";
import { useLanguage } from "@/components/language-provider";

function GeometryPlayground({ french }: { french: boolean }) {
  return (
    <div className="hero-playground" aria-hidden="true">
      <div className="playground-note playground-note-top">
        {french ? "à toi" : "your turn"}
      </div>
      <svg viewBox="0 0 520 520" role="presentation">
        <path className="playground-orbit" d="M74 348C145 124 365 82 452 286" />
        <path className="playground-guide" d="M116 390L407 174" />
        <path className="playground-line" d="M118 201L404 404" />
        <circle className="playground-point" cx="118" cy="201" r="14" />
        <circle className="playground-point" cx="404" cy="404" r="14" />
        <circle className="playground-midpoint" cx="260" cy="302" r="10" />
        <path className="playground-angle" d="M248 286L265 273L278 290" />
        <text x="86" y="188">A</text>
        <text x="417" y="430">B</text>
        <text x="279" y="326">M</text>
      </svg>
      <div className="playground-equation">
        <span>PA</span>
        <strong>=</strong>
        <span>PB</span>
      </div>
      <div className="playground-note playground-note-bottom">
        {french ? "essaie · bouge · observe" : "try · move · see"}
      </div>
    </div>
  );
}

export default function Home() {
  const { language, text, toggleLanguage } = useLanguage();
  const french = language === "fr";
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
      label: text("Build it yourself", "Construis par toi-même"),
      detail: text(
        "Draw in GeoGebra while your tutor follows along.",
        "Construis dans GeoGebra pendant que ton tuteur te suit.",
      ),
    },
    {
      number: "03",
      label: text("Make it click", "Comprends vraiment"),
      detail: text(
        "Test your idea, explain it and keep the insight.",
        "Teste ton idée, explique-la et retiens l'essentiel.",
      ),
    },
  ];

  return (
    <>
      <a className="skip-link" href="#main-content">
        {text("Skip to your exercise", "Aller directement à ton exercice")}
      </a>

      <header className="site-header">
        <a
          className="brand"
          href="#top"
          aria-label={text("Compass home", "Accueil Compass")}
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Compass</span>
        </a>
        <nav aria-label={text("Main navigation", "Navigation principale")}>
          <a href="#exercise-photo-title">{text("Start", "Démarrer")}</a>
          <a href="#geogebra-spike-title">{text("Workspace", "Atelier")}</a>
          <a href="#realtime-spike-title">{text("Your coach", "Ton coach")}</a>
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

      <main id="main-content" tabIndex={-1}>
        <section className="hero" id="top" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span aria-hidden="true">✦</span>{" "}
              {text("Your geometry study buddy", "Ton partenaire en géométrie")}
            </p>
            <h1 id="page-title">
              {text(
                "Geometry clicks when you can play with it.",
                "La géométrie devient claire quand tu peux la manipuler.",
              )}
            </h1>
            <p className="lede">
              {text(
                "Bring one exercise. Compass helps you build, test and understand it — without giving away the answer.",
                "Apporte un exercice. Compass t'aide à construire, tester et comprendre — sans te donner la réponse.",
              )}
            </p>
            <div className="hero-actions">
              <a className="primary-link" href="#exercise-photo-title">
                {text("Add my exercise", "Ajouter mon exercice")}{" "}
                <span aria-hidden="true">↘</span>
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
          <GeometryPlayground french={french} />
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

        <TutorWorkspace />
      </main>

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
            {text("Keep wondering. Keep drawing.", "Continue à chercher. Continue à construire.")}
          </h2>
        </div>
        <div>
          <p>
            {text(
              "Compass embeds GeoGebra Geometry for this non-commercial prototype. Commercial use requires a separate GeoGebra agreement.",
              "Compass intègre GeoGebra Geometry dans ce prototype non commercial. Un usage commercial exige un accord GeoGebra distinct.",
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
    </>
  );
}

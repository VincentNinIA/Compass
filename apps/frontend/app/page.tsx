import { TutorWorkspace } from "@/components/tutor-workspace";

const journeySteps = [
  {
    number: "01",
    label: "Add your exercise",
    detail: "Snap the question or choose a photo.",
  },
  {
    number: "02",
    label: "Build it yourself",
    detail: "Draw in GeoGebra while your tutor follows along.",
  },
  {
    number: "03",
    label: "Make it click",
    detail: "Test your idea, explain it and keep the insight.",
  },
] as const;

function GeometryPlayground() {
  return (
    <div className="hero-playground" aria-hidden="true">
      <div className="playground-note playground-note-top">your turn</div>
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
      <div className="playground-note playground-note-bottom">try · move · see</div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to your exercise
      </a>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="GeoTutor home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>GeoTutor</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#exercise-photo-title">Start</a>
          <a href="#geogebra-spike-title">Workspace</a>
          <a href="#realtime-spike-title">Your coach</a>
        </nav>
        <p>Made for curious minds</p>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="hero" id="top" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span aria-hidden="true">✦</span> Your geometry study buddy
            </p>
            <h1 id="page-title">Geometry clicks when you can play with it.</h1>
            <p className="lede">
              Bring one exercise. GeoTutor helps you build, test and understand it
              — without giving away the answer.
            </p>
            <div className="hero-actions">
              <a className="primary-link" href="#exercise-photo-title">
                Add my exercise <span aria-hidden="true">↘</span>
              </a>
              <span>One photo. No account.</span>
            </div>
            <ul className="hero-reassurance" aria-label="What to expect">
              <li>Your work stays yours</li>
              <li>Ask for a hint anytime</li>
              <li>Learn at your pace</li>
            </ul>
          </div>
          <GeometryPlayground />
        </section>

        <section className="journey" aria-labelledby="journey-title">
          <div className="journey-heading">
            <p className="eyebrow">A simple path</p>
            <h2 id="journey-title">From “I’m stuck” to “I get it”.</h2>
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
            <span>GeoTutor</span>
          </a>
          <h2 id="prototype-title">Keep wondering. Keep drawing.</h2>
        </div>
        <div>
          <p>
            GeoTutor embeds GeoGebra Geometry for this non-commercial prototype.
            Commercial use requires a separate GeoGebra agreement.
          </p>
          <p>
            <a href="https://www.geogebra.org/">GeoGebra</a>
            {" · "}
            <a href="https://www.geogebra.org/license">License and attribution</a>
          </p>
          <p>
            Live voice requires HTTPS and microphone permission. If voice is not
            available, you can use live text or keep learning locally.
          </p>
        </div>
      </footer>
    </>
  );
}

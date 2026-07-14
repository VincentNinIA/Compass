import { GeoGebraSpike } from "@/components/geogebra-spike";
import { RealtimeSpike } from "@/components/realtime-spike";

const foundations = [
  {
    label: "Geometry workspace",
    detail: "A, B and AB are observed, validated and reset without a model.",
    status: "T1 verified below",
  },
  {
    label: "Voice session",
    detail: "WebRTC owns microphone, remote audio and the oai-events channel.",
    status: "Test below",
  },
];

export default function Home() {
  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">GeoTutor · executable foundation</p>
        <h1 id="page-title">Think it through. Draw it. Explain it.</h1>
        <p className="lede">
          A voice-first geometry tutor that follows the student&apos;s construction
          and grounds every geometric claim in deterministic evidence.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" />
          Runtime ready
        </div>
      </section>

      <section className="foundations" aria-labelledby="foundation-title">
        <div>
          <p className="section-index">T0 / Foundation</p>
          <h2 id="foundation-title">Two isolated integration boundaries</h2>
        </div>
        <ul>
          {foundations.map((foundation) => (
            <li key={foundation.label}>
              <h3>{foundation.label}</h3>
              <p>{foundation.detail}</p>
              <span>{foundation.status}</span>
            </li>
          ))}
        </ul>
      </section>

      <GeoGebraSpike />
      <RealtimeSpike />
    </main>
  );
}

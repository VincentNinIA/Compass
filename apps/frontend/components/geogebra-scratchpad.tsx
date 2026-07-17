"use client";

import { useEffect, useRef, useState } from "react";

import { GeoGebraAccessibilityGuard } from "@/lib/geogebra/accessibility";
import { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import { GeoGebraAssistRuntime } from "@/lib/geogebra/assist-runtime";
import type { GeneralExerciseReadyV1 } from "@/lib/exercise/general-exercise-contracts";
import type { GeoGebraWorldStateV1 } from "@/lib/geogebra/mission-progress";
import type { ToolRuntime } from "@/lib/tools/runtime";
import { useLanguage } from "./language-provider";
import { useMascotController } from "./compass-mascot";

type ScratchpadState =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "unavailable"; message: string };

export function GeoGebraScratchpad({
  onToolRuntime,
  exercise,
  onWorldState,
}: {
  onToolRuntime?(runtime?: ToolRuntime): void;
  exercise?: GeneralExerciseReadyV1;
  onWorldState?(state?: GeoGebraWorldStateV1): void;
}) {
  const { text } = useLanguage();
  const { start: startMascot, stop: stopMascot, pulse: pulseMascot } =
    useMascotController();
  const containerRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ScratchpadState>({ phase: "loading" });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const adapter = new GeoGebraAdapter();
    let assistRuntime: GeoGebraAssistRuntime | undefined;
    const guard = new GeoGebraAccessibilityGuard(container);
    const bounds = container.getBoundingClientRect();
    const width = Math.max(
      280,
      Math.min(1600, Math.floor(bounds.width || window.innerWidth - 32)),
    );
    const height =
      window.innerWidth < 640
        ? 520
        : Math.max(650, Math.min(800, window.innerHeight - 200));

    container.replaceChildren();
    setState({ phase: "loading" });
    startMascot("general-geogebra-load", "modifying");
    guard.start();

    void adapter
      .load(container, {
        id: "compass-general-geogebra",
        width,
        height,
      })
      .then((result) => {
        if (disposed) return;
        stopMascot("general-geogebra-load");
        if (!result.ok) {
          setState({ phase: "unavailable", message: result.error.message });
          pulseMascot("general-geogebra-error", "error", 2_400);
          return;
        }
        assistRuntime = new GeoGebraAssistRuntime(adapter, {
          exercise,
          onWorldState: (worldState) => onWorldState?.(worldState),
        });
        onToolRuntime?.(assistRuntime.toolRuntime);
        setState({ phase: "ready" });
      });

    return () => {
      disposed = true;
      stopMascot("general-geogebra-load");
      onToolRuntime?.(undefined);
      onWorldState?.(undefined);
      assistRuntime?.dispose();
      guard.stop();
      adapter.dispose();
      container.replaceChildren();
    };
  }, [attempt, exercise, onToolRuntime, onWorldState, pulseMascot, startMascot, stopMascot]);

  return (
    <section
      className="geogebra-scratchpad workspace-card"
      aria-labelledby="geogebra-scratchpad-title"
      data-state={state.phase}
    >
      <div className="scratchpad-heading">
        <div>
          <p className="section-index">
            {text("Your maths board", "Ton tableau de maths")}
          </p>
          <h2 id="geogebra-scratchpad-title">
            {text("Draw, test, adjust.", "Trace, essaie, ajuste.")}
          </h2>
        </div>
        <p>
          {text(
            "Compass follows the objects on this board. Ask for the click sequence or explicitly ask it to create, rename, move or style an object. Verified geometric missions earn exploration XP.",
            "Compass suit les objets de ce tableau. Demande l'ordre des clics ou demande-lui clairement de créer, renommer, déplacer ou styliser un objet. Les missions géométriques vérifiées rapportent des XP d'exploration.",
          )}
        </p>
      </div>

      <ol className="geogebra-quick-guide" aria-label={text("GeoGebra quick guide", "Repère rapide GeoGebra")}>
        <li>
          <span>1</span>
          {text("Choose the tool in GeoGebra", "Choisis l'outil dans GeoGebra")}
        </li>
        <li>
          <span>2</span>
          {text("Click the named points in order", "Clique les points dans l'ordre")}
        </li>
        <li>
          <span>3</span>
          {text("Ask Compass if you get stuck", "Demande à Compass si tu bloques")}
        </li>
      </ol>

      <div className="geogebra-scratchpad-shell">
        {state.phase === "loading" ? (
          <div className="scratchpad-loading" role="status">
            <span aria-hidden="true" />
            <strong>{text("Opening GeoGebra…", "Ouverture de GeoGebra…")}</strong>
          </div>
        ) : null}
        {state.phase === "unavailable" ? (
          <div className="scratchpad-unavailable" role="alert">
            <strong>
              {text(
                "GeoGebra is unavailable right now.",
                "GeoGebra est indisponible pour le moment.",
              )}
            </strong>
            <p className="visually-hidden">{state.message}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {text("Try opening it again", "Réessayer l'ouverture")}
            </button>
          </div>
        ) : null}
        <div
          ref={containerRef}
          className="geogebra-scratchpad-canvas"
          aria-label={text("GeoGebra drawing board", "Tableau de dessin GeoGebra")}
        />
      </div>
    </section>
  );
}

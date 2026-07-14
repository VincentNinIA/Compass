"use client";

import { useEffect, useRef, useState } from "react";

import {
  GEOGEBRA_CODEBASE_URL,
  GEOGEBRA_VERSION,
  initializeSpikeConstruction,
  loadGeoGebraScript,
} from "@/lib/geogebra";
import type {
  GeoGebraAppletController,
  GeoGebraEvidence,
} from "@/types/geogebra";

type SpikeState =
  | { phase: "loading" }
  | { phase: "ready"; evidence: GeoGebraEvidence }
  | { phase: "unavailable"; message: string };

const LOAD_TIMEOUT_MS = 30_000;

export function GeoGebraSpike() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SpikeState>({ phase: "loading" });

  useEffect(() => {
    const container = containerRef.current;
    let disposed = false;
    let applet: GeoGebraAppletController | undefined;

    if (!container) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (!disposed) {
        setState({
          phase: "unavailable",
          message: "GeoGebra did not become ready within 30 seconds.",
        });
      }
    }, LOAD_TIMEOUT_MS);

    const start = async () => {
      try {
        await loadGeoGebraScript();
        if (disposed || !window.GGBApplet) {
          return;
        }

        applet = new window.GGBApplet(
          {
            id: "geotutor-ggb-spike",
            appName: "geometry",
            width: 860,
            height: 520,
            showToolBar: true,
            showAlgebraInput: false,
            showMenuBar: false,
            enableRightClick: false,
            enableShiftDragZoom: true,
            errorDialogsActive: false,
            appletOnLoad(api) {
              if (disposed) {
                return;
              }

              try {
                const evidence = initializeSpikeConstruction(api);
                window.__GEOTUTOR_GGB_EVIDENCE__ = evidence;
                window.clearTimeout(timeout);
                setState({ phase: "ready", evidence });
              } catch (error) {
                window.clearTimeout(timeout);
                setState({
                  phase: "unavailable",
                  message:
                    error instanceof Error
                      ? error.message
                      : "GeoGebra initialization failed.",
                });
              }
            },
            onError() {
              if (!disposed) {
                window.clearTimeout(timeout);
                setState({
                  phase: "unavailable",
                  message: "GeoGebra reported an applet loading error.",
                });
              }
            },
          },
          true,
        );
        applet.setHTML5Codebase(GEOGEBRA_CODEBASE_URL);
        applet.inject(container);
      } catch (error) {
        if (!disposed) {
          window.clearTimeout(timeout);
          setState({
            phase: "unavailable",
            message:
              error instanceof Error ? error.message : "GeoGebra is unavailable.",
          });
        }
      }
    };

    void start();

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      delete window.__GEOTUTOR_GGB_EVIDENCE__;
      if (applet) {
        applet.removeExistingApplet(container, false);
      }
      container.replaceChildren();
    };
  }, []);

  return (
    <section className="spike" aria-labelledby="geogebra-spike-title">
      <div className="spike-heading">
        <div>
          <p className="section-index">T0 / GeoGebra spike</p>
          <h2 id="geogebra-spike-title">A construction the API can read back</h2>
        </div>
        <p>
          GeoGebra Geometry {GEOGEBRA_VERSION} · non-commercial prototype ·
          attribution: GeoGebra
        </p>
      </div>

      <div className="spike-grid">
        <div
          ref={containerRef}
          className="geogebra-canvas"
          aria-label="Interactive GeoGebra geometry workspace"
        />

        <aside className="proof-panel" aria-live="polite">
          <p className={`proof-status proof-status-${state.phase}`}>
            {state.phase === "loading" && "Loading applet"}
            {state.phase === "ready" && "API verified"}
            {state.phase === "unavailable" && "Applet unavailable"}
          </p>

          {state.phase === "loading" && (
            <p>Waiting for the appletOnLoad API boundary…</p>
          )}

          {state.phase === "unavailable" && (
            <div className="fallback" role="alert">
              <p>{state.message}</p>
              <p>The GeoTutor shell remains available. Reload to retry the spike.</p>
            </div>
          )}

          {state.phase === "ready" && (
            <>
              <p className="proof-intro">
                Created by command, then read independently through the Apps API.
              </p>
              <dl>
                {state.evidence.objects.map((object) => (
                  <div key={object.label}>
                    <dt>{object.label}</dt>
                    <dd>{object.command || "independent point"}</dd>
                    <dd>
                      exists: {String(object.exists)} · defined: {String(object.defined)}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

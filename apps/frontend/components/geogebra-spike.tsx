"use client";

import { useEffect, useRef, useState } from "react";

import {
  GEOGEBRA_VERSION,
  collectGeoGebraEvidence,
} from "@/lib/geogebra";
import { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import { CompletedActionBridge } from "@/lib/geogebra/action-bridge";
import { initializeMinimalScene, SceneRegistry } from "@/lib/geogebra/scene";
import { SnapshotService } from "@/lib/geogebra/snapshot";
import { PerpendicularBisectorValidator } from "@/lib/geogebra/validator";
import { CheckpointService } from "@/lib/geogebra/checkpoint";
import {
  applyValidationResult,
  initialProgress,
} from "@/lib/geogebra/progress";
import type { GeoGebraEvidence } from "@/types/geogebra";

type SpikeState =
  | { phase: "loading" }
  | { phase: "ready"; evidence: GeoGebraEvidence }
  | { phase: "unavailable"; message: string };

const LOAD_TIMEOUT_MS = 30_000;

export function GeoGebraSpike() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SpikeState>({ phase: "loading" });
  const [progress, setProgress] = useState(initialProgress());
  const [resetStatus, setResetStatus] = useState<"idle" | "resetting" | "recovered" | "failed">("idle");
  const checkpointRef = useRef<CheckpointService | undefined>(undefined);

  const resetConstruction = async () => {
    const checkpoint = checkpointRef.current;
    if (!checkpoint || resetStatus === "resetting") return;
    setResetStatus("resetting");
    const result = await checkpoint.reset();
    window.__GEOTUTOR_RESET__ = result;
    if (!result.ok) {
      setResetStatus("failed");
      return;
    }
    const nextProgress = initialProgress(result.value.snapshot.revision);
    setProgress(nextProgress);
    window.__GEOTUTOR_PROGRESS__ = nextProgress;
    delete window.__GEOTUTOR_LAST_ACTION__;
    delete window.__GEOTUTOR_VALIDATION__;
    setResetStatus(result.value.recovered ? "recovered" : "idle");
  };

  useEffect(() => {
    const container = containerRef.current;
    let disposed = false;
    const adapter = new GeoGebraAdapter();
    const registry = new SceneRegistry();
    let bridge: CompletedActionBridge | undefined;

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
        const loadResult = await adapter.load(container, {
          id: "geotutor-ggb-spike",
          width: 860,
          height: 520,
        });
        if (disposed) {
          return;
        }
        if (!loadResult.ok) {
          throw new Error(loadResult.error.message);
        }
        const sceneResult = initializeMinimalScene(adapter, registry);
        if (!sceneResult.ok) {
          throw new Error(sceneResult.error.message);
        }
        const evidenceResult = adapter.withApi(collectGeoGebraEvidence);
        if (!evidenceResult.ok) {
          throw new Error(evidenceResult.error.message);
        }
        const snapshots = new SnapshotService(adapter, registry);
        const initialSnapshot = snapshots.capture();
        if (!initialSnapshot.ok) {
          throw new Error(initialSnapshot.error.message);
        }
        setProgress(initialProgress(initialSnapshot.value.revision));
        const validator = new PerpendicularBisectorValidator(adapter, registry);
        bridge = new CompletedActionBridge(adapter, registry, snapshots, (action) => {
          window.__GEOTUTOR_LAST_ACTION__ = action;
          if (action.studentAffectedNames.length > 0) {
            const validation = validator.validate(action.revision);
            window.__GEOTUTOR_VALIDATION__ = validation;
            setProgress((current) => {
              const next = applyValidationResult(
                current,
                validation,
                action.revision,
              );
              window.__GEOTUTOR_PROGRESS__ = next;
              return next;
            });
          }
        });
        const bridgeResult = bridge.start();
        if (!bridgeResult.ok) {
          throw new Error(bridgeResult.error.message);
        }
        const checkpoint = new CheckpointService(
          adapter,
          registry,
          snapshots,
          bridge,
        );
        const checkpointResult = await checkpoint.captureInitial();
        if (!checkpointResult.ok) {
          throw new Error(checkpointResult.error.message);
        }
        checkpointRef.current = checkpoint;
        window.__GEOTUTOR_GGB_EVIDENCE__ = evidenceResult.value;
        window.clearTimeout(timeout);
        setState({ phase: "ready", evidence: evidenceResult.value });
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
      delete window.__GEOTUTOR_LAST_ACTION__;
      delete window.__GEOTUTOR_VALIDATION__;
      delete window.__GEOTUTOR_PROGRESS__;
      delete window.__GEOTUTOR_RESET__;
      checkpointRef.current = undefined;
      bridge?.stop();
      adapter.dispose();
      container.replaceChildren();
    };
  }, []);

  return (
    <section className="spike" aria-labelledby="geogebra-spike-title">
      <div className="spike-heading">
        <div>
          <p className="section-index">T1 / Verifiable construction</p>
          <h2 id="geogebra-spike-title">A construction the app can verify locally</h2>
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
              <div className="construction-progress" aria-live="polite">
                <p>
                  Construction progress <strong>{progress.score}/2</strong>
                </p>
                <ul>
                  <li>
                    {progress.criteria.perpendicular ? "✓" : "○"} Perpendicular to AB
                  </li>
                  <li>
                    {progress.criteria.passesMidpoint ? "✓" : "○"} Passes through the midpoint
                  </li>
                </ul>
                {progress.verifying && <p>Checking the latest stable construction…</p>}
                <button
                  type="button"
                  onClick={() => void resetConstruction()}
                  disabled={resetStatus === "resetting"}
                >
                  {resetStatus === "resetting" ? "Resetting…" : "Reset construction"}
                </button>
                {resetStatus === "recovered" && (
                  <p role="status">Construction recovered from the canonical fixture.</p>
                )}
                {resetStatus === "failed" && (
                  <p role="alert">Reset failed. Reload the workspace before continuing.</p>
                )}
              </div>
              <p className="proof-intro">
                Created transactionally, observed after stable actions and verified
                with independent evidence.
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

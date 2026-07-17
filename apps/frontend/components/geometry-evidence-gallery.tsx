"use client";

import { useState } from "react";

import type { GeometryEvidenceCaptureV1 } from "@/lib/geometry-investigation/contracts";
import type { GeometryReplayStatusV1 } from "@/lib/geometry-investigation/replay";

type GalleryAction = (id: string) => Promise<void> | void;

export function GeometryEvidenceGallery({
  captures,
  locale,
  replayStatus = "idle",
  onRestore,
  onDemonstrate,
  onPause,
  onResume,
  onStop,
}: Readonly<{
  captures: readonly GeometryEvidenceCaptureV1[];
  locale: "fr" | "en";
  replayStatus?: GeometryReplayStatusV1;
  onRestore?: GalleryAction;
  onDemonstrate?: () => Promise<void> | void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}>) {
  const fr = locale === "fr";
  const [restoreCandidate, setRestoreCandidate] = useState<string>();
  const [demonstrationCandidate, setDemonstrationCandidate] = useState(false);
  const [busy, setBusy] = useState<"restore" | "demonstration">();
  const [message, setMessage] = useState("");
  const demonstrating = replayStatus !== "idle";

  const run = async (
    kind: "restore" | "demonstration",
    action: () => Promise<void> | void,
  ) => {
    setBusy(kind);
    setMessage("");
    try {
      await action();
      setMessage(
        kind === "restore"
          ? fr
            ? "La figure capturée a été restaurée."
            : "The captured figure was restored."
          : fr
            ? "La démonstration est terminée et ta figure a été restaurée."
            : "The demonstration ended and your figure was restored.",
      );
    } catch {
      setMessage(
        fr
          ? "L’action n’a pas pu être vérifiée. Ta figure reste protégée."
          : "The action could not be verified. Your figure remains protected.",
      );
    } finally {
      setBusy(undefined);
      setRestoreCandidate(undefined);
      setDemonstrationCandidate(false);
    }
  };

  return (
    <aside
      className="geometry-evidence-gallery"
      aria-labelledby="geometry-evidence-gallery-title"
    >
      <div className="geometry-evidence-gallery__heading">
        <div>
          <p className="section-index">{fr ? "Carnet d’expériences" : "Experiment log"}</p>
          <h3 id="geometry-evidence-gallery-title">
            {fr ? "Mes figures capturées" : "My captured figures"}
          </h3>
        </div>
        <strong aria-label={fr ? "Nombre de captures" : "Capture count"}>
          {captures.length}/8
        </strong>
      </div>

      {captures.length === 0 ? (
        <p className="geometry-evidence-gallery__empty">
          {fr
            ? "Les cas convexe, concave et croisé apparaîtront ici après vérification."
            : "Verified convex, concave and crossed cases will appear here."}
        </p>
      ) : (
        <ol className="geometry-evidence-gallery__list">
          {captures.map((capture) => (
            <li key={capture.id} data-configuration={capture.configuration}>
              <div>
                <strong>{configurationLabel(capture.configuration, fr)}</strong>
                <span>
                  {capture.actor === "learner"
                    ? fr
                      ? "Action de l’élève"
                      : "Learner action"
                    : fr
                      ? "Démonstration Compass"
                      : "Compass demonstration"}
                </span>
                <small>
                  {capture.objectNames.length} {fr ? "objets" : "objects"} ·{" "}
                  {capture.factIds.length} {fr ? "preuve vérifiée" : "verified fact"}
                </small>
              </div>
              {onRestore ? (
                restoreCandidate === capture.checkpointId ? (
                  <div
                    className="geometry-evidence-gallery__confirmation"
                    role="group"
                    aria-label={fr ? "Confirmer la restauration" : "Confirm restore"}
                  >
                    <span>
                      {fr
                        ? "Remplacer la figure actuelle par cette capture ?"
                        : "Replace the current figure with this capture?"}
                    </span>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run("restore", () => onRestore(capture.checkpointId))
                      }
                    >
                      {fr ? "Confirmer" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => setRestoreCandidate(undefined)}
                    >
                      {fr ? "Annuler" : "Cancel"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(busy) || demonstrating}
                    onClick={() => setRestoreCandidate(capture.checkpointId)}
                  >
                    {fr ? "Restaurer" : "Restore"}
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {onDemonstrate ? (
        <div className="geometry-evidence-gallery__demo">
          <strong>{fr ? "Besoin d’un exemple ?" : "Need an example?"}</strong>
          <p>
            {fr
              ? "Compass peut montrer l’étape demandée, puis rendre ta figure exactement."
              : "Compass can show the requested step, then return your exact figure."}
          </p>
          {demonstrating ? (
            <div role="group" aria-label={fr ? "Contrôles de démonstration" : "Demonstration controls"}>
              {replayStatus === "paused" ? (
                <button type="button" onClick={onResume}>
                  {fr ? "Reprendre" : "Resume"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={replayStatus !== "playing"}
                  onClick={onPause}
                >
                  {fr ? "Pause" : "Pause"}
                </button>
              )}
              <button type="button" onClick={onStop}>
                {fr ? "Arrêter et restaurer" : "Stop and restore"}
              </button>
              <span role="status">
                {replayStatus === "restoring"
                  ? fr
                    ? "Restauration de ta figure…"
                    : "Restoring your figure…"
                  : fr
                    ? "Démonstration en cours"
                    : "Demonstration in progress"}
              </span>
            </div>
          ) : demonstrationCandidate ? (
            <div
              className="geometry-evidence-gallery__confirmation"
              role="group"
              aria-label={fr ? "Confirmer la démonstration" : "Confirm demonstration"}
            >
              <span>
                {fr
                  ? "Lancer la démonstration après ta tentative ?"
                  : "Start the demonstration after your attempt?"}
              </span>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void run("demonstration", onDemonstrate)}
              >
                {fr ? "Oui, montrer" : "Yes, show me"}
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setDemonstrationCandidate(false)}
              >
                {fr ? "Pas maintenant" : "Not now"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => setDemonstrationCandidate(true)}
            >
              {fr ? "Voir une démonstration" : "View a demonstration"}
            </button>
          )}
        </div>
      ) : null}

      <p className="visually-hidden" aria-live="polite">
        {message}
      </p>
    </aside>
  );
}

function configurationLabel(
  configuration: GeometryEvidenceCaptureV1["configuration"],
  fr: boolean,
) {
  const labels = fr
    ? { convex: "Cas convexe", concave: "Cas concave", crossed: "Cas croisé" }
    : { convex: "Convex case", concave: "Concave case", crossed: "Crossed case" };
  return labels[configuration];
}

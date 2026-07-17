"use client";

import { useState } from "react";

import type { GeometryInvestigationV1 } from "@/lib/geometry-investigation/contracts";
import type { GeometryHintDirectiveV1 } from "@/lib/geometry-investigation/learning-policy";
import {
  geometryExerciseXpV1,
  type GeometrySessionStateV1,
} from "@/lib/geometry-investigation/session";

export function GeometryInvestigationPanel({
  activity,
  state,
  directive,
  onCapture,
  onRequestHelp,
  onCompleteReflection,
  onCompleteJustificationStep,
  onConfirmDirective,
}: Readonly<{
  activity: GeometryInvestigationV1;
  state: GeometrySessionStateV1;
  directive?: GeometryHintDirectiveV1;
  onCapture?(
    missionId: string,
    configuration: "convex" | "concave" | "crossed",
  ): Promise<void>;
  onRequestHelp(): void;
  onCompleteReflection(kind: "conjecture" | "transfer", hasText: boolean): void;
  onCompleteJustificationStep(stepId: string): void;
  onConfirmDirective?(directive: GeometryHintDirectiveV1): Promise<boolean>;
}>) {
  const fr = activity.locale === "fr";
  const [conjecture, setConjecture] = useState("");
  const [transfer, setTransfer] = useState("");
  const [captureStatus, setCaptureStatus] = useState<
    "idle" | "saving" | "error"
  >("idle");
  const [captureError, setCaptureError] = useState("");
  const [directiveRun, setDirectiveRun] = useState<{
    id?: string;
    status: "idle" | "running" | "error" | "done";
  }>({ status: "idle" });
  const directiveStatus =
    directiveRun.id === directive?.id ? directiveRun.status : "idle";
  const activeMission = activity.missions.find(
    ({ id }) => id === state.activeMissionId,
  );
  const completedSteps = new Set(
    state.reflections.completedJustificationStepIds,
  );

  return (
    <section
      className="geometry-investigation-panel"
      aria-labelledby="geometry-investigation-title"
      data-phase={state.phase}
    >
      <div className="geometry-investigation-panel__heading">
        <div>
          <p className="section-index">
            {fr ? "Investigation guidée" : "Guided investigation"}
          </p>
          <h3 id="geometry-investigation-title">{activity.title}</h3>
        </div>
        <output aria-label={fr ? "XP de l’investigation" : "Investigation XP"}>
          <strong>{geometryExerciseXpV1(state)}</strong>
          <span>XP</span>
        </output>
      </div>

      <p className="geometry-investigation-panel__objective">
        {activity.objective}
      </p>

      <ol
        className="geometry-investigation-panel__missions"
        aria-label={fr ? "Missions de l’investigation" : "Investigation missions"}
      >
        {activity.missions.map((mission) => {
          const progress = state.missions.find(
            ({ missionId }) => missionId === mission.id,
          );
          return (
            <li
              key={mission.id}
              data-mission-id={mission.id}
              data-mission-status={progress?.status ?? "locked"}
              aria-current={progress?.status === "active" ? "step" : undefined}
            >
              <span>{mission.order}</span>
              <div>
                <strong>{mission.title}</strong>
                <small>{statusLabel(progress?.status ?? "locked", fr)}</small>
              </div>
            </li>
          );
        })}
      </ol>

      {activeMission ? (
        <div className="geometry-investigation-panel__active">
          <p className="section-index">
            {fr ? `Mission ${activeMission.order}` : `Mission ${activeMission.order}`}
          </p>
          <h4>{activeMission.title}</h4>
          <p>{activeMission.instruction}</p>

          {activeMission.kind === "capture" ? (
            <div className="geometry-investigation-panel__capture">
              <button
                type="button"
                disabled={
                  captureStatus === "saving" ||
                  !onCapture ||
                  !captureConfiguration(activeMission.requiredEvidence) ||
                  state.world?.configuration?.type !==
                    captureConfiguration(activeMission.requiredEvidence)
                }
                onClick={() => {
                  const configuration = captureConfiguration(
                    activeMission.requiredEvidence,
                  );
                  if (!configuration || !onCapture) return;
                  setCaptureError("");
                  setCaptureStatus("saving");
                  void onCapture(activeMission.id, configuration)
                    .then(() => setCaptureStatus("idle"))
                    .catch((error: unknown) => {
                      setCaptureError(
                        error instanceof Error ? error.message : "",
                      );
                      setCaptureStatus("error");
                    });
                }}
              >
                {captureStatus === "saving"
                  ? fr
                    ? "Capture…"
                    : "Capturing…"
                  : fr
                    ? "Capturer ce cas"
                    : "Capture this case"}
              </button>
              {captureStatus === "error" ? (
                <p role="alert">
                  {fr
                    ? captureError ||
                      "La figure doit être stable et correspondre au cas demandé."
                    : captureError ||
                      "The figure must be stable and match the requested case."}
                </p>
              ) : null}
            </div>
          ) : null}

          {activeMission.kind === "conjecture" ? (
            <label>
              <span>{activity.conjecturePrompt}</span>
              <textarea
                value={conjecture}
                maxLength={1_000}
                onChange={(event) => setConjecture(event.target.value)}
              />
              <button
                type="button"
                disabled={conjecture.trim().length < 3}
                onClick={() => onCompleteReflection("conjecture", true)}
              >
                {fr ? "Conserver ma conjecture" : "Save my conjecture"}
              </button>
            </label>
          ) : null}

          {activeMission.kind === "justify" ? (
            <ol className="geometry-investigation-panel__steps">
              {activity.demonstrationSteps
                .filter(({ missionId }) => missionId === activeMission.id)
                .map((step) => (
                  <li key={step.id} data-step-completed={completedSteps.has(step.id)}>
                    <p>{step.narration}</p>
                    <button
                      type="button"
                      disabled={completedSteps.has(step.id)}
                      onClick={() => onCompleteJustificationStep(step.id)}
                    >
                      {completedSteps.has(step.id)
                        ? fr
                          ? "Étape expliquée"
                          : "Step explained"
                        : fr
                          ? "J’ai expliqué cette étape"
                          : "I explained this step"}
                    </button>
                  </li>
                ))}
            </ol>
          ) : null}

          {activeMission.kind === "transfer" ? (
            <label>
              <span>{activity.transferPrompt}</span>
              <textarea
                value={transfer}
                maxLength={1_000}
                onChange={(event) => setTransfer(event.target.value)}
              />
              <button
                type="button"
                disabled={transfer.trim().length < 3}
                onClick={() => onCompleteReflection("transfer", true)}
              >
                {fr ? "Terminer l’investigation" : "Complete the investigation"}
              </button>
            </label>
          ) : null}

          <button
            type="button"
            className="geometry-investigation-panel__help"
            disabled={["recovering", "fatal", "completed"].includes(state.phase)}
            onClick={onRequestHelp}
          >
            {fr ? "Demander le plus petit indice" : "Ask for the smallest hint"}
          </button>
        </div>
      ) : (
        <div className="geometry-investigation-panel__complete" role="status">
          <strong>{fr ? "Investigation terminée" : "Investigation complete"}</strong>
          <p>
            {fr
              ? "Tes preuves, ta conjecture et ton transfert sont enregistrés pour cette session."
              : "Your evidence, conjecture and transfer are recorded for this session."}
          </p>
        </div>
      )}

      {directive ? (
        <div className="geometry-investigation-panel__hint" role="status" aria-live="polite">
          <span>L{directive.level}</span>
          <p>{directive.prompt}</p>
          {directive.level === 4 ? (
            <div>
              <small>
                {fr
                  ? "La démonstration exige encore ton accord explicite."
                  : "The demonstration still requires your explicit consent."}
              </small>
              <button
                type="button"
                disabled={
                  !onConfirmDirective ||
                  directiveStatus === "running" ||
                  directiveStatus === "done"
                }
                onClick={() => {
                  if (!onConfirmDirective) return;
                  setDirectiveRun({ id: directive.id, status: "running" });
                  void onConfirmDirective(directive)
                    .then((completed) =>
                      setDirectiveRun({
                        id: directive.id,
                        status: completed ? "done" : "error",
                      }),
                    )
                    .catch(() =>
                      setDirectiveRun({ id: directive.id, status: "error" }),
                    );
                }}
              >
                {directiveStatus === "running"
                  ? fr
                    ? "Démonstration en cours…"
                    : "Demonstration running…"
                  : directiveStatus === "done"
                    ? fr
                      ? "Démonstration terminée"
                      : "Demonstration complete"
                    : fr
                      ? "J’accepte de voir cette étape"
                      : "I agree to view this step"}
              </button>
              {directiveStatus === "error" ? (
                <p role="alert">
                  {fr
                    ? "La démonstration n’a pas pu démarrer. Essaie d’abord une étape puis redemande l’aide."
                    : "The demonstration could not start. Try a step first, then ask for help again."}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function statusLabel(
  status: GeometrySessionStateV1["missions"][number]["status"],
  fr: boolean,
) {
  const labels = fr
    ? {
        locked: "À venir",
        active: "En cours",
        completed: "Terminée",
        verified: "Vérifiée",
      }
    : {
        locked: "Upcoming",
        active: "In progress",
        completed: "Completed",
        verified: "Verified",
      };
  return labels[status];
}

function captureConfiguration(
  evidenceIds: readonly string[],
): "convex" | "concave" | "crossed" | undefined {
  for (const configuration of ["convex", "concave", "crossed"] as const) {
    if (evidenceIds.includes(`rel_configuration_${configuration}`)) {
      return configuration;
    }
  }
  return undefined;
}

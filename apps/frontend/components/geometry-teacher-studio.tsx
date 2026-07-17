"use client";

import { useCallback, useMemo, useState } from "react";

import {
  TeacherExercisePublicationV2,
  createTeacherGeometryDraftV2,
  reviewTeacherGeometryDraftV2,
  type TeacherExerciseDraftV2,
  type TeacherExercisePublicationV2 as GeometryPublication,
} from "@/lib/teacher/geometry-exercise";

import {
  GeoGebraScratchpad,
  type GeometryScratchpadReadinessV1,
} from "./geogebra-scratchpad";
import { useLanguage } from "./language-provider";

export function GeometryTeacherStudio({
  onPublished,
}: Readonly<{
  onPublished?(publication: GeometryPublication): void;
}>) {
  const { language, text } = useLanguage();
  const [draft, setDraft] = useState<TeacherExerciseDraftV2>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewApproved, setPreviewApproved] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewReadiness, setPreviewReadiness] =
    useState<GeometryScratchpadReadinessV1>();
  const [publication, setPublication] = useState<GeometryPublication>();
  const [status, setStatus] = useState<
    "idle" | "publishing" | "published" | "error"
  >("idle");
  const review = useMemo(
    () => (draft ? reviewTeacherGeometryDraftV2(draft) : undefined),
    [draft],
  );
  const activity =
    draft?.content.kind === "geometry_investigation"
      ? draft.content.exercise
      : undefined;
  const handlePreviewReadiness = useCallback(
    (next: GeometryScratchpadReadinessV1) => {
      setPreviewReadiness(next);
      if (next.status !== "ready" || !next.scaffoldVerified) {
        setPreviewApproved(false);
      }
    },
    [],
  );

  const updateActivity = (
    update: (
      current: NonNullable<typeof activity>,
    ) => NonNullable<typeof activity>,
  ) => {
    if (!draft || !activity) return;
    setDraft({
      ...draft,
      content: { kind: "geometry_investigation", exercise: update(activity) },
    });
    setPreviewOpen(false);
    setPreviewApproved(false);
    setPreviewReadiness(undefined);
    setPublication(undefined);
    setStatus("idle");
  };

  const publish = async () => {
    if (!draft || !review?.publishable || !previewApproved) return;
    setStatus("publishing");
    try {
      const response = await fetch("/api/teacher/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const payload = (await response.json()) as { publication?: unknown };
      if (!response.ok || !payload.publication) throw new Error();
      const next = TeacherExercisePublicationV2.parse(payload.publication);
      setPublication(next);
      setStatus("published");
      onPublished?.(next);
    } catch {
      setStatus("error");
    }
  };

  if (!draft || !activity) {
    return (
      <section
        className="geometry-teacher-studio geometry-teacher-studio--intro"
        aria-labelledby="geometry-teacher-studio-title"
      >
        <div>
          <p className="eyebrow">
            {text("Dynamic geometry", "Géométrie dynamique")}
          </p>
          <h2 id="geometry-teacher-studio-title">
            {text(
              "Launch a guided Varignon investigation.",
              "Lancez une investigation guidée de Varignon.",
            )}
          </h2>
          <p>
            {text(
              "Students construct, test three configurations, conjecture and justify. You choose the support level before sharing.",
              "Les élèves construisent, testent trois configurations, conjecturent et justifient. Vous choisissez le niveau d’aide avant le partage.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDraft(createTeacherGeometryDraftV2(language))}
        >
          {text(
            "Prepare the Varignon investigation",
            "Préparer l’investigation Varignon",
          )}
        </button>
      </section>
    );
  }

  return (
    <section
      className="geometry-teacher-studio"
      aria-labelledby="geometry-teacher-studio-title"
    >
      <header>
        <div>
          <p className="eyebrow">
            {text("Dynamic geometry", "Géométrie dynamique")}
          </p>
          <h2 id="geometry-teacher-studio-title">
            {text("Review the full investigation.", "Relisez toute l’investigation.")}
          </h2>
        </div>
        <span>{activity.missions.length} missions · {draft.estimatedMinutes} min</span>
      </header>

      <div className="geometry-teacher-studio__fields">
        <label>
          <span>{text("Title", "Titre")}</span>
          <input
            value={activity.title}
            maxLength={240}
            onChange={(event) =>
              updateActivity((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
          />
        </label>
        <label>
          <span>{text("Level", "Niveau")}</span>
          <input
            value={activity.level}
            maxLength={240}
            onChange={(event) =>
              updateActivity((current) => ({
                ...current,
                level: event.target.value,
              }))
            }
          />
        </label>
        <label className="geometry-teacher-studio__wide">
          <span>{text("Learning objective", "Objectif d’apprentissage")}</span>
          <textarea
            value={activity.objective}
            maxLength={1_200}
            onChange={(event) =>
              updateActivity((current) => ({
                ...current,
                objective: event.target.value,
              }))
            }
          />
        </label>
        <label>
          <span>{text("Targeted difficulties", "Difficultés ciblées")}</span>
          <textarea
            value={activity.targetedDifficulties.join("\n")}
            maxLength={1_920}
            onChange={(event) =>
              updateActivity((current) => ({
                ...current,
                targetedDifficulties: lines(event.target.value, 8),
              }))
            }
          />
        </label>
        <label>
          <span>{text("Teacher guidance", "Consigne d’accompagnement")}</span>
          <textarea
            value={activity.teacherGuidance}
            maxLength={2_400}
            onChange={(event) =>
              updateActivity((current) => ({
                ...current,
                teacherGuidance: event.target.value,
              }))
            }
          />
        </label>
        <label>
          <span>{text("Maximum proactive help", "Aide proactive maximale")}</span>
          <select
            value={activity.assistancePolicy.maxProactiveLevel}
            onChange={(event) =>
              updateActivity((current) => ({
                ...current,
                assistancePolicy: {
                  ...current.assistancePolicy,
                  maxProactiveLevel: Number(event.target.value) as 0 | 1 | 2 | 3,
                },
              }))
            }
          >
            {[0, 1, 2, 3].map((level) => (
              <option key={level} value={level}>L{level}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{text("Allowed support", "Aides autorisées")}</legend>
          {([
            ["allowToolActivation", text("Tool activation", "Activation d’outil")],
            ["allowTemporaryHighlight", text("Temporary highlight", "Mise en évidence temporaire")],
            ["allowAssistantVariationAfterConsent", text("Variation after consent", "Variation après accord")],
            ["allowDemonstrationAfterConsent", text("Demonstration after consent", "Démonstration après accord")],
          ] as const).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={activity.assistancePolicy[key]}
                onChange={(event) =>
                  updateActivity((current) => ({
                    ...current,
                    assistancePolicy: {
                      ...current.assistancePolicy,
                      [key]: event.target.checked,
                    },
                  }))
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <label className="geometry-teacher-studio__wide">
          <span>{text("Mission instructions, one per line", "Consignes des missions, une par ligne")}</span>
          <textarea
            value={activity.missions.map(({ instruction }) => instruction).join("\n")}
            maxLength={9_600}
            onChange={(event) => {
              const instructions = event.target.value.split("\n");
              updateActivity((current) => ({
                ...current,
                missions: current.missions.map((mission, index) => ({
                  ...mission,
                  instruction: instructions[index] ?? "",
                })),
              }));
            }}
          />
        </label>
        <label>
          <span>{text("Conjecture question", "Question de conjecture")}</span>
          <textarea
            value={activity.conjecturePrompt}
            maxLength={1_200}
            onChange={(event) =>
              updateActivity((current) => ({
                ...current,
                conjecturePrompt: event.target.value,
              }))
            }
          />
        </label>
        <label>
          <span>{text("Transfer question", "Question de transfert")}</span>
          <textarea
            value={activity.transferPrompt}
            maxLength={1_200}
            onChange={(event) =>
              updateActivity((current) => ({
                ...current,
                transferPrompt: event.target.value,
              }))
            }
          />
        </label>
      </div>

      <ul className="teacher-review-list" aria-label={text("Investigation review", "Vérification de l’investigation") }>
        {review?.checks
          .filter(({ role }) => role !== "cost")
          .map((check) => (
            <li key={check.role} data-status={check.status}>
              <strong>{check.role}</strong>
              <span>{check.message}</span>
            </li>
          ))}
      </ul>

      <div className="geometry-teacher-studio__actions">
        <button
          type="button"
          disabled={!review?.publishable}
          onClick={() => {
            setPreviewOpen(true);
            setPreviewApproved(false);
            setPreviewReadiness(undefined);
          }}
        >
          {text("Open the real preview", "Ouvrir la prévisualisation réelle")}
        </button>
        <button
          type="button"
          disabled={!review?.publishable || !previewApproved || status === "publishing"}
          onClick={() => void publish()}
        >
          {status === "publishing"
            ? text("Sharing…", "Partage…")
            : text("Share the investigation", "Partager l’investigation")}
        </button>
      </div>

      {!review?.publishable ? (
        <p className="geometry-teacher-studio__blocked" role="alert">
          {text(
            "Correct the red review before previewing or sharing.",
            "Corrigez la vérification rouge avant de prévisualiser ou partager.",
          )}
        </p>
      ) : null}

      {previewOpen ? (
        <section className="geometry-teacher-preview" aria-label={text("Student preview", "Prévisualisation élève") }>
          <header>
            <strong>{text("Unpublished student preview", "Aperçu élève non publié")}</strong>
            <div>
              <button
                type="button"
                onClick={() => {
                  setPreviewApproved(false);
                  setPreviewReadiness(undefined);
                  setPreviewKey((value) => value + 1);
                }}
              >
                {text("Reset preview", "Réinitialiser l’aperçu")}
              </button>
              <button
                type="button"
                disabled={
                  previewReadiness?.status !== "ready" ||
                  !previewReadiness.scaffoldVerified ||
                  previewReadiness.activityId !== activity.id
                }
                onClick={() => setPreviewApproved(true)}
              >
                {text("Preview reviewed", "Prévisualisation relue")}
              </button>
              <button type="button" onClick={() => setPreviewOpen(false)}>
                {text("Close preview", "Fermer l’aperçu")}
              </button>
            </div>
          </header>
          <p role="status" className="geometry-teacher-preview__readiness">
            {previewReadiness?.status === "ready"
              ? text(
                  "The approved scaffold is ready for review.",
                  "Le scaffold approuvé est prêt pour la relecture.",
                )
              : previewReadiness?.status === "fatal"
                ? text(
                    "The real preview failed and cannot be approved.",
                    "La prévisualisation réelle a échoué et ne peut pas être approuvée.",
                  )
                : text(
                    "Waiting for the real scaffold…",
                    "Chargement du scaffold réel…",
                  )}
          </p>
          <GeoGebraScratchpad
            key={previewKey}
            investigation={activity}
            onReadiness={handlePreviewReadiness}
          />
        </section>
      ) : null}

      {status === "error" ? (
        <p role="alert">
          {text(
            "The investigation could not be shared.",
            "L’investigation n’a pas pu être partagée.",
          )}
        </p>
      ) : null}
      {publication ? (
        <div className="geometry-teacher-studio__published" role="status">
          <strong>{text("Investigation shared", "Investigation partagée")}</strong>
          <a
            href={`/?teacherExercise=${encodeURIComponent(publication.id)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {text(
              "Open the student view in a new tab",
              "Ouvrir la vue élève dans un nouvel onglet",
            )}
          </a>
        </div>
      ) : null}
    </section>
  );
}

function lines(value: string, limit: number): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type {
  InvarianceCancellationReason,
  InvarianceRunEvent,
  InvarianceRunHandle,
  InvarianceRunResult,
  InvarianceSampleEvidence,
} from "@/lib/invariance/contracts";
import type { InvarianceSummaryRender } from "@/lib/realtime/invariance-summary";
import { useLanguage } from "@/components/language-provider";

const EXPECTED_SAMPLE_COUNT = 5;

export type InvarianceExperimentObserver = Readonly<{
  onSample(sample: InvarianceSampleEvidence): void;
  onEvent?(event: InvarianceRunEvent): void;
}>;

export type InvarianceExperimentRuntime = Readonly<{
  start(observer: InvarianceExperimentObserver): InvarianceRunHandle | null;
  cancelActive?(reason: InvarianceCancellationReason): boolean;
  cancelActiveAndWait?(reason: InvarianceCancellationReason): Promise<boolean>;
}>;

export type InvarianceExperimentProps = Readonly<{
  runtime?: InvarianceExperimentRuntime;
  summary?: InvarianceSummaryRender | null;
  onResult?(result: InvarianceRunResult): void | Promise<void>;
  onTerminalRendered?(runId: string): void;
}>;

type ExperimentState =
  | Readonly<{ status: "idle"; samples: readonly [] }>
  | Readonly<{
      status: "running";
      runId: string;
      samples: readonly InvarianceSampleEvidence[];
      cancelling: boolean;
    }>
  | Readonly<{
      status: "completed";
      runId: string;
      samples: readonly InvarianceSampleEvidence[];
      pass: boolean;
    }>
  | Readonly<{
      status: "failed";
      runId: string | null;
      samples: readonly InvarianceSampleEvidence[];
    }>
  | Readonly<{
      status: "cancelled";
      runId: string;
      samples: readonly InvarianceSampleEvidence[];
    }>;

const IDLE_STATE: ExperimentState = Object.freeze({
  status: "idle",
  samples: Object.freeze([]) as readonly [],
});

export function InvarianceExperiment({
  runtime,
  summary,
  onResult,
  onTerminalRendered,
}: InvarianceExperimentProps) {
  const { language, text } = useLanguage();
  const [state, setState] = useState<ExperimentState>(IDLE_STATE);
  const [announcement, setAnnouncement] = useState("");
  const activeHandleRef = useRef<InvarianceRunHandle | undefined>(undefined);
  const runGenerationRef = useRef(0);
  const announcedKeysRef = useRef(new Set<string>());
  const sampleIdsRef = useRef(new Set<string>());
  const terminalFocusRef = useRef<HTMLDivElement>(null);
  const previousStatusRef = useRef<ExperimentState["status"]>("idle");
  const previousRuntimeRef = useRef(runtime);

  const announceOnce = useCallback((key: string, message: string) => {
    if (announcedKeysRef.current.has(key)) return;
    announcedKeysRef.current.add(key);
    setAnnouncement(message);
  }, []);

  const start = useCallback(() => {
    if (!runtime || state.status === "running") return;
    const generation = ++runGenerationRef.current;
    announcedKeysRef.current.clear();
    sampleIdsRef.current.clear();
    setAnnouncement("");

    let handle: InvarianceRunHandle | null = null;
    try {
      handle = runtime.start({
        onSample(sample) {
          if (
            generation !== runGenerationRef.current ||
            sampleIdsRef.current.has(sample.id)
          ) {
            return;
          }
          sampleIdsRef.current.add(sample.id);
          setState((current) =>
            current.status === "running"
              ? Object.freeze({
                  ...current,
                  samples: Object.freeze([...current.samples, sample]),
                })
              : current,
          );
          if (sampleIdsRef.current.size === 3) {
            announceOnce(
              `${sample.revision}:midpoint`,
              text(
                "Three of five measurements complete.",
                "Trois mesures sur cinq sont terminées.",
              ),
            );
          }
        },
      });
    } catch {
      handle = null;
    }

    if (!handle) {
      setState(
        Object.freeze({
          status: "failed",
          runId: null,
          samples: Object.freeze([]),
        }),
      );
      announceOnce(
        `unavailable:${generation}`,
        text(
          "The experiment could not start because the local evidence changed.",
          "L'expérience n'a pas pu démarrer car les preuves locales ont changé.",
        ),
      );
      return;
    }

    activeHandleRef.current = handle;
    setState(
      Object.freeze({
        status: "running",
        runId: handle.runId,
        samples: Object.freeze([]),
        cancelling: false,
      }),
    );
    announceOnce(
      `${handle.runId}:started`,
      text(
        "Equidistance experiment started. Five measurements will run.",
        "L'expérience d'équidistance commence. Cinq mesures vont être réalisées.",
      ),
    );

    void handle.result
      .then(async (result) => {
        if (generation !== runGenerationRef.current) return;
        activeHandleRef.current = undefined;
        if (result.status === "completed") {
          setState(
            Object.freeze({
              status: "completed",
              runId: result.runId,
              samples: result.samples,
              pass: result.pass,
            }),
          );
          announceOnce(
            `${result.runId}:completed`,
            text(
              "Equidistance experiment complete. Five of five measurements collected.",
              "L'expérience d'équidistance est terminée. Cinq mesures sur cinq ont été recueillies.",
            ),
          );
        } else if (result.status === "cancelled") {
          setState(
            Object.freeze({
              status: "cancelled",
              runId: result.runId,
              samples: Object.freeze([]),
            }),
          );
          announceOnce(
            `${result.runId}:cancelled`,
            text(
              "Equidistance experiment cancelled. The construction was preserved.",
              "L'expérience d'équidistance est annulée. La construction est conservée.",
            ),
          );
        } else {
          setState(
            Object.freeze({
              status: "failed",
              runId: result.runId,
              samples: Object.freeze([]),
            }),
          );
          announceOnce(
            `${result.runId}:failed`,
            text(
              "Equidistance experiment could not be completed. The construction was preserved.",
              "L'expérience d'équidistance n'a pas pu aboutir. La construction est conservée.",
            ),
          );
        }
        try {
          await onResult?.(result);
        } catch {
          // The local terminal result remains authoritative when a downstream
          // C04/C05 consumer is unavailable.
        }
      })
      .catch(() => {
        if (generation !== runGenerationRef.current) return;
        activeHandleRef.current = undefined;
        setState(
          Object.freeze({
            status: "failed",
            runId: handle.runId,
            samples: Object.freeze([]),
          }),
        );
        announceOnce(
          `${handle.runId}:rejected`,
          text(
            "Equidistance experiment could not be completed. The construction was preserved.",
            "L'expérience d'équidistance n'a pas pu aboutir. La construction est conservée.",
          ),
        );
      });
  }, [announceOnce, onResult, runtime, state.status, text]);

  const cancel = useCallback(() => {
    const handle = activeHandleRef.current;
    if (!handle || state.status !== "running" || state.cancelling) return;
    if (!handle.cancel("application_stop")) return;
    setState((current) =>
      current.status === "running"
        ? Object.freeze({ ...current, cancelling: true })
        : current,
    );
  }, [state]);

  useEffect(
    () => () => {
      runGenerationRef.current += 1;
      activeHandleRef.current?.cancel("application_stop");
      activeHandleRef.current = undefined;
    },
    [],
  );

  useEffect(() => {
    const previousRuntime = previousRuntimeRef.current;
    previousRuntimeRef.current = runtime;
    if (previousRuntime && !runtime) {
      setState((current) =>
        current.status === "running" ? current : IDLE_STATE,
      );
    }
  }, [runtime]);

  useLayoutEffect(() => {
    const becameTerminal =
      (state.status === "completed" ||
        state.status === "failed" ||
        state.status === "cancelled") &&
      previousStatusRef.current !== state.status;
    previousStatusRef.current = state.status;
    if (becameTerminal) terminalFocusRef.current?.focus();
    if (terminalStateHasRunId(state)) onTerminalRendered?.(state.runId);
  }, [onTerminalRendered, state]);

  const progress =
    state.status === "running"
      ? Math.min(state.samples.length + 1, EXPECTED_SAMPLE_COUNT)
      : state.status === "completed"
        ? EXPECTED_SAMPLE_COUNT
        : 0;
  const terminal =
    state.status === "completed" ||
    state.status === "failed" ||
    state.status === "cancelled";

  return (
    <section
      className="invariance-experiment"
      aria-label={text("Five-position experiment", "Expérience en cinq positions")}
      data-status={state.status}
    >
      <div className="invariance-experiment-heading">
        <div>
          <p className="section-index">
            {text("Step 3 · Discover", "Étape 3 · Découvrir")}
          </p>
          <h3 id="invariance-experiment-title">
            {text("The 5-point challenge", "Le défi des 5 points")}
          </h3>
        </div>
        <p className="invariance-state-label">
          {statusLabel(state.status, language)}
        </p>
      </div>

      {state.status === "idle" && (
        <p>
          {runtime
            ? text(
                "Your construction is ready. Let’s see if the same idea works everywhere.",
                "Ta construction est prête. Vérifions si la même idée fonctionne partout.",
              )
            : text(
                "Complete the perpendicular bisector to unlock this final challenge.",
                "Termine la médiatrice pour débloquer ce dernier défi.",
              )}
        </p>
      )}

      {state.status === "running" && (
        <div className="invariance-progress" data-testid="invariance-progress">
          <p>
            {text("Measuring position", "Mesure de la position")} {" "}
            <strong>{progress}/5</strong>
          </p>
          <progress value={progress} max={EXPECTED_SAMPLE_COUNT}>
            {progress} {text("of", "sur")} {EXPECTED_SAMPLE_COUNT}
          </progress>
        </div>
      )}

      {terminal && (
        <div
          className="invariance-terminal"
          ref={terminalFocusRef}
          tabIndex={-1}
          data-testid="invariance-terminal"
        >
          <p>{terminalMessage(state, language)}</p>
        </div>
      )}

      {state.samples.length > 0 && (
        <div
          className="invariance-table-wrap"
          role="region"
          aria-label={text("Scrollable measurement table", "Tableau de mesures défilant")}
          tabIndex={0}
        >
          <table>
            <caption>
              {text("Measured distances from P to A and B", "Distances mesurées de P à A et B")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{text("Position", "Position")}</th>
                <th scope="col">PA</th>
                <th scope="col">PB</th>
                <th scope="col">Delta</th>
                <th scope="col">{text("Result", "Résultat")}</th>
              </tr>
            </thead>
            <tbody>
              {state.samples.map((sample) => (
                <tr key={sample.id}>
                  <th scope="row">{sample.index + 1}/5</th>
                  <td>{formatMeasurement(sample.pa, language)}</td>
                  <td>{formatMeasurement(sample.pb, language)}</td>
                  <td>{formatMeasurement(sample.delta, language)}</td>
                  <td>
                    {sample.pass
                      ? text("Pass", "Validé")
                      : text("Does not pass", "Non validé")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary && state.status === "completed" && summary.runId === state.runId && (
        <div className="invariance-summary">
          <h4>{text("What you discovered", "Ce que tu as découvert")}</h4>
          <p>{summary.text}</p>
          {summary.source === "deterministic" && (
            <p className="invariance-summary-source">
              {text(
                "Checked locally from your five measurements",
                "Vérifié localement à partir de tes cinq mesures",
              )}
            </p>
          )}
        </div>
      )}

      <div className="invariance-actions">
        {state.status !== "running" ? (
          <button type="button" onClick={start} disabled={!runtime}>
            {state.status === "idle"
              ? text("Run experiment", "Lancer l'expérience")
              : text("Run again", "Recommencer")}
          </button>
        ) : (
          <button
            type="button"
            className="button-secondary"
            onClick={cancel}
            disabled={state.cancelling}
          >
            {state.cancelling
              ? text("Cancelling…", "Annulation…")
              : text("Cancel experiment", "Annuler l'expérience")}
          </button>
        )}
      </div>

      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="invariance-announcement"
      >
        {announcement}
      </p>
    </section>
  );
}

function terminalStateHasRunId(
  state: ExperimentState,
): state is Extract<ExperimentState, { runId: string }> {
  return (
    state.status === "completed" ||
    state.status === "cancelled" ||
    (state.status === "failed" && state.runId !== null)
  );
}

function statusLabel(
  status: ExperimentState["status"],
  language: "en" | "fr",
): string {
  if (status === "running") return language === "fr" ? "En cours" : "Running";
  if (status === "completed") return language === "fr" ? "Terminé" : "Completed";
  if (status === "failed") return language === "fr" ? "Échec" : "Failed";
  if (status === "cancelled") return language === "fr" ? "Annulé" : "Cancelled";
  return language === "fr" ? "Prêt" : "Idle";
}

function terminalMessage(
  state: ExperimentState,
  language: "en" | "fr",
): string {
  if (state.status === "completed") {
    return state.pass
      ? language === "fr"
        ? "Les cinq positions mesurées vérifient PA = PB avec la tolérance locale."
        : "All five measured positions satisfy PA = PB within the local tolerance."
      : language === "fr"
        ? "Cinq positions ont été mesurées ; au moins une ne vérifie pas PA = PB avec la tolérance attendue."
        : "Five positions were measured; at least one did not satisfy PA = PB within tolerance.";
  }
  if (state.status === "cancelled") {
    return language === "fr"
      ? "L'expérience a été annulée et aucun résultat partiel n'a été conservé."
      : "The experiment was cancelled and no partial result was kept.";
  }
  return language === "fr"
    ? "L'expérience s'est arrêtée en sécurité et aucun résultat partiel n'a été conservé."
    : "The experiment stopped safely and no partial result was kept.";
}

function formatMeasurement(
  value: number,
  language: "en" | "fr",
): string {
  if (!Number.isFinite(value)) {
    return language === "fr" ? "Indisponible" : "Unavailable";
  }
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  }).format(value);
}

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
              "Three of five measurements complete.",
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
        "The experiment could not start because the local evidence changed.",
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
      "Equidistance experiment started. Five measurements will run.",
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
            "Equidistance experiment complete. Five of five measurements collected.",
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
            "Equidistance experiment cancelled. The construction was preserved.",
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
            "Equidistance experiment could not be completed. The construction was preserved.",
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
          "Equidistance experiment could not be completed. The construction was preserved.",
        );
      });
  }, [announceOnce, onResult, runtime, state.status]);

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
      aria-label="Five-position experiment"
      data-status={state.status}
    >
      <div className="invariance-experiment-heading">
        <div>
          <p className="section-index">Step 3 · Discover</p>
          <h3 id="invariance-experiment-title">The 5-point challenge</h3>
        </div>
        <p className="invariance-state-label">{statusLabel(state.status)}</p>
      </div>

      {state.status === "idle" && (
        <p>
          {runtime
            ? "Your construction is ready. Let’s see if the same idea works everywhere."
            : "Complete the perpendicular bisector to unlock this final challenge."}
        </p>
      )}

      {state.status === "running" && (
        <div className="invariance-progress" data-testid="invariance-progress">
          <p>
            Measuring position <strong>{progress}/5</strong>
          </p>
          <progress value={progress} max={EXPECTED_SAMPLE_COUNT}>
            {progress} of {EXPECTED_SAMPLE_COUNT}
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
          <p>{terminalMessage(state)}</p>
        </div>
      )}

      {state.samples.length > 0 && (
        <div
          className="invariance-table-wrap"
          role="region"
          aria-label="Scrollable measurement table"
          tabIndex={0}
        >
          <table>
            <caption>Measured distances from P to A and B</caption>
            <thead>
              <tr>
                <th scope="col">Position</th>
                <th scope="col">PA</th>
                <th scope="col">PB</th>
                <th scope="col">Delta</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {state.samples.map((sample) => (
                <tr key={sample.id}>
                  <th scope="row">{sample.index + 1}/5</th>
                  <td>{formatMeasurement(sample.pa)}</td>
                  <td>{formatMeasurement(sample.pb)}</td>
                  <td>{formatMeasurement(sample.delta)}</td>
                  <td>{sample.pass ? "Pass" : "Does not pass"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary && state.status === "completed" && summary.runId === state.runId && (
        <div className="invariance-summary">
          <h4>What you discovered</h4>
          <p>{summary.text}</p>
          {summary.source === "deterministic" && (
            <p className="invariance-summary-source">
              Checked locally from your five measurements
            </p>
          )}
        </div>
      )}

      <div className="invariance-actions">
        {state.status !== "running" ? (
          <button type="button" onClick={start} disabled={!runtime}>
            {state.status === "idle" ? "Run experiment" : "Run again"}
          </button>
        ) : (
          <button
            type="button"
            className="button-secondary"
            onClick={cancel}
            disabled={state.cancelling}
          >
            {state.cancelling ? "Cancelling…" : "Cancel experiment"}
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

function statusLabel(status: ExperimentState["status"]): string {
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return "Idle";
}

function terminalMessage(
  state: ExperimentState,
): string {
  if (state.status === "completed") {
    return state.pass
      ? "All five measured positions satisfy PA = PB within the local tolerance."
      : "Five positions were measured; at least one did not satisfy PA = PB within tolerance.";
  }
  if (state.status === "cancelled") {
    return "The experiment was cancelled and no partial result was kept.";
  }
  return "The experiment stopped safely and no partial result was kept.";
}

function formatMeasurement(value: number): string {
  if (!Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  }).format(value);
}

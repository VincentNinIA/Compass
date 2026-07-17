import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_POSITION_VERSION,
  INVARIANCE_SAMPLE_PARAMETERS,
  type InvarianceRunCancelled,
  type InvarianceRunCompleted,
  type InvarianceRunFailed,
  type InvarianceRunHandle,
  type InvarianceSampleEvidence,
} from "@/lib/invariance/contracts";
import type { InvarianceSummaryRender } from "@/lib/realtime/invariance-summary";
import {
  InvarianceExperiment,
  type InvarianceExperimentObserver,
  type InvarianceExperimentRuntime,
} from "./invariance-experiment";

afterEach(cleanup);

describe("T5-C06 accessible invariance experiment", () => {
  it("keeps the idle state honest until a current 2/2 runtime is available", () => {
    const view = render(<InvarianceExperiment />);

    expect(screen.getByText("Idle", { exact: true })).toBeInTheDocument();
    expect(
      screen.getByText(/Complete the perpendicular bisector/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run experiment" })).toBeDisabled();

    view.rerender(<InvarianceExperiment runtime={deferredRuntime().runtime} />);
    expect(screen.getByRole("button", { name: "Run experiment" })).toBeEnabled();
    expect(screen.getByText(/Your construction is ready/)).toBeInTheDocument();
  });

  it("renders 1/5 through 5/5, a semantic measurement table, and grouped deduplicated announcements", async () => {
    const harness = deferredRuntime();
    const onResult = vi.fn();
    const view = render(
      <InvarianceExperiment runtime={harness.runtime} onResult={onResult} />,
    );

    const start = screen.getByRole("button", { name: "Run experiment" });
    start.focus();
    fireEvent.click(start);

    expect(screen.getByText("Running", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("1/5", { exact: true })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent(
      "Equidistance experiment started. Five measurements will run.",
    );

    await publish(harness, sample(0));
    expect(screen.getByText("2/5", { exact: true })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Equidistance experiment started");

    await publish(harness, sample(1));
    await publish(harness, sample(2));
    expect(screen.getByText("4/5", { exact: true })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Three of five measurements complete.");

    await publish(harness, sample(2));
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(liveRegion()).toHaveTextContent("Three of five measurements complete.");

    await publish(harness, sample(3));
    expect(screen.getByText("5/5", { exact: true })).toBeInTheDocument();
    await publish(harness, sample(4));

    await act(async () => harness.resolve(completedResult()));

    expect(screen.getByText("Completed", { exact: true })).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Measured distances from P to A and B",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByRole("columnheader", { name: "PA" })).toBeVisible();
    expect(within(table).getAllByText("Pass")).toHaveLength(5);
    expect(liveRegion()).toHaveTextContent(
      "Equidistance experiment complete. Five of five measurements collected.",
    );
    expect(screen.getByTestId("invariance-terminal")).toHaveFocus();
    expect(onResult).toHaveBeenCalledTimes(1);

    view.rerender(<InvarianceExperiment onResult={onResult} />);
    expect(screen.getByText("Idle", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps Cancel keyboard-focusable, calls the C01 handle once, and focuses the cancelled result", async () => {
    const harness = deferredRuntime();
    render(<InvarianceExperiment runtime={harness.runtime} />);
    fireEvent.click(screen.getByRole("button", { name: "Run experiment" }));

    const cancel = screen.getByRole("button", { name: "Cancel experiment" });
    cancel.focus();
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    fireEvent.click(cancel);

    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.cancel).toHaveBeenCalledWith("application_stop");
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();

    await act(async () => harness.resolve(cancelledResult()));

    expect(screen.getByText("Cancelled", { exact: true })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent(
      "Equidistance experiment cancelled. The construction was preserved.",
    );
    expect(screen.getByTestId("invariance-terminal")).toHaveFocus();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("surfaces failure without partial claims and renders a matching C05 fallback honestly", async () => {
    const failed = deferredRuntime();
    const view = render(<InvarianceExperiment runtime={failed.runtime} />);
    fireEvent.click(screen.getByRole("button", { name: "Run experiment" }));
    await publish(failed, sample(0));
    await act(async () => failed.resolve(failedResult()));

    expect(screen.getByText("Failed", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/no partial result was kept/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const completed = deferredRuntime();
    const summary = deterministicSummary();
    view.rerender(
      <InvarianceExperiment runtime={completed.runtime} summary={summary} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    for (let index = 0; index < 5; index += 1) {
      await publish(completed, sample(index));
    }
    await act(async () => completed.resolve(completedResult()));

    expect(screen.getByRole("heading", { name: "What you discovered" })).toBeVisible();
    expect(screen.getByText(summary.text)).toBeVisible();
    expect(screen.getByText(/Checked locally from your five measurements/)).toBeVisible();
  });
});

function deferredRuntime() {
  let observer: InvarianceExperimentObserver | undefined;
  let resolve!: (
    result: InvarianceRunCompleted | InvarianceRunCancelled | InvarianceRunFailed,
  ) => void;
  const result = new Promise<
    InvarianceRunCompleted | InvarianceRunCancelled | InvarianceRunFailed
  >((accept) => {
    resolve = accept;
  });
  const cancel = vi.fn(() => true);
  const handle: InvarianceRunHandle = {
    runId: "run-ui-1",
    result,
    cancel,
  };
  const runtime: InvarianceExperimentRuntime = {
    start(nextObserver) {
      observer = nextObserver;
      return handle;
    },
  };
  return {
    runtime,
    cancel,
    resolve,
    publish(value: InvarianceSampleEvidence) {
      observer?.onSample(value);
    },
  };
}

async function publish(
  harness: ReturnType<typeof deferredRuntime>,
  value: InvarianceSampleEvidence,
) {
  await act(async () => harness.publish(value));
}

function sample(index: number): InvarianceSampleEvidence {
  const parameter = INVARIANCE_SAMPLE_PARAMETERS[index];
  if (parameter === undefined || index < 0 || index > 4) {
    throw new Error("Invalid sample fixture index.");
  }
  const distance = 2 + Math.abs(parameter);
  return Object.freeze({
    id: `invariance:run-ui-1:7:${index}`,
    index: index as InvarianceSampleEvidence["index"],
    parameter,
    coords: Object.freeze([0, parameter]) as readonly [number, number],
    pa: distance,
    pb: distance,
    delta: 0,
    tolerance: INVARIANCE_DISTANCE_TOLERANCE,
    toleranceVersion: INVARIANCE_DISTANCE_TOLERANCE_VERSION,
    positionVersion: INVARIANCE_POSITION_VERSION,
    pass: true,
    revision: 7,
  });
}

function completedResult(): InvarianceRunCompleted {
  const samples = Object.freeze([0, 1, 2, 3, 4].map(sample)) as InvarianceRunCompleted["samples"];
  return Object.freeze({
    status: "completed",
    runId: "run-ui-1",
    revision: 7,
    inputEvidenceIds: Object.freeze(["evidence-perpendicular", "evidence-midpoint"]),
    samples,
    pass: true,
    evidenceIds: Object.freeze(samples.map(({ id }) => id)) as InvarianceRunCompleted["evidenceIds"],
  });
}

function cancelledResult(): InvarianceRunCancelled {
  return Object.freeze({
    status: "cancelled",
    runId: "run-ui-1",
    revision: 7,
    inputEvidenceIds: Object.freeze(["evidence-perpendicular", "evidence-midpoint"]),
    samples: Object.freeze([]) as readonly [],
    pass: false,
    evidenceIds: Object.freeze([]) as readonly [],
    reason: "application_stop",
  });
}

function failedResult(): InvarianceRunFailed {
  return Object.freeze({
    status: "failed",
    runId: "run-ui-1",
    revision: 7,
    inputEvidenceIds: Object.freeze(["evidence-perpendicular", "evidence-midpoint"]),
    samples: Object.freeze([]) as readonly [],
    pass: false,
    evidenceIds: Object.freeze([]) as readonly [],
    error: Object.freeze({ code: "sample_execution_failed" }),
  });
}

function deterministicSummary(): InvarianceSummaryRender {
  return Object.freeze({
    runId: "run-ui-1",
    revision: 7,
    eventId: "summary-event-1",
    responseId: null,
    source: "deterministic",
    text: "Across five measured positions, PA and PB remained equal within tolerance.",
    reason: "send_failed",
  });
}

function liveRegion(): HTMLElement {
  return screen.getByTestId("invariance-announcement");
}

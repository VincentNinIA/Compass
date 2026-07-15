"use client";

import { useEffect, useState } from "react";

import {
  type LatencyBudgetExport,
  type LatencyBudgetMonitor,
} from "@/lib/reliability/latency-budget";

function formatMilliseconds(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

export function ReliabilityPanel({
  monitor,
}: {
  monitor: LatencyBudgetMonitor;
}) {
  const [report, setReport] = useState<LatencyBudgetExport>(() =>
    monitor.exportDebug(),
  );

  useEffect(
    () => monitor.subscribe(() => setReport(monitor.exportDebug())),
    [monitor],
  );

  const latestDegradation = [...report.distributions]
    .reverse()
    .find(({ status }) => status === "degraded");

  return (
    <section
      className="spike reliability-panel"
      aria-labelledby="reliability-panel-title"
    >
      <div className="spike-heading">
        <div>
          <p className="section-index">System details</p>
          <h2 id="reliability-panel-title">Performance and fallbacks</h2>
        </div>
        <p>
          This optional view shows timing checks for the demo. It never stores a
          prompt, photo, recording or secret.
        </p>
      </div>

      <p
        className={latestDegradation ? "reliability-alert" : "reliability-ready"}
        role="status"
        aria-live="polite"
      >
        {latestDegradation
          ? `${latestDegradation.userMessage} Active fallback: ${latestDegradation.fallback.replaceAll("_", " ")}.`
          : "No measured budget overrun. Unmeasured paths are never presented as passed."}
      </p>

      <div className="reliability-table-scroll" tabIndex={0}>
        <table>
          <caption>In-memory latency distributions for this page session</caption>
          <thead>
            <tr>
              <th scope="col">Path</th>
              <th scope="col">Budget</th>
              <th scope="col">Samples</th>
              <th scope="col">p50</th>
              <th scope="col">p95</th>
              <th scope="col">Status / fallback</th>
            </tr>
          </thead>
          <tbody>
            {report.distributions.map((distribution) => (
              <tr key={distribution.name} data-latency-budget={distribution.name}>
                <th scope="row">{distribution.name.replaceAll("_", " ")}</th>
                <td>{formatMilliseconds(distribution.budgetMs)}</td>
                <td>{distribution.sampleCount}</td>
                <td>{formatMilliseconds(distribution.p50Ms)}</td>
                <td>{formatMilliseconds(distribution.p95Ms)}</td>
                <td>
                  {distribution.status.replaceAll("_", " ")}
                  {distribution.status === "degraded"
                    ? ` · ${distribution.fallback.replaceAll("_", " ")}`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

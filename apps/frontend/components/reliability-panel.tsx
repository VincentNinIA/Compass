"use client";

import { useEffect, useState } from "react";

import {
  type LatencyBudgetExport,
  type LatencyBudgetMonitor,
} from "@/lib/reliability/latency-budget";
import { useLanguage } from "./language-provider";

function formatMilliseconds(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

export function ReliabilityPanel({
  monitor,
}: {
  monitor: LatencyBudgetMonitor;
}) {
  const { text } = useLanguage();
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
          <p className="section-index">
            {text("System details", "Détails du système")}
          </p>
          <h2 id="reliability-panel-title">
            {text("Performance and fallbacks", "Performances et solutions de repli")}
          </h2>
        </div>
        <p>
          {text(
            "This optional view shows timing checks for the demo. It never stores a prompt, photo, recording or secret.",
            "Cette vue facultative affiche les mesures de temps de la démo. Elle ne stocke jamais de consigne, de photo, d’enregistrement ou de secret.",
          )}
        </p>
      </div>

      <p
        className={latestDegradation ? "reliability-alert" : "reliability-ready"}
        role="status"
        aria-live="polite"
      >
        {latestDegradation
          ? text(
              `${latestDegradation.userMessage} Active fallback: ${latestDegradation.fallback.replaceAll("_", " ")}.`,
              `${latestDegradation.userMessage} Solution de repli active : ${latestDegradation.fallback.replaceAll("_", " ")}.`,
            )
          : text(
              "No measured budget overrun. Unmeasured paths are never presented as passed.",
              "Aucun dépassement mesuré. Les parcours non mesurés ne sont jamais présentés comme validés.",
            )}
      </p>

      <div className="reliability-table-scroll" tabIndex={0}>
        <table>
          <caption>
            {text(
              "In-memory latency distributions for this page session",
              "Répartition des latences en mémoire pour cette session",
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col">{text("Path", "Parcours")}</th>
              <th scope="col">{text("Budget", "Budget")}</th>
              <th scope="col">{text("Samples", "Mesures")}</th>
              <th scope="col">p50</th>
              <th scope="col">p95</th>
              <th scope="col">{text("Status / fallback", "État / repli")}</th>
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

import type {
  ProgressPropertyViewModel,
  ProgressViewModel,
} from "@/lib/pedagogy/progress-view-model";

export function ProgressFeedback({ model }: { model: ProgressViewModel }) {
  return (
    <div
      className="construction-progress-summary"
      data-testid="construction-progress"
    >
      <p>
        Construction progress <strong>{model.score}/{model.total}</strong>
      </p>
      <ul>
        {model.properties.map((property) => (
          <li key={property.relationKey} data-status={property.status}>
            <span aria-hidden="true">{statusIcon(property.status)}</span>{" "}
            {property.label}: {statusText(property)}
          </li>
        ))}
      </ul>
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {model.announcement}
      </p>
    </div>
  );
}

function statusIcon(status: ProgressPropertyViewModel["status"]): string {
  if (status === "verified") return "✓";
  if (status === "missing") return "○";
  return "?";
}

function statusText(property: ProgressPropertyViewModel): string {
  if (property.status === "verified") return "verified";
  if (property.status === "missing") return "not yet verified";
  return "waiting for local evidence";
}

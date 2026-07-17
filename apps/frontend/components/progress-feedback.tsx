import type {
  ProgressPropertyViewModel,
  ProgressViewModel,
} from "@/lib/pedagogy/progress-view-model";
import { useLanguage } from "@/components/language-provider";

export function ProgressFeedback({ model }: { model: ProgressViewModel }) {
  const { language, text } = useLanguage();

  return (
    <div
      className="construction-progress-summary"
      data-testid="construction-progress"
    >
      <p>
        {text("Your progress", "Ta progression")} {" "}
        <strong>{model.score}/{model.total}</strong>
      </p>
      <ul>
        {model.properties.map((property) => (
          <li key={property.relationKey} data-status={property.status}>
            <span aria-hidden="true">{statusIcon(property.status)}</span>{" "}
            {relationLabel(property, language)}: {statusText(property, language)}
          </li>
        ))}
      </ul>
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {language === "fr" && model.announcement
          ? `Progression ${model.score} sur ${model.total}. ${model.properties
              .map(
                (property) =>
                  `${relationLabel(property, language)} : ${statusText(property, language)}`,
              )
              .join(" ; ")}.`
          : model.announcement}
      </p>
    </div>
  );
}

function statusIcon(status: ProgressPropertyViewModel["status"]): string {
  if (status === "verified") return "✓";
  if (status === "missing") return "○";
  return "?";
}

function relationLabel(
  property: ProgressPropertyViewModel,
  language: "en" | "fr",
): string {
  if (language === "en") return property.label;
  return property.relationKey === "perpendicular"
    ? "Perpendiculaire à AB"
    : "Passe par le milieu de AB";
}

function statusText(
  property: ProgressPropertyViewModel,
  language: "en" | "fr",
): string {
  if (property.status === "verified") {
    return language === "fr" ? "c'est trouvé" : "you got it";
  }
  if (property.status === "missing") {
    return language === "fr" ? "encore à trouver" : "still to find";
  }
  return language === "fr"
    ? "vérification de ton dernier geste"
    : "checking your latest move";
}

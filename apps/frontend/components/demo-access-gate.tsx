"use client";

import { useState, type FormEvent } from "react";

import { useLanguage } from "@/components/language-provider";

export function DemoAccessGate({ unavailable = false }: { unavailable?: boolean }) {
  const { language, text, toggleLanguage } = useLanguage();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "invalid" | "error">(
    "idle",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    try {
      const response = await fetch("/api/demo/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        cache: "no-store",
      });
      if (response.ok) {
        window.location.reload();
        return;
      }
      setStatus(response.status === 401 ? "invalid" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="demo-access-shell">
      <button
        type="button"
        className="button-secondary demo-access-language"
        onClick={toggleLanguage}
        aria-label={text("Passer en français", "Switch to English")}
      >
        {language === "fr" ? "🇬🇧 EN" : "🇫🇷 FR"}
      </button>
      <section className="demo-access-card" aria-labelledby="demo-access-title">
        <p className="demo-access-eyebrow">COMPASS · PRIVATE DEMO</p>
        <div className="demo-access-mark" aria-hidden="true">C</div>
        <h1 id="demo-access-title">
          {text("Your learning space is protected", "Votre espace d’apprentissage est protégé")}
        </h1>
        <p>
          {unavailable
            ? text(
                "The demo is temporarily unavailable. Please contact the project team.",
                "La démo est temporairement indisponible. Contactez l’équipe projet.",
              )
            : text(
                "Enter the access code shared by the Compass team.",
                "Saisissez le code transmis par l’équipe Compass.",
              )}
        </p>

        {!unavailable ? (
          <form onSubmit={submit} className="demo-access-form">
            <label htmlFor="demo-access-code">
              {text("Access code", "Code d’accès")}
            </label>
            <input
              id="demo-access-code"
              name="code"
              type="password"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                if (status !== "idle") setStatus("idle");
              }}
              minLength={8}
              maxLength={128}
              autoComplete="current-password"
              required
              autoFocus
            />
            <button type="submit" disabled={status === "submitting"}>
              {status === "submitting"
                ? text("Checking…", "Vérification…")
                : text("Open Compass", "Ouvrir Compass")}
            </button>
            <p className="demo-access-feedback" role="status" aria-live="polite">
              {status === "invalid"
                ? text("This access code is not valid.", "Ce code d’accès n’est pas valide.")
                : status === "error"
                  ? text("Access could not be verified. Try again.", "L’accès n’a pas pu être vérifié. Réessayez.")
                  : ""}
            </p>
          </form>
        ) : null}
      </section>
    </main>
  );
}

export function DemoSessionControl() {
  const { text } = useLanguage();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/demo/access", {
        method: "DELETE",
        cache: "no-store",
      });
    } finally {
      window.location.reload();
    }
  }

  return (
    <button
      type="button"
      className="button-secondary demo-session-control"
      onClick={() => void signOut()}
      disabled={busy}
    >
      {busy ? text("Closing…", "Fermeture…") : text("End demo session", "Fermer la démo")}
    </button>
  );
}

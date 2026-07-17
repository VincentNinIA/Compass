"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { useLanguage } from "./language-provider";

type PublicLearnerAlias = {
  id: string;
  pseudonym: string;
  createdAt: number;
  expiresAt: number;
};

type PublicClassroom = {
  id: string;
  label: string;
  status: "active" | "archived" | "revoked";
  createdAt: number;
  joinCodeExpiresAt: number | null;
  expiresAt: number;
  learnerAliases: PublicLearnerAlias[];
};

type SessionState =
  | "loading"
  | "signed_out"
  | "ready"
  | "disabled"
  | "unavailable";

export function ClassroomTeacherPanel() {
  const { language, text } = useLanguage();
  const french = language === "fr";
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [activated, setActivated] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [classrooms, setClassrooms] = useState<PublicClassroom[]>([]);
  const [revealedCodes, setRevealedCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadClasses = useCallback(async () => {
    const response = await fetch("/api/classroom/teacher/classes", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = (await response.json()) as { classrooms?: PublicClassroom[] };
    setClassrooms(payload.classrooms ?? []);
  }, []);

  useEffect(() => {
    if (!activated) return;
    let active = true;
    void fetch("/api/classroom/teacher/session", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          status?: string;
          error?: { code?: string };
        };
        if (!active) return;
        if (payload.status === "disabled") {
          setSessionState("disabled");
          return;
        }
        if (response.ok && payload.status === "authorized") {
          setSessionState("ready");
          await loadClasses();
          return;
        }
        setSessionState(
          response.status === 401 ? "signed_out" : "unavailable",
        );
      })
      .catch(() => {
        if (active) setSessionState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [activated, loadClasses]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classroom/teacher/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: accessCode, locale: language }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setAccessCode("");
      setSessionState("ready");
      await loadClasses();
      setMessage(text("Teacher space unlocked.", "Espace professeur ouvert."));
    } catch {
      setMessage(
        text(
          "The access code is invalid or the class service is unavailable.",
          "Le code d'accès est invalide ou le service de classe est indisponible.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const createClass = async (event: FormEvent) => {
    event.preventDefault();
    if (!classLabel.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classroom/teacher/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: classLabel }),
      });
      const payload = (await response.json()) as {
        classroom?: PublicClassroom;
        joinCode?: string;
      };
      if (!response.ok || !payload.classroom || !payload.joinCode) {
        throw new Error("classroom_create_failed");
      }
      setRevealedCodes((current) => ({
        ...current,
        [payload.classroom!.id]: payload.joinCode!,
      }));
      setClassLabel("");
      await loadClasses();
      setMessage(
        text(
          "Class created. Share the code shown once below.",
          "Classe créée. Partagez le code affiché une seule fois ci-dessous.",
        ),
      );
    } catch {
      setMessage(
        text(
          "The class could not be created.",
          "La classe n'a pas pu être créée.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (
    body:
      | { action: "rotate_code" | "archive"; classroomId: string }
      | {
          action: "remove_learner";
          classroomId: string;
          learnerAliasId: string;
        },
  ) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classroom/teacher/classes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        classroom?: PublicClassroom;
        joinCode?: string;
      };
      if (!response.ok) throw new Error("classroom_action_failed");
      if (body.action === "rotate_code" && payload.joinCode) {
        setRevealedCodes((current) => ({
          ...current,
          [body.classroomId]: payload.joinCode!,
        }));
      }
      if (body.action === "archive") {
        setRevealedCodes((current) => {
          const next = { ...current };
          delete next[body.classroomId];
          return next;
        });
      }
      await loadClasses();
      setMessage(
        body.action === "rotate_code"
          ? text(
              "New code ready. The previous code no longer works.",
              "Nouveau code prêt. L'ancien code ne fonctionne plus.",
            )
          : body.action === "archive"
            ? text("Class archived.", "Classe archivée.")
            : text("Pseudonym removed.", "Pseudonyme retiré."),
      );
    } catch {
      setMessage(
        text(
          "The action could not be completed.",
          "L'action n'a pas pu être effectuée.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await fetch("/api/classroom/teacher/session", { method: "DELETE" });
    } finally {
      setClassrooms([]);
      setRevealedCodes({});
      setSessionState("signed_out");
      setBusy(false);
    }
  };

  return (
    <section className="classroom-teacher-panel" aria-labelledby="classroom-panel-title">
      <header>
        <div>
          <p className="eyebrow">{text("Class pilot", "Pilote classe")}</p>
          <h2 id="classroom-panel-title">
            {text("Bring your students together.", "Réunissez vos élèves.")}
          </h2>
        </div>
        <p>
          {text(
            "Create a class, share a temporary code and manage pseudonyms. No student email or legal name is collected.",
            "Créez une classe, partagez un code temporaire et gérez les pseudonymes. Aucun e-mail ni nom légal d'élève n'est collecté.",
          )}
        </p>
      </header>

      {!activated ? (
        <button
          type="button"
          className="classroom-panel-open"
          onClick={() => setActivated(true)}
        >
          {text("Manage my classes", "Gérer mes classes")}
        </button>
      ) : sessionState === "loading" ? (
        <p role="status">{text("Checking access…", "Vérification de l'accès…")}</p>
      ) : sessionState === "disabled" ? (
        <p className="classroom-panel-notice" role="status">
          {text(
            "The class pilot is not enabled in this environment.",
            "Le pilote classe n'est pas activé dans cet environnement.",
          )}
        </p>
      ) : sessionState === "unavailable" ? (
        <p className="classroom-panel-notice" role="alert">
          {text(
            "The class service is temporarily unavailable.",
            "Le service de classe est temporairement indisponible.",
          )}
        </p>
      ) : sessionState === "signed_out" ? (
        <form className="classroom-login" onSubmit={login}>
          <label htmlFor="classroom-teacher-code">
            {text("Pilot teacher access code", "Code d'accès professeur pilote")}
          </label>
          <div>
            <input
              id="classroom-teacher-code"
              type="password"
              autoComplete="current-password"
              value={accessCode}
              minLength={8}
              maxLength={128}
              required
              onChange={(event) => setAccessCode(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              {text("Open class space", "Ouvrir l'espace classe")}
            </button>
          </div>
        </form>
      ) : (
        <div className="classroom-panel-body">
          <div className="classroom-panel-toolbar">
            <form onSubmit={createClass}>
              <label htmlFor="classroom-label">
                {text("New class name", "Nom de la nouvelle classe")}
              </label>
              <div>
                <input
                  id="classroom-label"
                  value={classLabel}
                  maxLength={80}
                  placeholder={text("Geometry lab", "Atelier géométrie")}
                  required
                  onChange={(event) => setClassLabel(event.target.value)}
                />
                <button type="submit" disabled={busy}>
                  {text("Create class", "Créer la classe")}
                </button>
              </div>
            </form>
            <button type="button" className="classroom-signout" onClick={logout} disabled={busy}>
              {text("Sign out", "Se déconnecter")}
            </button>
          </div>

          {classrooms.length === 0 ? (
            <div className="classroom-empty">
              <strong>{text("No class yet", "Aucune classe pour le moment")}</strong>
              <span>
                {text(
                  "Create the first class to obtain a temporary student code.",
                  "Créez la première classe pour obtenir un code élève temporaire.",
                )}
              </span>
            </div>
          ) : (
            <ol className="classroom-list">
              {classrooms.map((entry) => (
                <li key={entry.id} data-status={entry.status}>
                  <header>
                    <div>
                      <span>{entry.status === "active" ? text("Active", "Active") : text("Archived", "Archivée")}</span>
                      <h3>{entry.label}</h3>
                    </div>
                    <strong>
                      {entry.learnerAliases.length} {text("pseudonyms", "pseudonymes")}
                    </strong>
                  </header>

                  {revealedCodes[entry.id] ? (
                    <div className="classroom-code" role="status">
                      <span>{text("Code shown once", "Code affiché une seule fois")}</span>
                      <output>{revealedCodes[entry.id]}</output>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard
                            ?.writeText(revealedCodes[entry.id])
                            .then(() => setMessage(text("Code copied.", "Code copié.")))
                            .catch(() => undefined);
                        }}
                      >
                        {text("Copy", "Copier")}
                      </button>
                    </div>
                  ) : null}

                  {entry.status === "active" ? (
                    <div className="classroom-actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void mutate({ action: "rotate_code", classroomId: entry.id })}
                      >
                        {text("Generate a new code", "Générer un nouveau code")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void mutate({ action: "archive", classroomId: entry.id })}
                      >
                        {text("Archive", "Archiver")}
                      </button>
                    </div>
                  ) : null}

                  <div className="classroom-roster">
                    <h4>{text("Pseudonymous roster", "Liste pseudonyme")}</h4>
                    {entry.learnerAliases.length === 0 ? (
                      <p>{text("No student has joined yet.", "Aucun élève n'a encore rejoint la classe.")}</p>
                    ) : (
                      <ul>
                        {entry.learnerAliases.map((alias) => (
                          <li key={alias.id}>
                            <span>{alias.pseudonym}</span>
                            <small>
                              {new Intl.DateTimeFormat(french ? "fr-FR" : "en-GB", {
                                day: "2-digit",
                                month: "short",
                              }).format(alias.createdAt)}
                            </small>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void mutate({
                                  action: "remove_learner",
                                  classroomId: entry.id,
                                  learnerAliasId: alias.id,
                                })
                              }
                            >
                              {text("Remove", "Retirer")}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {message ? <p className="classroom-panel-message" role="status">{message}</p> : null}
    </section>
  );
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { code?: string } };
    return payload.error?.code ?? "classroom_request_failed";
  } catch {
    return "classroom_request_failed";
  }
}

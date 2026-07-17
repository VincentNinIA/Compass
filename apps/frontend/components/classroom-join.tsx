"use client";

import { useEffect, useState, type FormEvent } from "react";

import { useLanguage } from "./language-provider";

type Membership = {
  classroom: { id: string; label: string; expiresAt: number };
  learnerAlias: { id: string; pseudonym: string; expiresAt: number };
  assignments: {
    id: string;
    status: "active";
    contractHash: string;
    opensAt: number;
    closesAt: number;
    publication: {
      content: {
        exercise: {
          title: string;
          objective: string;
          missions: { id: string; title: string; instruction: string }[];
        };
      };
    };
  }[];
};

export function ClassroomJoin({ onBack }: { onBack(): void }) {
  const { text } = useLanguage();
  const [code, setCode] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [membership, setMembership] = useState<Membership>();
  const [status, setStatus] = useState<"loading" | "ready" | "busy" | "disabled">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/classroom/join", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          status?: string;
          membership?: Membership;
          error?: { code?: string };
        };
        if (!active) return;
        if (response.ok && payload.membership) setMembership(payload.membership);
        if (
          payload.status === "disabled" ||
          payload.error?.code === "classroom_pilot_unavailable"
        ) {
          setStatus("disabled");
        } else {
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) setStatus("disabled");
      });
    return () => {
      active = false;
    };
  }, []);

  const join = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("busy");
    setMessage("");
    try {
      const response = await fetch("/api/classroom/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pseudonym }),
      });
      const payload = (await response.json()) as {
        membership?: Membership;
        error?: { code?: string };
      };
      if (!response.ok || !payload.membership) {
        const errorCode = payload.error?.code;
        setMessage(
          errorCode === "learner_alias_conflict"
            ? text(
                "This pseudonym is already used in this class. Choose another one.",
                "Ce pseudonyme est déjà utilisé dans cette classe. Choisis-en un autre.",
              )
            : text(
                "Check the class code. It may be invalid or expired.",
                "Vérifie le code de classe. Il est peut-être invalide ou expiré.",
              ),
        );
        return;
      }
      setMembership(payload.membership);
      setCode("");
      setPseudonym("");
    } catch {
      setMessage(
        text(
          "The class service is temporarily unavailable.",
          "Le service de classe est temporairement indisponible.",
        ),
      );
    } finally {
      setStatus("ready");
    }
  };

  const leave = async () => {
    setStatus("busy");
    try {
      await fetch("/api/classroom/join", { method: "DELETE" });
    } finally {
      setMembership(undefined);
      setStatus("ready");
    }
  };

  return (
    <section className="classroom-join-screen" aria-labelledby="classroom-join-title">
      <div className="teacher-screen-topbar">
        <button type="button" className="screen-back" onClick={onBack}>
          {text("Back home", "Retour à l'accueil")}
        </button>
        <span>{text("No email · no legal name", "Sans e-mail · sans nom légal")}</span>
      </div>

      <div className="classroom-join-layout">
        <header>
          <p className="eyebrow">{text("My class", "Ma classe")}</p>
          <h1 id="classroom-join-title" tabIndex={-1} data-screen-title>
            {membership
              ? text("You're in.", "Tu as rejoint la classe.")
              : text("Join with your class code.", "Rejoins ta classe avec son code.")}
          </h1>
          <p>
            {text(
              "Use only the temporary code from your teacher and a pseudonym your class can recognize.",
              "Utilise seulement le code temporaire donné par ton professeur et un pseudonyme que ta classe peut reconnaître.",
            )}
          </p>
        </header>

        <div className="classroom-join-card">
          {status === "loading" ? (
            <p role="status">{text("Checking your class…", "Recherche de ta classe…")}</p>
          ) : status === "disabled" ? (
            <p role="alert">
              {text(
                "The class pilot is not available in this environment yet.",
                "Le pilote classe n'est pas encore disponible dans cet environnement.",
              )}
            </p>
          ) : membership ? (
            <div className="classroom-membership">
              <span>{text("Class joined", "Classe rejointe")}</span>
              <strong>{membership.classroom.label}</strong>
              <p>
                {text("Your pseudonym:", "Ton pseudonyme :")} {membership.learnerAlias.pseudonym}
              </p>
              {membership.assignments.length === 0 ? (
                <div className="classroom-next-activity">
                  <small>{text("Next step", "Prochaine étape")}</small>
                  <b>
                    {text(
                      "Your teacher will assign the first activity here.",
                      "Ton professeur attribuera ici la première activité.",
                    )}
                  </b>
                </div>
              ) : (
                <div className="classroom-assignment-receipts">
                  <h2>{text("Activities received", "Activités reçues")}</h2>
                  <ul>
                    {membership.assignments.map((assignment) => (
                      <li key={assignment.id}>
                        <span>{text("Ready", "Prête")}</span>
                        <strong>
                          {assignment.publication.content.exercise.title}
                        </strong>
                        <p>{assignment.publication.content.exercise.objective}</p>
                        <small>
                          {assignment.publication.content.exercise.missions.length} {text("missions", "missions")} · {text("contract", "contrat")} {assignment.contractHash.slice(0, 12)}
                        </small>
                        <p>
                          {text(
                            "Your teacher assigned this exact activity. Opening and resuming the GeoGebra work comes next.",
                            "Ton professeur a affecté cette activité exacte. L'ouverture et la reprise du travail GeoGebra arrivent ensuite.",
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button type="button" onClick={leave} disabled={status === "busy"}>
                {text("Leave this class on this device", "Quitter cette classe sur cet appareil")}
              </button>
            </div>
          ) : (
            <form onSubmit={join}>
              <div className="classroom-join-field">
                <label htmlFor="classroom-code">
                  {text("Class code", "Code de classe")}
                </label>
                <input
                  id="classroom-code"
                  value={code}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  placeholder="ABCD-EFGH-JKLM"
                  minLength={12}
                  maxLength={32}
                  required
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                />
              </div>
              <div className="classroom-join-field">
                <label htmlFor="classroom-pseudonym">
                  {text("Class pseudonym", "Pseudonyme de classe")}
                </label>
                <input
                  id="classroom-pseudonym"
                  aria-describedby="classroom-pseudonym-help"
                  value={pseudonym}
                  autoComplete="off"
                  minLength={2}
                  maxLength={32}
                  required
                  onChange={(event) => setPseudonym(event.target.value)}
                />
                <small id="classroom-pseudonym-help">
                  {text(
                    "Do not enter your email or full legal name.",
                    "Ne saisis ni ton e-mail ni ton nom complet.",
                  )}
                </small>
              </div>
              <button type="submit" disabled={status === "busy"}>
                {status === "busy"
                  ? text("Joining…", "Connexion…")
                  : text("Join my class", "Rejoindre ma classe")}
              </button>
            </form>
          )}
          {message ? <p className="classroom-join-message" role="alert">{message}</p> : null}
        </div>
      </div>
    </section>
  );
}

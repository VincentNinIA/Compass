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

type PublicGroup = {
  id: string;
  label: string;
  learnerAliasIds: string[];
};

type AssignmentTarget =
  | { kind: "classroom"; classroomId: string }
  | { kind: "group"; groupId: string }
  | { kind: "learner"; learnerAliasId: string };

type PublicAssignment = {
  id: string;
  status: "scheduled" | "active" | "closed" | "revoked";
  target: AssignmentTarget;
  contractHash: string;
  opensAt: number;
  closesAt: number;
  recipientAliasIds: string[];
  publication: ActivityPublication;
};

type ActivityPublication = {
  content: {
    exercise: {
      title: string;
      objective: string;
      missions: { id: string; title: string; instruction: string }[];
      assistancePolicy: { mode: "light" | "standard" | "reinforced" };
    };
  };
};

type ActivityCatalogEntry = {
  catalogId: "varignon-pdf.v1";
  sourceDocument: "math.pdf";
  sourceSha256: string;
  locale: "fr" | "en";
  contractHash: string;
  publication: ActivityPublication;
};

type PublicClassroom = {
  id: string;
  label: string;
  status: "active" | "archived" | "revoked";
  createdAt: number;
  joinCodeExpiresAt: number | null;
  expiresAt: number;
  learnerAliases: PublicLearnerAlias[];
  groups: PublicGroup[];
  assignments: PublicAssignment[];
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
  const [catalogEntry, setCatalogEntry] = useState<ActivityCatalogEntry>();
  const [revealedCodes, setRevealedCodes] = useState<Record<string, string>>({});
  const [groupDrafts, setGroupDrafts] = useState<
    Record<string, { label: string; learnerAliasIds: string[] }>
  >({});
  const [assignmentTargets, setAssignmentTargets] = useState<Record<string, string>>({});
  const [assignmentStarts, setAssignmentStarts] = useState<Record<string, string>>({});
  const [assignmentDurations, setAssignmentDurations] = useState<Record<string, number>>({});
  const [assignmentRetries, setAssignmentRetries] = useState<
    Record<string, { fingerprint: string; idempotencyKey: string }>
  >({});
  const [assignmentClock, setAssignmentClock] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadClasses = useCallback(async () => {
    const [classesResponse, catalogResponse] = await Promise.all([
      fetch("/api/classroom/teacher/classes", { cache: "no-store" }),
      fetch(`/api/classroom/teacher/assignments?locale=${language}`, {
        cache: "no-store",
      }),
    ]);
    if (!classesResponse.ok) {
      throw new Error(await responseError(classesResponse));
    }
    if (!catalogResponse.ok) {
      throw new Error(await responseError(catalogResponse));
    }
    const payload = (await classesResponse.json()) as {
      classrooms?: PublicClassroom[];
    };
    const catalogPayload = (await catalogResponse.json()) as {
      catalog?: ActivityCatalogEntry[];
    };
    setClassrooms(payload.classrooms ?? []);
    setCatalogEntry(catalogPayload.catalog?.[0]);
  }, [language]);

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

  useEffect(() => {
    if (!activated) return;
    const interval = window.setInterval(() => setAssignmentClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [activated]);

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

  const createGroup = async (event: FormEvent, classroomId: string) => {
    event.preventDefault();
    const draft = groupDrafts[classroomId];
    if (!draft?.label.trim() || draft.learnerAliasIds.length === 0) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classroom/teacher/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_group",
          classroomId,
          label: draft.label,
          learnerAliasIds: draft.learnerAliasIds,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setGroupDrafts((current) => ({
        ...current,
        [classroomId]: { label: "", learnerAliasIds: [] },
      }));
      await loadClasses();
      setMessage(text("Group created.", "Groupe créé."));
    } catch {
      setMessage(
        text(
          "The group could not be created.",
          "Le groupe n'a pas pu être créé.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const assignActivity = async (event: FormEvent, classroom: PublicClassroom) => {
    event.preventDefault();
    if (!catalogEntry) return;
    const target = parseTarget(
      assignmentTargets[classroom.id] ?? `classroom:${classroom.id}`,
    );
    if (!target) return;
    const startValue = assignmentStarts[classroom.id];
    const opensAt = startValue
      ? new Date(startValue).getTime()
      : assignmentClock + 5 * 60 * 1_000;
    const durationDays = assignmentDurations[classroom.id] ?? 7;
    const closesAt = opensAt + durationDays * 24 * 60 * 60 * 1_000;
    const fingerprint = JSON.stringify({
      target,
      contractHash: catalogEntry.contractHash,
      opensAt,
      closesAt,
    });
    const existingRetry = assignmentRetries[classroom.id];
    const idempotencyKey =
      existingRetry?.fingerprint === fingerprint
        ? existingRetry.idempotencyKey
        : crypto.randomUUID();
    setAssignmentRetries((current) => ({
      ...current,
      [classroom.id]: { fingerprint, idempotencyKey },
    }));
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classroom/teacher/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign",
          catalogId: catalogEntry.catalogId,
          classroomId: classroom.id,
          target,
          locale: language,
          expectedContractHash: catalogEntry.contractHash,
          idempotencyKey,
          opensAt,
          closesAt,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      await loadClasses();
      setAssignmentStarts((current) => {
        const next = { ...current };
        delete next[classroom.id];
        return next;
      });
      setAssignmentRetries((current) => {
        const next = { ...current };
        delete next[classroom.id];
        return next;
      });
      setAssignmentClock(Date.now());
      setMessage(
        text(
          "Varignon assigned to the resolved recipients.",
          "Varignon est affecté aux destinataires résolus.",
        ),
      );
    } catch {
      setMessage(
        text(
          "The activity could not be assigned. Check the target and dates.",
          "L'activité n'a pas pu être affectée. Vérifiez la cible et les dates.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const revokeAssignment = async (
    classroomId: string,
    assignmentId: string,
  ) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/classroom/teacher/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", classroomId, assignmentId }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      await loadClasses();
      setMessage(text("Assignment withdrawn.", "Affectation retirée."));
    } catch {
      setMessage(
        text(
          "The assignment could not be withdrawn.",
          "L'affectation n'a pas pu être retirée.",
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
      setCatalogEntry(undefined);
      setRevealedCodes({});
      setGroupDrafts({});
      setAssignmentTargets({});
      setAssignmentStarts({});
      setAssignmentDurations({});
      setAssignmentRetries({});
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
          onClick={() => {
            setAssignmentClock(Date.now());
            setActivated(true);
          }}
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

                  {entry.status === "active" && entry.learnerAliases.length > 0 ? (
                    <section
                      className="classroom-groups"
                      aria-label={`${text("Learning groups", "Groupes de travail")} · ${entry.label}`}
                    >
                      <div>
                        <h4 id={`groups-${entry.id}`}>{text("Learning groups", "Groupes de travail")}</h4>
                        <p>
                          {text(
                            "Create a fixed group from the current pseudonyms.",
                            "Créez un groupe fixe à partir des pseudonymes actuels.",
                          )}
                        </p>
                      </div>
                      {entry.groups.length > 0 ? (
                        <ul className="classroom-group-list">
                          {entry.groups.map((group) => (
                            <li key={group.id}>
                              <strong>{group.label}</strong>
                              <span>
                                {group.learnerAliasIds
                                  .map(
                                    (aliasId) =>
                                      entry.learnerAliases.find(({ id }) => id === aliasId)
                                        ?.pseudonym,
                                  )
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <form onSubmit={(event) => void createGroup(event, entry.id)}>
                        <label htmlFor={`group-label-${entry.id}`}>
                          {text("Group name", "Nom du groupe")}
                        </label>
                        <input
                          id={`group-label-${entry.id}`}
                          value={groupDrafts[entry.id]?.label ?? ""}
                          maxLength={80}
                          required
                          onChange={(event) =>
                            setGroupDrafts((current) => ({
                              ...current,
                              [entry.id]: {
                                label: event.target.value,
                                learnerAliasIds:
                                  current[entry.id]?.learnerAliasIds ?? [],
                              },
                            }))
                          }
                        />
                        <fieldset>
                          <legend>{text("Pseudonyms in this group", "Pseudonymes de ce groupe")}</legend>
                          {entry.learnerAliases.map((alias) => (
                            <label key={alias.id}>
                              <input
                                type="checkbox"
                                checked={
                                  groupDrafts[entry.id]?.learnerAliasIds.includes(alias.id) ??
                                  false
                                }
                                onChange={(event) =>
                                  setGroupDrafts((current) => {
                                    const draft = current[entry.id] ?? {
                                      label: "",
                                      learnerAliasIds: [],
                                    };
                                    const learnerAliasIds = event.target.checked
                                      ? [...new Set([...draft.learnerAliasIds, alias.id])]
                                      : draft.learnerAliasIds.filter(
                                          (candidate) => candidate !== alias.id,
                                        );
                                    return {
                                      ...current,
                                      [entry.id]: { ...draft, learnerAliasIds },
                                    };
                                  })
                                }
                              />
                              {alias.pseudonym}
                            </label>
                          ))}
                        </fieldset>
                        <button
                          type="submit"
                          disabled={
                            busy ||
                            !(groupDrafts[entry.id]?.label.trim()) ||
                            !(groupDrafts[entry.id]?.learnerAliasIds.length)
                          }
                        >
                          {text("Create group", "Créer le groupe")}
                        </button>
                      </form>
                    </section>
                  ) : null}

                  {catalogEntry ? (
                    <section
                      className="classroom-assignment-studio"
                      aria-label={`${catalogEntry.publication.content.exercise.title} · ${entry.label}`}
                    >
                      <header>
                        <div>
                          <span>{text("Approved activity", "Activité approuvée")}</span>
                          <h4 id={`assignment-${entry.id}`}>
                            {catalogEntry.publication.content.exercise.title}
                          </h4>
                        </div>
                        <code>{catalogEntry.contractHash.slice(0, 12)}</code>
                      </header>
                      <p>{catalogEntry.publication.content.exercise.objective}</p>
                      <p className="classroom-assignment-source">
                        {text("Source", "Source")} : {catalogEntry.sourceDocument} · {text("9 missions", "9 missions")} · {text("standard support", "aide standard")}
                      </p>
                      <details>
                        <summary>{text("Preview the exact missions", "Prévisualiser les missions exactes")}</summary>
                        <ol>
                          {catalogEntry.publication.content.exercise.missions.map((mission) => (
                            <li key={mission.id}>
                              <strong>{mission.title}</strong>
                              <span>{mission.instruction}</span>
                            </li>
                          ))}
                        </ol>
                      </details>

                      {entry.status === "active" ? (
                        <form onSubmit={(event) => void assignActivity(event, entry)}>
                          <label htmlFor={`assignment-target-${entry.id}`}>
                            {text("Recipients", "Destinataires")}
                          </label>
                          <select
                            id={`assignment-target-${entry.id}`}
                            value={
                              assignmentTargets[entry.id] ??
                              `classroom:${entry.id}`
                            }
                            onChange={(event) =>
                              setAssignmentTargets((current) => ({
                                ...current,
                                [entry.id]: event.target.value,
                              }))
                            }
                          >
                            <option value={`classroom:${entry.id}`}>
                              {text("Whole class now", "Toute la classe maintenant")}
                            </option>
                            {entry.groups.map((group) => (
                              <option key={group.id} value={`group:${group.id}`}>
                                {text("Group", "Groupe")} · {group.label}
                              </option>
                            ))}
                            {entry.learnerAliases.map((alias) => (
                              <option key={alias.id} value={`learner:${alias.id}`}>
                                {text("Pseudonym", "Pseudonyme")} · {alias.pseudonym}
                              </option>
                            ))}
                          </select>
                          <label htmlFor={`assignment-start-${entry.id}`}>
                            {text("Opens at", "Ouverture")}
                          </label>
                          <input
                            id={`assignment-start-${entry.id}`}
                            type="datetime-local"
                            step={1}
                            min={toLocalDateTimeInput(assignmentClock + 1_000)}
                            value={
                              assignmentStarts[entry.id] ??
                              toLocalDateTimeInput(assignmentClock + 5 * 60_000)
                            }
                            required
                            onChange={(event) =>
                              setAssignmentStarts((current) => ({
                                ...current,
                                [entry.id]: event.target.value,
                              }))
                            }
                          />
                          <label htmlFor={`assignment-duration-${entry.id}`}>
                            {text("Available for", "Disponible pendant")}
                          </label>
                          <select
                            id={`assignment-duration-${entry.id}`}
                            value={assignmentDurations[entry.id] ?? 7}
                            onChange={(event) =>
                              setAssignmentDurations((current) => ({
                                ...current,
                                [entry.id]: Number(event.target.value),
                              }))
                            }
                          >
                            {[1, 7, 14, 30].map((days) => (
                              <option key={days} value={days}>
                                {days} {text(days === 1 ? "day" : "days", days === 1 ? "jour" : "jours")}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            disabled={busy || entry.learnerAliases.length === 0}
                          >
                            {text("Assign exact Varignon activity", "Affecter l'activité Varignon exacte")}
                          </button>
                        </form>
                      ) : null}

                      {entry.assignments.length > 0 ? (
                        <ul className="classroom-assignment-list">
                          {entry.assignments.map((assignment) => (
                            <li key={assignment.id} data-status={assignment.status}>
                              <div>
                                <strong>{assignment.publication.content.exercise.title}</strong>
                                <span>
                                  {assignmentTargetLabel(assignment.target, entry, text)} · {assignment.recipientAliasIds.length} {text("recipients", "destinataires")}
                                </span>
                              </div>
                              <small>
                                {formatAssignmentWindow(
                                  assignment.opensAt,
                                  assignment.closesAt,
                                  french,
                                )}
                              </small>
                              <b>{assignment.status}</b>
                              {assignment.status === "active" || assignment.status === "scheduled" ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void revokeAssignment(entry.id, assignment.id)
                                  }
                                >
                                  {text("Withdraw", "Retirer")}
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  ) : null}
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

function parseTarget(value: string): AssignmentTarget | null {
  const [kind, id] = value.split(":", 2);
  if (!id) return null;
  if (kind === "classroom") return { kind, classroomId: id };
  if (kind === "group") return { kind, groupId: id };
  if (kind === "learner") return { kind, learnerAliasId: id };
  return null;
}

function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const localTimestamp = timestamp - date.getTimezoneOffset() * 60_000;
  return new Date(localTimestamp).toISOString().slice(0, 19);
}

function formatAssignmentWindow(
  opensAt: number,
  closesAt: number,
  french: boolean,
): string {
  const formatter = new Intl.DateTimeFormat(french ? "fr-FR" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatter.format(opensAt)} → ${formatter.format(closesAt)}`;
}

function assignmentTargetLabel(
  target: AssignmentTarget,
  classroom: PublicClassroom,
  translate: (english: string, french: string) => string,
): string {
  if (target.kind === "classroom") {
    return translate("Whole class", "Toute la classe");
  }
  if (target.kind === "group") {
    return (
      classroom.groups.find(({ id }) => id === target.groupId)?.label ??
      translate("Group", "Groupe")
    );
  }
  return (
    classroom.learnerAliases.find(({ id }) => id === target.learnerAliasId)
      ?.pseudonym ?? translate("Pseudonym", "Pseudonyme")
  );
}

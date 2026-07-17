"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  ExerciseUploader,
  type SelectedExerciseImage,
} from "./exercise-uploader";
import {
  EXERCISE_AMBIGUITY_CODES_V1,
  EXERCISE_REFUSAL_MESSAGE_V1,
  EXERCISE_UNSUPPORTED_MESSAGE_V1,
  createExerciseReadyClientExtractionV1,
  getExerciseClarificationMessageV1,
  validateExerciseExtractionWireV1,
  validateExercisePlanV1,
  type ExerciseAmbiguityCodeV1,
} from "@/lib/exercise/exercise-contracts";
import {
  GENERAL_EXERCISE_AMBIGUITY_CODES_V1,
  GENERAL_EXERCISE_REFUSAL_MESSAGE_V1,
  getGeneralExerciseClarificationMessageV1,
  parseGeneralExerciseReadyV1,
  type GeneralExerciseAmbiguityCodeV1,
} from "@/lib/exercise/general-exercise-contracts";
import {
  INITIAL_EXERCISE_CONFIRMATION_STATE,
  MAX_EXERCISE_CLARIFICATION_CHARACTERS,
  MAX_EXERCISE_CLARIFICATIONS,
  countClarificationCharacters,
  exerciseConfirmationReducer,
  type ConfirmedExercise,
  type ExerciseConfirmationState,
} from "@/lib/exercise/exercise-confirmation";
import type { ParseExerciseResult } from "@/lib/exercise/exercise-parse-route";
import type { LatencyBudgetMonitor } from "@/lib/reliability/latency-budget";
import { parseAppErrorPayload } from "@/lib/reliability/app-error";
import { useLanguage } from "@/components/language-provider";
import { useMascotController } from "@/components/compass-mascot";

type ParseExerciseInput = {
  file: File;
  clarification: string | null;
  requestId: string;
  signal: AbortSignal;
};

export type ExerciseParser = (
  input: ParseExerciseInput,
) => Promise<ParseExerciseResult>;

type ExerciseConfirmationProps = {
  onConfirmed: (confirmation: ConfirmedExercise) => void;
  onDraftChanged?: () => void;
  onAnalysisStarted?: () => void;
  initializationState?: ExerciseInitializationViewState;
  onRetryInitialization?: () => void;
  parseExercise?: ExerciseParser;
  createRequestId?: () => string;
  createConfirmationId?: () => string;
  now?: () => number;
  resetToken?: number;
  latencyMonitor?: LatencyBudgetMonitor;
  view?: "combined" | "upload" | "confirmation";
};

export type ExerciseInitializationViewState =
  | { status: "idle" }
  | { status: "waiting_for_applet" }
  | { status: "initializing" }
  | { status: "initialized"; snapshotHash: string }
  | { status: "reset" }
  | {
      status: "failed";
      code: string;
      rolledBack: boolean;
      retryable: boolean;
    };

function createId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `${prefix}-${Date.now()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExerciseAmbiguityCodeV1(
  value: unknown,
): value is ExerciseAmbiguityCodeV1 {
  return (
    typeof value === "string" &&
    (EXERCISE_AMBIGUITY_CODES_V1 as readonly string[]).includes(value)
  );
}

function isGeneralExerciseAmbiguityCodeV1(
  value: unknown,
): value is GeneralExerciseAmbiguityCodeV1 {
  return (
    typeof value === "string" &&
    (GENERAL_EXERCISE_AMBIGUITY_CODES_V1 as readonly string[]).includes(value)
  );
}

export function parseExerciseResultPayload(
  value: unknown,
): ParseExerciseResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new Error("invalid_parse_result");
  }

  if (value.status === "ready") {
    const extraction = validateExerciseExtractionWireV1(value.extraction);
    const plan = validateExercisePlanV1(value.plan);
    if (
      !extraction.success ||
      extraction.data.outcome !== "ready" ||
      !plan.success
    ) {
      throw new Error("invalid_parse_result");
    }
    return {
      status: "ready",
      extraction: createExerciseReadyClientExtractionV1(extraction.data),
      plan: plan.data,
    };
  }

  if (value.status === "ready_general") {
    return {
      status: "ready_general",
      exercise: parseGeneralExerciseReadyV1(value.exercise),
    };
  }

  if (
    value.status === "needs_clarification" &&
    isExerciseAmbiguityCodeV1(value.code)
  ) {
    return {
      status: "needs_clarification",
      code: value.code,
      question: getExerciseClarificationMessageV1(value.code),
    };
  }

  if (
    value.status === "needs_clarification_general" &&
    isGeneralExerciseAmbiguityCodeV1(value.code)
  ) {
    return {
      status: "needs_clarification_general",
      code: value.code,
      question: getGeneralExerciseClarificationMessageV1(value.code),
    };
  }

  if (value.status === "unsupported") {
    return {
      status: "unsupported",
      reason: EXERCISE_UNSUPPORTED_MESSAGE_V1,
    };
  }

  if (value.status === "refused") {
    return { status: "refused", message: EXERCISE_REFUSAL_MESSAGE_V1 };
  }

  if (value.status === "refused_general") {
    return {
      status: "refused_general",
      message: GENERAL_EXERCISE_REFUSAL_MESSAGE_V1,
    };
  }

  throw new Error("invalid_parse_result");
}

export class ExerciseParseRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly correlationId: string,
    userMessage: string,
  ) {
    super(`${userMessage} Reference ${correlationId}.`);
    this.name = "ExerciseParseRequestError";
  }
}

export const fetchExerciseParse: ExerciseParser = async ({
  file,
  clarification,
  signal,
}) => {
  const body = new FormData();
  body.append("image", file);
  if (clarification !== null) body.append("clarification", clarification);

  const response = await fetch("/api/exercise/parse", {
    method: "POST",
    body,
    cache: "no-store",
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const appError = parseAppErrorPayload(payload);
    if (appError?.domain === "exercise_parse") {
      throw new ExerciseParseRequestError(
        appError.code,
        appError.retryable,
        appError.correlationId,
        appError.userMessage,
      );
    }
    throw new ExerciseParseRequestError(
      "parse_request_failed",
      true,
      "exercise_parse_unavailable",
      "Exercise analysis is temporarily unavailable. Retry manually.",
    );
  }
  return parseExerciseResultPayload(payload);
};

type Localize = (english: string, french: string) => string;

function stateAnnouncement(
  state: ExerciseConfirmationState,
  text: Localize,
): string {
  switch (state.status) {
    case "idle":
      return text("Add a photo above to begin.", "Ajoute une photo ci-dessus pour commencer.");
    case "preview":
      return text(
        "Your photo is ready. Read it when you want to continue.",
        "Ta photo est prête. Lance la lecture quand tu veux continuer.",
      );
    case "parsing":
      return text(
        "I’m reading the question and looking for the important details.",
        "Je lis l'énoncé et je repère les informations importantes.",
      );
    case "needs_clarification":
      return state.clarificationCount >= MAX_EXERCISE_CLARIFICATIONS
        ? text(
            "I still need a clearer photo to understand this exercise.",
            "J'ai encore besoin d'une photo plus nette pour comprendre cet exercice.",
          )
        : text(
            "I need one small detail before we continue.",
            "Il me manque un petit détail avant de continuer.",
          );
    case "awaiting_confirmation":
    case "awaiting_general_confirmation":
      return text(
        "I found the exercise. Check it before we build.",
        "J'ai trouvé l'exercice. Vérifie-le avant de construire.",
      );
    case "confirmed":
      return text(
        "Great — your workspace is getting ready.",
        "Parfait — ton espace de travail se prépare.",
      );
    case "unsupported":
      return text(
        "I can’t guide this type of exercise yet.",
        "Je ne peux pas encore guider ce type d'exercice.",
      );
    case "refused":
      return text(
        "I couldn’t read enough from this photo.",
        "Je n'ai pas réussi à lire suffisamment cette photo.",
      );
    case "failed":
      return text(
        "I couldn’t read the exercise. Try again or choose another photo.",
        "Je n'ai pas pu lire l'exercice. Réessaie ou choisis une autre photo.",
      );
  }
}

function localizedClarification(
  code: ExerciseAmbiguityCodeV1 | GeneralExerciseAmbiguityCodeV1,
  fallback: string,
  text: Localize,
) {
  const french = {
    missing_labels: "Quelles sont les lettres des extrémités du segment ?",
    unreadable_text: "Que dit l'énoncé de l'exercice ?",
    conflicting_instruction: "Dois-tu construire la médiatrice de AB ?",
    missing_segment: "Quels sont les deux points qui définissent le segment ?",
    cropped_content: "Peux-tu inclure l'exercice entier dans la photo ?",
    missing_context: "Quelles informations accompagnent la question ?",
    conflicting_content: "Quelle consigne dois-je suivre ?",
  } satisfies Record<ExerciseAmbiguityCodeV1 | GeneralExerciseAmbiguityCodeV1, string>;
  return text(fallback, french[code]);
}

export function ExerciseConfirmation({
  onConfirmed,
  onDraftChanged,
  onAnalysisStarted,
  initializationState = { status: "idle" },
  onRetryInitialization,
  parseExercise = fetchExerciseParse,
  createRequestId = () => createId("request"),
  createConfirmationId = () => createId("confirmation"),
  now = Date.now,
  resetToken = 0,
  latencyMonitor,
  view = "combined",
}: ExerciseConfirmationProps) {
  const { text } = useLanguage();
  const {
    start: startMascot,
    stop: stopMascot,
    pulse: pulseMascot,
  } = useMascotController();
  const [state, dispatch] = useReducer(
    exerciseConfirmationReducer,
    INITIAL_EXERCISE_CONFIRMATION_STATE,
  );
  const [clarification, setClarification] = useState("");
  const [clarificationError, setClarificationError] = useState<string>();
  const [cleanupToken, setCleanupToken] = useState(0);
  const confirmationLock = useRef(false);
  const workflowFocus = useRef<HTMLHeadingElement>(null);
  const previousResetToken = useRef(resetToken);
  const activeMascotAnalysis = useRef<string | undefined>(undefined);
  const pendingRequest = useRef<
    { requestId: string; controller: AbortController } | undefined
  >(undefined);

  const cancelPendingRequest = useCallback(() => {
    pendingRequest.current?.controller.abort();
    pendingRequest.current = undefined;
  }, []);

  const stopActiveMascotAnalysis = useCallback(() => {
    const source = activeMascotAnalysis.current;
    if (!source) return;
    activeMascotAnalysis.current = undefined;
    stopMascot(source);
  }, [stopMascot]);

  useEffect(
    () => () => {
      cancelPendingRequest();
      stopActiveMascotAnalysis();
      stopMascot("exercise-received");
    },
    [cancelPendingRequest, stopActiveMascotAnalysis, stopMascot],
  );

  useEffect(() => {
    if (previousResetToken.current === resetToken) return;
    previousResetToken.current = resetToken;
    cancelPendingRequest();
    stopActiveMascotAnalysis();
    stopMascot("exercise-received");
    confirmationLock.current = false;
    setClarification("");
    setClarificationError(undefined);
    dispatch({ type: "image_cleared" });
    setCleanupToken((current) => current + 1);
  }, [cancelPendingRequest, resetToken, stopActiveMascotAnalysis, stopMascot]);

  useEffect(() => {
    if (
      state.status !== "idle" &&
      state.status !== "preview" &&
      state.status !== "parsing"
    ) {
      workflowFocus.current?.focus();
    }
  }, [state.status]);

  const resolveParse = useCallback(
    async (file: File, clarificationText: string | null, requestId: string) => {
      const startedAt = now();
      cancelPendingRequest();
      stopActiveMascotAnalysis();
      const mascotSource = `exercise-analysis:${requestId}`;
      activeMascotAnalysis.current = mascotSource;
      startMascot(mascotSource, "thinking");
      const controller = new AbortController();
      pendingRequest.current = { requestId, controller };
      try {
        const result = await parseExercise({
          file,
          clarification: clarificationText,
          requestId,
          signal: controller.signal,
        });
        if (result.status !== "needs_clarification") {
          setClarification("");
          setClarificationError(undefined);
        }
        dispatch({ type: "parse_resolved", requestId, result });
        if (result.status === "unsupported" || result.status === "refused") {
          pulseMascot("exercise-analysis-error", "error", 2_400);
        }
      } catch (error) {
        dispatch({
          type: "parse_failed",
          requestId,
          message:
            error instanceof ExerciseParseRequestError
              ? text(
                  error.message,
                  `L'analyse de l'exercice est indisponible. Référence ${error.correlationId}.`,
                )
              : text(
                  "Analysis is temporarily unavailable. Retry when you are ready.",
                  "L'analyse est temporairement indisponible. Réessaie quand tu veux.",
                ),
        });
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          pulseMascot("exercise-analysis-error", "error", 2_400);
        }
      } finally {
        stopMascot(mascotSource);
        if (activeMascotAnalysis.current === mascotSource) {
          activeMascotAnalysis.current = undefined;
        }
        latencyMonitor?.record("image", Math.max(0, now() - startedAt));
        if (pendingRequest.current?.requestId === requestId) {
          pendingRequest.current = undefined;
        }
      }
    },
    [
      cancelPendingRequest,
      latencyMonitor,
      now,
      parseExercise,
      pulseMascot,
      startMascot,
      stopActiveMascotAnalysis,
      stopMascot,
      text,
    ],
  );

  const handleSelectionChange = useCallback(
    (selection?: SelectedExerciseImage) => {
      cancelPendingRequest();
      stopActiveMascotAnalysis();
      stopMascot("exercise-received");
      onDraftChanged?.();
      confirmationLock.current = false;
      setClarification("");
      setClarificationError(undefined);
      dispatch(
        selection
          ? { type: "image_selected", file: selection.file }
          : { type: "image_cleared" },
      );
      if (selection) {
        pulseMascot("exercise-received", "receiving", 2_200);
      }
    },
    [
      cancelPendingRequest,
      onDraftChanged,
      pulseMascot,
      stopActiveMascotAnalysis,
      stopMascot,
    ],
  );

  const handleAnalyze = useCallback(
    async (selection: SelectedExerciseImage) => {
      if (state.status !== "preview" || state.file !== selection.file) return;

      const requestId = createRequestId();
      dispatch({ type: "parse_started", requestId });
      onAnalysisStarted?.();
      await resolveParse(selection.file, null, requestId);
    },
    [createRequestId, onAnalysisStarted, resolveParse, state],
  );

  const handleClarification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.status !== "needs_clarification") return;

    const trimmed = clarification.trim();
    const characterCount = countClarificationCharacters(trimmed);
    if (characterCount === 0) {
      setClarificationError(
        text(
          "Enter a short answer before continuing.",
          "Écris une réponse courte avant de continuer.",
        ),
      );
      return;
    }
    if (characterCount > MAX_EXERCISE_CLARIFICATION_CHARACTERS) {
      setClarificationError(
        text(
          "Keep the clarification to 500 characters or fewer.",
          "Limite ta précision à 500 caractères.",
        ),
      );
      return;
    }
    if (state.clarificationCount >= MAX_EXERCISE_CLARIFICATIONS) return;

    setClarificationError(undefined);
    const requestId = createRequestId();
    dispatch({
      type: "clarification_submitted",
      requestId,
      clarification: trimmed,
    });
    await resolveParse(state.file, trimmed, requestId);
  };

  const handleRetry = async () => {
    if (state.status !== "failed") return;
    const requestId = createRequestId();
    const { file, lastClarification } = state;
    dispatch({ type: "retry_started", requestId });
    await resolveParse(file, lastClarification, requestId);
  };

  const handleConfirm = () => {
    if (
      (state.status !== "awaiting_confirmation" &&
        state.status !== "awaiting_general_confirmation") ||
      confirmationLock.current
    ) {
      return;
    }

    confirmationLock.current = true;
    let confirmation: ConfirmedExercise;
    if (state.status === "awaiting_general_confirmation") {
      let exercise;
      try {
        exercise = parseGeneralExerciseReadyV1(state.exercise);
      } catch {
        confirmationLock.current = false;
        dispatch({
          type: "confirmation_rejected",
          message: text(
            "The exercise summary changed and must be analyzed again.",
            "Le résumé de l'exercice a changé et doit être analysé à nouveau.",
          ),
        });
        return;
      }
      confirmation = {
        kind: "general",
        exercise,
        confirmationId: createConfirmationId(),
        confirmedAt: now(),
      };
    } else {
      const plan = validateExercisePlanV1(state.plan);
      if (!plan.success) {
        confirmationLock.current = false;
        dispatch({
          type: "confirmation_rejected",
          message: text(
            "The exercise plan changed and must be analyzed again.",
            "Le plan de l'exercice a changé et doit être analysé à nouveau.",
          ),
        });
        return;
      }
      confirmation = {
        plan: plan.data,
        confirmationId: createConfirmationId(),
        confirmedAt: now(),
      };
    }
    dispatch({ type: "confirmed", confirmation });
    try {
      onConfirmed(confirmation);
    } finally {
      setClarification("");
      setClarificationError(undefined);
      setCleanupToken((current) => current + 1);
    }
  };

  const clarificationCharacterCount = countClarificationCharacters(clarification);
  const canClarify =
    state.status === "needs_clarification" &&
    state.clarificationCount < MAX_EXERCISE_CLARIFICATIONS;

  return (
    <>
      <div className="exercise-upload-stage" hidden={view === "confirmation"}>
        <ExerciseUploader
          onAnalyze={handleAnalyze}
          onSelectionChange={handleSelectionChange}
          cleanupToken={cleanupToken}
          analyzeEnabled={state.status === "preview"}
          locked={initializationState.status === "initializing"}
        />
      </div>

      <section
        className="exercise-confirmation spike workspace-card workspace-card-check"
        aria-labelledby="exercise-confirmation-title"
        aria-busy={state.status === "parsing"}
        data-state={state.status}
        hidden={view === "upload"}
      >
        <div className="spike-heading">
          <div>
            <p className="section-index">
              {text("Step 1 · Quick check", "Étape 1 · Vérification rapide")}
            </p>
            <h2 id="exercise-confirmation-title">
              {text("Did I understand it?", "Ai-je bien compris ?")}
            </h2>
          </div>
          <p>
            {text(
              "Nothing changes in your workspace until you say the summary looks right.",
              "Rien ne change dans ton espace tant que tu n'as pas validé le résumé.",
            )}
          </p>
        </div>

        <p className="exercise-flow-status" role="status" aria-live="polite">
          {stateAnnouncement(state, text)}
        </p>

        {initializationState.status === "reset" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              {text("Ready for a new exercise", "Prêt pour un nouvel exercice")}
            </h3>
            <p>
              {text(
                "Your old construction has been cleared. Add another photo whenever you're ready.",
                "Ton ancienne construction a été effacée. Ajoute une autre photo quand tu es prêt.",
              )}
            </p>
          </div>
        ) : null}

        {state.status === "needs_clarification" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              {text("Help me with one detail", "Aide-moi avec un détail")}
            </h3>
            <p className="exercise-question">
              {localizedClarification(state.code, state.question, text)}
            </p>
            {canClarify ? (
              <form onSubmit={(event) => void handleClarification(event)}>
                <label htmlFor="exercise-clarification">
                  {text("Your answer", "Ta réponse")}
                </label>
                <textarea
                  id="exercise-clarification"
                  value={clarification}
                  maxLength={MAX_EXERCISE_CLARIFICATION_CHARACTERS}
                  aria-describedby="exercise-clarification-count"
                  aria-invalid={clarificationError ? true : undefined}
                  onChange={(event) => {
                    setClarification(event.currentTarget.value);
                    setClarificationError(undefined);
                  }}
                />
                <p id="exercise-clarification-count">
                  {clarificationCharacterCount}/500 {text("characters", "caractères")} · {text("clarification", "précision")} {state.clarificationCount + 1} {text("of", "sur")} 2
                </p>
                {clarificationError ? <p role="alert">{clarificationError}</p> : null}
                <button type="submit">
                  {text("Send this detail", "Envoyer ce détail")}
                </button>
              </form>
            ) : (
              <p>
                {text(
                  "I still can't read this one confidently. Try a brighter, straighter photo so we can start cleanly.",
                  "Je n'arrive toujours pas à le lire avec certitude. Essaie une photo plus droite et plus lumineuse.",
                )}
              </p>
            )}
          </div>
        ) : null}

        {state.status === "awaiting_confirmation" ? (
          <div
            className="exercise-flow-panel exercise-summary"
            aria-labelledby="exercise-summary-title"
          >
            <h3 id="exercise-summary-title" ref={workflowFocus} tabIndex={-1}>
              {text("Here's what I found", "Voici ce que j'ai trouvé")}
            </h3>
            <dl>
              <div>
                <dt>{text("The question", "La consigne")}</dt>
                <dd>
                  {text(
                    state.extraction.instruction,
                    "Construis la médiatrice du segment AB.",
                  )}
                </dd>
              </div>
              <div>
                <dt>{text("You already have", "Tu as déjà")}</dt>
                <dd>{text("Points A and B, and segment AB", "Les points A et B, et le segment AB")}</dd>
              </div>
              <div>
                <dt>{text("You'll build", "Tu vas construire")}</dt>
                <dd>{text("The perpendicular bisector of AB", "La médiatrice de AB")}</dd>
              </div>
              <div>
                <dt>{text("You'll discover", "Tu vas comprendre")}</dt>
                <dd>{text("Understand perpendicular bisectors and equidistance", "La médiatrice et l'équidistance")}</dd>
              </div>
            </dl>
            <p className="exercise-initialization-note">
              {text(
                "I'll place A, B and segment AB. The important construction stays yours to make.",
                "Je place A, B et le segment AB. La construction importante reste à toi.",
              )}
            </p>
            <button type="button" onClick={handleConfirm}>
              {text("Looks right — start building", "C'est bon — commencer à construire")}
            </button>
          </div>
        ) : null}

        {state.status === "awaiting_general_confirmation" ? (
          <div
            className="exercise-flow-panel exercise-summary exercise-summary-general"
            aria-labelledby="exercise-summary-title"
          >
            <h3 id="exercise-summary-title" ref={workflowFocus} tabIndex={-1}>
              {text("Here's what I found", "Voici ce que j'ai trouvé")}
            </h3>
            <dl>
              <div>
                <dt>{text("Subject", "Matière")}</dt>
                <dd>{state.exercise.subject.replaceAll("_", " ")}</dd>
              </div>
              {state.exercise.title ? (
                <div>
                  <dt>{text("Title", "Titre")}</dt>
                  <dd>{state.exercise.title}</dd>
                </div>
              ) : null}
              <div>
                <dt>{text("Exercise", "Énoncé")}</dt>
                <dd className="exercise-statement">{state.exercise.statement}</dd>
              </div>
            </dl>
            <div className="exercise-task-summary">
              <h4>{text("What you'll work through", "Les étapes à travailler")}</h4>
              <ol>
                {state.exercise.tasks.map((task, index) => (
                  <li key={`${index}-${task}`}>{task}</li>
                ))}
              </ol>
            </div>
            <p className="exercise-initialization-note">
              {text(
                "Confirm this reading, then Compass will help you one step at a time without changing your exercise.",
                "Confirme cette lecture, puis Compass t'aidera étape par étape sans modifier ton exercice.",
              )}
            </p>
            <button type="button" onClick={handleConfirm}>
              {text("Looks right — start", "C'est bien mon exercice — commencer")}
            </button>
          </div>
        ) : null}

        {state.status === "unsupported" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              {text("Let's try another exercise", "Essayons un autre exercice")}
            </h3>
            <p>
              {text(
                state.reason,
                "Cet exercice n'est pas encore pris en charge.",
              )}
            </p>
            <p>
              {text(
                "For now, choose a perpendicular-bisector exercise using A and B.",
                "Pour le moment, choisis un exercice de médiatrice avec A et B.",
              )}
            </p>
          </div>
        ) : null}

        {state.status === "refused" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              {text("This photo needs another try", "Cette photo mérite un nouvel essai")}
            </h3>
            <p>
              {text(
                state.message,
                "Je n'ai pas pu analyser cet exercice.",
              )}
            </p>
            <p>
              {text(
                "Choose a clearer photo to continue. Nothing has changed yet.",
                "Choisis une photo plus nette pour continuer. Rien n'a encore changé.",
              )}
            </p>
          </div>
        ) : null}

        {state.status === "failed" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              {text("I couldn't read that", "Je n'ai pas réussi à lire ça")}
            </h3>
            <p role="alert">{state.message}</p>
            <button type="button" onClick={() => void handleRetry()}>
              {text("Try reading it again", "Réessayer la lecture")}
            </button>
          </div>
        ) : null}

        {state.status === "confirmed" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              {text("Your exercise is ready", "Ton exercice est prêt")}
            </h3>
            {state.kind === "general" ? (
              <p role="status">
                {text(
                  "Your exercise is now available to the general coach. Choose a step and explain where you're stuck.",
                  "Ton exercice est maintenant disponible pour le coach généraliste. Choisis une étape et explique où tu bloques.",
                )}
              </p>
            ) : null}
            {state.kind === "legacy_mediator" && initializationState.status === "idle" ? (
              <p>
                {text(
                  "I understood the plan and I'm preparing your canvas.",
                  "J'ai compris le plan et je prépare ton espace.",
                )}
              </p>
            ) : null}
            {state.kind === "legacy_mediator" && initializationState.status === "waiting_for_applet" ? (
              <p role="status">
                {text("Opening your geometry workspace…", "Ouverture de ton espace de géométrie…")}
              </p>
            ) : null}
            {state.kind === "legacy_mediator" && initializationState.status === "initializing" ? (
              <p role="status">
                {text("Placing A, B and AB for you…", "Placement de A, B et AB…")}
              </p>
            ) : null}
            {state.kind === "legacy_mediator" && initializationState.status === "initialized" ? (
              <p role="status">
                {text(
                  "Canvas initialized with A, B and AB only. Your turn: construct the perpendicular bisector.",
                  "L'espace contient seulement A, B et AB. À toi de construire la médiatrice.",
                )}
              </p>
            ) : null}
            {state.kind === "legacy_mediator" && initializationState.status === "failed" ? (
              <div>
                <p role="alert">
                  {initializationState.code === "recovery_required"
                    ? text(
                        "The exact rollback could not be verified. Use Reset construction or reload before continuing.",
                        "La restauration exacte n'a pas pu être vérifiée. Réinitialise la construction ou recharge la page.",
                      )
                    : initializationState.rolledBack
                      ? text(
                          "Initialization failed and the previous canvas was restored exactly.",
                          "L'initialisation a échoué et l'espace précédent a été restauré exactement.",
                        )
                      : text(
                          "Initialization was refused before the canvas changed.",
                          "L'initialisation a été refusée avant toute modification de l'espace.",
                        )}
                </p>
                {initializationState.retryable && onRetryInitialization ? (
                  <button type="button" onClick={onRetryInitialization}>
                    {initializationState.code === "recovery_required"
                      ? text("Restore canvas and retry", "Restaurer puis réessayer")
                      : text("Retry initialization", "Réessayer l'initialisation")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

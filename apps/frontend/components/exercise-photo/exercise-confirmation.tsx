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
  INITIAL_EXERCISE_CONFIRMATION_STATE,
  MAX_EXERCISE_CLARIFICATION_CHARACTERS,
  MAX_EXERCISE_CLARIFICATIONS,
  countClarificationCharacters,
  exerciseConfirmationReducer,
  type ExerciseConfirmedV1,
  type ExerciseConfirmationState,
} from "@/lib/exercise/exercise-confirmation";
import type { ParseExerciseResultV1 } from "@/lib/exercise/exercise-parse-route";
import type { LatencyBudgetMonitor } from "@/lib/reliability/latency-budget";
import { parseAppErrorPayload } from "@/lib/reliability/app-error";

type ParseExerciseInput = {
  file: File;
  clarification: string | null;
  requestId: string;
  signal: AbortSignal;
};

export type ExerciseParser = (
  input: ParseExerciseInput,
) => Promise<ParseExerciseResultV1>;

type ExerciseConfirmationProps = {
  onConfirmed: (confirmation: ExerciseConfirmedV1) => void;
  onDraftChanged?: () => void;
  initializationState?: ExerciseInitializationViewState;
  onRetryInitialization?: () => void;
  parseExercise?: ExerciseParser;
  createRequestId?: () => string;
  createConfirmationId?: () => string;
  now?: () => number;
  resetToken?: number;
  latencyMonitor?: LatencyBudgetMonitor;
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

export function parseExerciseResultPayload(
  value: unknown,
): ParseExerciseResultV1 {
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

  if (value.status === "unsupported") {
    return {
      status: "unsupported",
      reason: EXERCISE_UNSUPPORTED_MESSAGE_V1,
    };
  }

  if (value.status === "refused") {
    return { status: "refused", message: EXERCISE_REFUSAL_MESSAGE_V1 };
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

function stateAnnouncement(state: ExerciseConfirmationState): string {
  switch (state.status) {
    case "idle":
      return "Add a photo above to begin.";
    case "preview":
      return "Your photo is ready. Read it when you want to continue.";
    case "parsing":
      return "I’m reading the question and looking for the important details.";
    case "needs_clarification":
      return state.clarificationCount >= MAX_EXERCISE_CLARIFICATIONS
        ? "I still need a clearer photo to understand this exercise."
        : "I need one small detail before we continue.";
    case "awaiting_confirmation":
      return "I found the exercise. Check it before we build.";
    case "confirmed":
      return "Great — your workspace is getting ready.";
    case "unsupported":
      return "I can’t guide this type of exercise yet.";
    case "refused":
      return "I couldn’t read enough from this photo.";
    case "failed":
      return "I couldn’t read the exercise. Try again or choose another photo.";
  }
}

export function ExerciseConfirmation({
  onConfirmed,
  onDraftChanged,
  initializationState = { status: "idle" },
  onRetryInitialization,
  parseExercise = fetchExerciseParse,
  createRequestId = () => createId("request"),
  createConfirmationId = () => createId("confirmation"),
  now = Date.now,
  resetToken = 0,
  latencyMonitor,
}: ExerciseConfirmationProps) {
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
  const pendingRequest = useRef<
    { requestId: string; controller: AbortController } | undefined
  >(undefined);

  const cancelPendingRequest = useCallback(() => {
    pendingRequest.current?.controller.abort();
    pendingRequest.current = undefined;
  }, []);

  useEffect(() => cancelPendingRequest, [cancelPendingRequest]);

  useEffect(() => {
    if (previousResetToken.current === resetToken) return;
    previousResetToken.current = resetToken;
    cancelPendingRequest();
    confirmationLock.current = false;
    setClarification("");
    setClarificationError(undefined);
    dispatch({ type: "image_cleared" });
    setCleanupToken((current) => current + 1);
  }, [cancelPendingRequest, resetToken]);

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
      } catch (error) {
        dispatch({
          type: "parse_failed",
          requestId,
          message:
            error instanceof ExerciseParseRequestError
              ? error.message
              : "Analysis is temporarily unavailable. Retry when you are ready.",
        });
      } finally {
        latencyMonitor?.record("image", Math.max(0, now() - startedAt));
        if (pendingRequest.current?.requestId === requestId) {
          pendingRequest.current = undefined;
        }
      }
    },
    [cancelPendingRequest, latencyMonitor, now, parseExercise],
  );

  const handleSelectionChange = useCallback(
    (selection?: SelectedExerciseImage) => {
      cancelPendingRequest();
      onDraftChanged?.();
      confirmationLock.current = false;
      setClarification("");
      setClarificationError(undefined);
      dispatch(
        selection
          ? { type: "image_selected", file: selection.file }
          : { type: "image_cleared" },
      );
    },
    [cancelPendingRequest, onDraftChanged],
  );

  const handleAnalyze = useCallback(
    async (selection: SelectedExerciseImage) => {
      if (state.status !== "preview" || state.file !== selection.file) return;

      const requestId = createRequestId();
      dispatch({ type: "parse_started", requestId });
      await resolveParse(selection.file, null, requestId);
    },
    [createRequestId, resolveParse, state],
  );

  const handleClarification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.status !== "needs_clarification") return;

    const trimmed = clarification.trim();
    const characterCount = countClarificationCharacters(trimmed);
    if (characterCount === 0) {
      setClarificationError("Enter a short answer before continuing.");
      return;
    }
    if (characterCount > MAX_EXERCISE_CLARIFICATION_CHARACTERS) {
      setClarificationError("Keep the clarification to 500 characters or fewer.");
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
    if (state.status !== "awaiting_confirmation" || confirmationLock.current) {
      return;
    }

    const plan = validateExercisePlanV1(state.plan);
    if (!plan.success) {
      dispatch({
        type: "confirmation_rejected",
        message: "The exercise plan changed and must be analyzed again.",
      });
      return;
    }

    confirmationLock.current = true;
    const confirmation: ExerciseConfirmedV1 = {
      plan: plan.data,
      confirmationId: createConfirmationId(),
      confirmedAt: now(),
    };
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
      <ExerciseUploader
        onAnalyze={handleAnalyze}
        onSelectionChange={handleSelectionChange}
        cleanupToken={cleanupToken}
        analyzeEnabled={state.status === "preview"}
        locked={initializationState.status === "initializing"}
      />

      <section
        className="exercise-confirmation spike workspace-card workspace-card-check"
        aria-labelledby="exercise-confirmation-title"
        aria-busy={state.status === "parsing"}
        data-state={state.status}
      >
        <div className="spike-heading">
          <div>
            <p className="section-index">Step 1 · Quick check</p>
            <h2 id="exercise-confirmation-title">Did I understand it?</h2>
          </div>
          <p>
            Nothing changes in your workspace until you say the summary looks right.
          </p>
        </div>

        <p className="exercise-flow-status" role="status" aria-live="polite">
          {stateAnnouncement(state)}
        </p>

        {initializationState.status === "reset" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Ready for a new exercise
            </h3>
            <p>
              Your old construction has been cleared. Add another photo whenever
              you&apos;re ready.
            </p>
          </div>
        ) : null}

        {state.status === "needs_clarification" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Help me with one detail
            </h3>
            <p className="exercise-question">{state.question}</p>
            {canClarify ? (
              <form onSubmit={(event) => void handleClarification(event)}>
                <label htmlFor="exercise-clarification">Your answer</label>
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
                  {clarificationCharacterCount}/500 characters · clarification {state.clarificationCount + 1} of 2
                </p>
                {clarificationError ? <p role="alert">{clarificationError}</p> : null}
                <button type="submit">Send this detail</button>
              </form>
            ) : (
              <p>
                I still can&apos;t read this one confidently. Try a brighter, straighter
                photo so we can start cleanly.
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
              Here&apos;s what I found
            </h3>
            <dl>
              <div>
                <dt>The question</dt>
                <dd>{state.extraction.instruction}</dd>
              </div>
              <div>
                <dt>You already have</dt>
                <dd>Points A and B, and segment AB</dd>
              </div>
              <div>
                <dt>You&apos;ll build</dt>
                <dd>The perpendicular bisector of AB</dd>
              </div>
              <div>
                <dt>You&apos;ll discover</dt>
                <dd>Understand perpendicular bisectors and equidistance</dd>
              </div>
            </dl>
            <p className="exercise-initialization-note">
              I&apos;ll place A, B and segment AB. The important construction stays
              yours to make.
            </p>
            <button type="button" onClick={handleConfirm}>
              Looks right — start building
            </button>
          </div>
        ) : null}

        {state.status === "unsupported" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Let&apos;s try another exercise
            </h3>
            <p>{state.reason}</p>
            <p>For now, choose a perpendicular-bisector exercise using A and B.</p>
          </div>
        ) : null}

        {state.status === "refused" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              This photo needs another try
            </h3>
            <p>{state.message}</p>
            <p>Choose a clearer photo to continue. Nothing has changed yet.</p>
          </div>
        ) : null}

        {state.status === "failed" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              I couldn&apos;t read that
            </h3>
            <p role="alert">{state.message}</p>
            <button type="button" onClick={() => void handleRetry()}>
              Try reading it again
            </button>
          </div>
        ) : null}

        {state.status === "confirmed" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Your exercise is ready
            </h3>
            {initializationState.status === "idle" ? (
              <p>I understood the plan and I&apos;m preparing your canvas.</p>
            ) : null}
            {initializationState.status === "waiting_for_applet" ? (
              <p role="status">Opening your geometry workspace…</p>
            ) : null}
            {initializationState.status === "initializing" ? (
              <p role="status">Placing A, B and AB for you…</p>
            ) : null}
            {initializationState.status === "initialized" ? (
              <p role="status">
                Canvas initialized with A, B and AB only. Your turn: construct the
                perpendicular bisector.
              </p>
            ) : null}
            {initializationState.status === "failed" ? (
              <div>
                <p role="alert">
                  {initializationState.code === "recovery_required"
                    ? "The exact rollback could not be verified. Use Reset construction or reload before continuing."
                    : initializationState.rolledBack
                      ? "Initialization failed and the previous canvas was restored exactly."
                      : "Initialization was refused before the canvas changed."}
                </p>
                {initializationState.retryable && onRetryInitialization ? (
                  <button type="button" onClick={onRetryInitialization}>
                    {initializationState.code === "recovery_required"
                      ? "Restore canvas and retry"
                      : "Retry initialization"}
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

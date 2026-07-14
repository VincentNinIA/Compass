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
  validateExerciseExtractionWireV1,
  validateExercisePlanV1,
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

const CLARIFICATION_CODES = new Set([
  "missing_labels",
  "unreadable_text",
  "conflicting_instruction",
  "missing_segment",
]);

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
};

export type ExerciseInitializationViewState =
  | { status: "idle" }
  | { status: "waiting_for_applet" }
  | { status: "initializing" }
  | { status: "initialized"; snapshotHash: string }
  | { status: "reset" }
  | { status: "failed"; code: string; rolledBack: boolean };

function createId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `${prefix}-${Date.now()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResultPayload(value: unknown): ParseExerciseResultV1 {
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
    return { status: "ready", extraction: extraction.data, plan: plan.data };
  }

  if (
    value.status === "needs_clarification" &&
    typeof value.question === "string" &&
    value.question.trim().length > 0 &&
    typeof value.code === "string" &&
    CLARIFICATION_CODES.has(value.code)
  ) {
    return value as ParseExerciseResultV1;
  }

  if (
    value.status === "unsupported" &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0
  ) {
    return { status: "unsupported", reason: value.reason };
  }

  if (
    value.status === "refused" &&
    typeof value.message === "string" &&
    value.message.trim().length > 0
  ) {
    return { status: "refused", message: value.message };
  }

  throw new Error("invalid_parse_result");
}

const fetchExerciseParse: ExerciseParser = async ({
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
  if (!response.ok) throw new Error("parse_request_failed");
  return parseResultPayload(payload);
};

function stateAnnouncement(state: ExerciseConfirmationState): string {
  switch (state.status) {
    case "idle":
      return "Choose an exercise image to begin.";
    case "preview":
      return "Image ready. Choose Analyze when you want to continue.";
    case "parsing":
      return "Analyzing the selected exercise image.";
    case "needs_clarification":
      return state.clarificationCount >= MAX_EXERCISE_CLARIFICATIONS
        ? "Two clarifications were not enough. Replace the image to continue."
        : "One clarification is needed before confirmation.";
    case "awaiting_confirmation":
      return "Exercise understood. Review the summary before confirming.";
    case "confirmed":
      return "Exercise confirmed.";
    case "unsupported":
      return "This exercise is not supported by the current demo.";
    case "refused":
      return "The exercise could not be analyzed from this image.";
    case "failed":
      return "Exercise analysis failed. Retry or replace the image.";
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
      } catch {
        dispatch({
          type: "parse_failed",
          requestId,
          message: "Analysis is temporarily unavailable. Retry when you are ready.",
        });
      } finally {
        if (pendingRequest.current?.requestId === requestId) {
          pendingRequest.current = undefined;
        }
      }
    },
    [cancelPendingRequest, parseExercise],
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
        className="exercise-confirmation spike"
        aria-labelledby="exercise-confirmation-title"
        aria-busy={state.status === "parsing"}
        data-state={state.status}
      >
        <div className="spike-heading">
          <div>
            <p className="section-index">T3 / Human confirmation</p>
            <h2 id="exercise-confirmation-title">Review before the canvas changes</h2>
          </div>
          <p>
            GeoGebra changes only after an explicit confirmation and a transactional
            preflight.
          </p>
        </div>

        <p className="exercise-flow-status" role="status" aria-live="polite">
          {stateAnnouncement(state)}
        </p>

        {initializationState.status === "reset" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Construction reset
            </h3>
            <p>
              The construction and the local photo-analysis context were cleared.
              Choose a new image to start another exercise.
            </p>
          </div>
        ) : null}

        {state.status === "needs_clarification" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Clarify one detail
            </h3>
            <p className="exercise-question">{state.question}</p>
            {canClarify ? (
              <form onSubmit={(event) => void handleClarification(event)}>
                <label htmlFor="exercise-clarification">Your clarification</label>
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
                <button type="submit">Submit clarification</button>
              </form>
            ) : (
              <p>
                Two clarification attempts were not enough. Replace the image with a
                clearer photo; no plan was created.
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
              Exercise summary
            </h3>
            <dl>
              <div>
                <dt>Instruction</dt>
                <dd>{state.extraction.instruction}</dd>
              </div>
              <div>
                <dt>Given</dt>
                <dd>Points A and B, and segment AB</dd>
              </div>
              <div>
                <dt>Your construction</dt>
                <dd>The perpendicular bisector of AB</dd>
              </div>
              <div>
                <dt>Learning goal</dt>
                <dd>Understand perpendicular bisectors and equidistance</dd>
              </div>
            </dl>
            <p className="exercise-initialization-note">
              GeoGebra will create A, B and AB only. You will construct the
              perpendicular bisector.
            </p>
            <button type="button" onClick={handleConfirm}>
              Confirm exercise
            </button>
          </div>
        ) : null}

        {state.status === "unsupported" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Exercise not supported
            </h3>
            <p>{state.reason}</p>
            <p>Replace the image with a perpendicular-bisector exercise using A and B.</p>
          </div>
        ) : null}

        {state.status === "refused" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Analysis unavailable for this image
            </h3>
            <p>{state.message}</p>
            <p>Replace the image to continue. No plan was created.</p>
          </div>
        ) : null}

        {state.status === "failed" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Analysis failed
            </h3>
            <p role="alert">{state.message}</p>
            <button type="button" onClick={() => void handleRetry()}>
              Retry analysis
            </button>
          </div>
        ) : null}

        {state.status === "confirmed" ? (
          <div className="exercise-flow-panel">
            <h3 ref={workflowFocus} tabIndex={-1}>
              Exercise confirmed
            </h3>
            {initializationState.status === "idle" ? (
              <p>The validated plan is ready for transactional initialization.</p>
            ) : null}
            {initializationState.status === "waiting_for_applet" ? (
              <p role="status">Waiting for the GeoGebra applet before changing the canvas…</p>
            ) : null}
            {initializationState.status === "initializing" ? (
              <p role="status">Initializing A, B and AB transactionally…</p>
            ) : null}
            {initializationState.status === "initialized" ? (
              <p role="status">
                Canvas initialized with A, B and AB only. Construct the perpendicular
                bisector yourself.
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
                {onRetryInitialization ? (
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

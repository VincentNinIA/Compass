import type {
  ExerciseExtractionWireV1,
  ExercisePlanV1,
} from "./exercise-contracts";
import type { ParseExerciseResultV1 } from "./exercise-parse-route";

export const MAX_EXERCISE_CLARIFICATION_CHARACTERS = 500;
export const MAX_EXERCISE_CLARIFICATIONS = 2;

export type ExerciseConfirmedV1 = {
  plan: ExercisePlanV1;
  confirmationId: string;
  confirmedAt: number;
};

type ExerciseWithFile = {
  file: File;
  clarificationCount: number;
  lastClarification: string | null;
};

export type ExerciseConfirmationState =
  | { status: "idle" }
  | ({ status: "preview" } & ExerciseWithFile)
  | ({ status: "parsing"; requestId: string } & ExerciseWithFile)
  | ({
      status: "needs_clarification";
      question: string;
      code: Extract<
        ParseExerciseResultV1,
        { status: "needs_clarification" }
      >["code"];
    } & ExerciseWithFile)
  | ({
      status: "awaiting_confirmation";
      extraction: ExerciseExtractionWireV1;
      plan: ExercisePlanV1;
    } & ExerciseWithFile)
  | {
      status: "confirmed";
      confirmationId: string;
      confirmedAt: number;
    }
  | ({ status: "unsupported"; reason: string } & ExerciseWithFile)
  | ({ status: "refused"; message: string } & ExerciseWithFile)
  | ({ status: "failed"; message: string } & ExerciseWithFile);

export type ExerciseConfirmationAction =
  | { type: "image_selected"; file: File }
  | { type: "image_cleared" }
  | { type: "parse_started"; requestId: string }
  | { type: "clarification_submitted"; requestId: string; clarification: string }
  | { type: "retry_started"; requestId: string }
  | {
      type: "parse_resolved";
      requestId: string;
      result: ParseExerciseResultV1;
    }
  | { type: "parse_failed"; requestId: string; message: string }
  | { type: "confirmation_rejected"; message: string }
  | { type: "confirmed"; confirmation: ExerciseConfirmedV1 };

export const INITIAL_EXERCISE_CONFIRMATION_STATE: ExerciseConfirmationState = {
  status: "idle",
};

export function countClarificationCharacters(value: string): number {
  return Array.from(value).length;
}

function withResult(
  state: Extract<ExerciseConfirmationState, { status: "parsing" }>,
  result: ParseExerciseResultV1,
): ExerciseConfirmationState {
  const context: ExerciseWithFile = {
    file: state.file,
    clarificationCount: state.clarificationCount,
    lastClarification: state.lastClarification,
  };

  switch (result.status) {
    case "ready":
      return {
        status: "awaiting_confirmation",
        ...context,
        extraction: result.extraction,
        plan: result.plan,
      };
    case "needs_clarification":
      return {
        status: "needs_clarification",
        ...context,
        question: result.question,
        code: result.code,
      };
    case "unsupported":
      return { status: "unsupported", ...context, reason: result.reason };
    case "refused":
      return { status: "refused", ...context, message: result.message };
  }
}

export function exerciseConfirmationReducer(
  state: ExerciseConfirmationState,
  action: ExerciseConfirmationAction,
): ExerciseConfirmationState {
  switch (action.type) {
    case "image_selected":
      return {
        status: "preview",
        file: action.file,
        clarificationCount: 0,
        lastClarification: null,
      };
    case "image_cleared":
      return INITIAL_EXERCISE_CONFIRMATION_STATE;
    case "parse_started":
      if (state.status !== "preview") return state;
      return { ...state, status: "parsing", requestId: action.requestId };
    case "clarification_submitted": {
      if (
        state.status !== "needs_clarification" ||
        state.clarificationCount >= MAX_EXERCISE_CLARIFICATIONS
      ) {
        return state;
      }
      const clarification = action.clarification.trim();
      const characterCount = countClarificationCharacters(clarification);
      if (
        characterCount === 0 ||
        characterCount > MAX_EXERCISE_CLARIFICATION_CHARACTERS
      ) {
        return state;
      }
      return {
        status: "parsing",
        file: state.file,
        clarificationCount: state.clarificationCount + 1,
        lastClarification: clarification,
        requestId: action.requestId,
      };
    }
    case "retry_started":
      if (state.status !== "failed") return state;
      return { ...state, status: "parsing", requestId: action.requestId };
    case "parse_resolved":
      if (state.status !== "parsing" || state.requestId !== action.requestId) {
        return state;
      }
      return withResult(state, action.result);
    case "parse_failed":
      if (state.status !== "parsing" || state.requestId !== action.requestId) {
        return state;
      }
      return {
        status: "failed",
        file: state.file,
        clarificationCount: state.clarificationCount,
        lastClarification: state.lastClarification,
        message: action.message,
      };
    case "confirmation_rejected":
      if (state.status !== "awaiting_confirmation") return state;
      return {
        status: "failed",
        file: state.file,
        clarificationCount: state.clarificationCount,
        lastClarification: state.lastClarification,
        message: action.message,
      };
    case "confirmed":
      if (state.status !== "awaiting_confirmation") return state;
      return {
        status: "confirmed",
        confirmationId: action.confirmation.confirmationId,
        confirmedAt: action.confirmation.confirmedAt,
      };
  }
}

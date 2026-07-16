import { describe, expect, it } from "vitest";

import {
  EXERCISE_CLARIFICATION_MESSAGES_V1,
  EXERCISE_REFUSAL_MESSAGE_V1,
  EXERCISE_UNSUPPORTED_MESSAGE_V1,
  createExerciseReadyClientExtractionV1,
  deriveExercisePlanV1,
  type ExerciseExtractionWireV1,
} from "./exercise-contracts";
import {
  INITIAL_EXERCISE_CONFIRMATION_STATE,
  exerciseConfirmationReducer,
  type ExerciseConfirmedV1,
  type ExerciseConfirmationState,
} from "./exercise-confirmation";

const READY_EXTRACTION: ExerciseExtractionWireV1 = {
  schemaVersion: "exercise_extraction.v1",
  outcome: "ready",
  language: "en",
  instruction: "Construct the perpendicular bisector of segment AB.",
  pointLabels: ["A", "B"],
  segmentEndpoints: ["A", "B"],
  requestedConstruction: "perpendicular_bisector",
  learningObjective: "perpendicular_bisector_equidistance",
  ambiguityCode: null,
  clarificationQuestion: null,
  unsupportedReason: null,
};

const READY_RESULT = {
  status: "ready",
  extraction: createExerciseReadyClientExtractionV1(READY_EXTRACTION),
  plan: deriveExercisePlanV1(READY_EXTRACTION),
} as const;

const CLARIFICATION_RESULT = {
  status: "needs_clarification",
  question: EXERCISE_CLARIFICATION_MESSAGES_V1.missing_labels,
  code: "missing_labels",
} as const;

function file(name = "exercise.jpg") {
  return new File(["image"], name, { type: "image/jpeg" });
}

function previewState(selectedFile = file()): ExerciseConfirmationState {
  return exerciseConfirmationReducer(INITIAL_EXERCISE_CONFIRMATION_STATE, {
    type: "image_selected",
    file: selectedFile,
  });
}

function parsingState(requestId = "request-1"): ExerciseConfirmationState {
  return exerciseConfirmationReducer(previewState(), {
    type: "parse_started",
    requestId,
  });
}

describe("exerciseConfirmationReducer", () => {
  it("routes ready, unsupported, refused, failure, and cancel through closed states", () => {
    const ready = exerciseConfirmationReducer(parsingState(), {
      type: "parse_resolved",
      requestId: "request-1",
      result: READY_RESULT,
    });
    expect(ready.status).toBe("awaiting_confirmation");

    for (const result of [
      { status: "unsupported", reason: EXERCISE_UNSUPPORTED_MESSAGE_V1 },
      { status: "refused", message: EXERCISE_REFUSAL_MESSAGE_V1 },
    ] as const) {
      const state = exerciseConfirmationReducer(parsingState(), {
        type: "parse_resolved",
        requestId: "request-1",
        result,
      });
      expect(state.status).toBe(result.status);
      expect(exerciseConfirmationReducer(state, { type: "image_cleared" })).toEqual({
        status: "idle",
      });
    }

    const failed = exerciseConfirmationReducer(parsingState(), {
      type: "parse_failed",
      requestId: "request-1",
      message: "Try again.",
    });
    expect(failed).toMatchObject({ status: "failed", message: "Try again." });
    expect(
      exerciseConfirmationReducer(failed, {
        type: "retry_started",
        requestId: "request-2",
      }),
    ).toMatchObject({ status: "parsing", requestId: "request-2" });
  });

  it("submits at most two non-empty clarifications and preserves the same File", () => {
    const originalFile = file();
    const firstQuestion = exerciseConfirmationReducer(
      exerciseConfirmationReducer(previewState(originalFile), {
        type: "parse_started",
        requestId: "initial",
      }),
      {
        type: "parse_resolved",
        requestId: "initial",
        result: CLARIFICATION_RESULT,
      },
    );
    expect(firstQuestion.status).toBe("needs_clarification");

    const invalid = exerciseConfirmationReducer(firstQuestion, {
      type: "clarification_submitted",
      requestId: "blank",
      clarification: "   ",
    });
    expect(invalid).toBe(firstQuestion);

    const firstSubmission = exerciseConfirmationReducer(firstQuestion, {
      type: "clarification_submitted",
      requestId: "clarification-1",
      clarification: "  The left endpoint is A.  ",
    });
    expect(firstSubmission).toMatchObject({
      status: "parsing",
      file: originalFile,
      clarificationCount: 1,
      lastClarification: "The left endpoint is A.",
    });

    const secondQuestion = exerciseConfirmationReducer(firstSubmission, {
      type: "parse_resolved",
      requestId: "clarification-1",
      result: CLARIFICATION_RESULT,
    });
    const secondSubmission = exerciseConfirmationReducer(secondQuestion, {
      type: "clarification_submitted",
      requestId: "clarification-2",
      clarification: "The right endpoint is B.",
    });
    const finalQuestion = exerciseConfirmationReducer(secondSubmission, {
      type: "parse_resolved",
      requestId: "clarification-2",
      result: CLARIFICATION_RESULT,
    });
    expect(finalQuestion).toMatchObject({
      status: "needs_clarification",
      file: originalFile,
      clarificationCount: 2,
    });
    expect(
      exerciseConfirmationReducer(finalQuestion, {
        type: "clarification_submitted",
        requestId: "clarification-3",
        clarification: "A third answer",
      }),
    ).toBe(finalQuestion);
  });

  it("ignores stale results and failures after a new image selection", () => {
    const pending = parsingState("old-request");
    const replacement = exerciseConfirmationReducer(pending, {
      type: "image_selected",
      file: file("replacement.png"),
    });

    expect(
      exerciseConfirmationReducer(replacement, {
        type: "parse_resolved",
        requestId: "old-request",
        result: READY_RESULT,
      }),
    ).toBe(replacement);
    expect(
      exerciseConfirmationReducer(replacement, {
        type: "parse_failed",
        requestId: "old-request",
        message: "Late failure",
      }),
    ).toBe(replacement);
  });

  it("allows confirmation only from awaiting_confirmation and remains immutable", () => {
    const ready = exerciseConfirmationReducer(parsingState(), {
      type: "parse_resolved",
      requestId: "request-1",
      result: READY_RESULT,
    });
    const confirmation: ExerciseConfirmedV1 = {
      plan: READY_RESULT.plan,
      confirmationId: "confirmation-1",
      confirmedAt: 123,
    };

    expect(
      exerciseConfirmationReducer(previewState(), {
        type: "confirmed",
        confirmation,
      }).status,
    ).toBe("preview");
    const confirmed = exerciseConfirmationReducer(ready, {
      type: "confirmed",
      confirmation,
    });
    expect(confirmed).toEqual({
      status: "confirmed",
      kind: "legacy_mediator",
      confirmationId: "confirmation-1",
      confirmedAt: 123,
    });
    expect(confirmed).not.toHaveProperty("file");
    expect(confirmed).not.toHaveProperty("plan");
    expect(confirmed).not.toHaveProperty("confirmation");
    expect(ready.status).toBe("awaiting_confirmation");
  });
});

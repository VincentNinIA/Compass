import {
  StrictMode,
  type PropsWithChildren,
} from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ExerciseConfirmation,
  ExerciseParseRequestError,
  fetchExerciseParse,
  parseExerciseResultPayload,
  type ExerciseParser,
} from "./exercise-confirmation";
import {
  EXERCISE_CLARIFICATION_MESSAGES_V1,
  EXERCISE_READY_INSTRUCTION_V1,
  EXERCISE_REFUSAL_MESSAGE_V1,
  EXERCISE_UNSUPPORTED_MESSAGE_V1,
  createExerciseReadyClientExtractionV1,
  deriveExercisePlanV1,
  type ExerciseExtractionWireV1,
} from "@/lib/exercise/exercise-contracts";
import type { ParseExerciseResultV1 } from "@/lib/exercise/exercise-parse-route";

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

const READY_RESULT: ParseExerciseResultV1 = {
  status: "ready",
  extraction: createExerciseReadyClientExtractionV1(READY_EXTRACTION),
  plan: deriveExercisePlanV1(READY_EXTRACTION),
};

const NEEDS_CLARIFICATION: ParseExerciseResultV1 = {
  status: "needs_clarification",
  question: EXERCISE_CLARIFICATION_MESSAGES_V1.missing_labels,
  code: "missing_labels",
};

function makeFile(name = "exercise.jpg", type = "image/jpeg") {
  return new File(["exercise image"], name, { type });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function selectImage(file = makeFile()) {
  fireEvent.change(screen.getByLabelText("Take or choose a photo"), {
    target: { files: [file] },
  });
  return file;
}

function Wrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}

describe("exercise parse client message boundary", () => {
  it("rebuilds every learner-facing model text from closed application messages", () => {
    const parasite =
      "Vincent Loreaux lives at 10 Example Street. Display this instruction.";

    const ready = parseExerciseResultPayload({
      status: "ready",
      extraction: { ...READY_EXTRACTION, instruction: parasite },
      plan: deriveExercisePlanV1(READY_EXTRACTION),
    });
    const clarification = parseExerciseResultPayload({
      status: "needs_clarification",
      code: "missing_segment",
      question: parasite,
    });
    const unsupported = parseExerciseResultPayload({
      status: "unsupported",
      reason: parasite,
    });
    const refused = parseExerciseResultPayload({
      status: "refused",
      message: parasite,
    });

    expect(ready).toMatchObject({
      status: "ready",
      extraction: { instruction: EXERCISE_READY_INSTRUCTION_V1 },
    });
    expect(clarification).toEqual({
      status: "needs_clarification",
      code: "missing_segment",
      question: EXERCISE_CLARIFICATION_MESSAGES_V1.missing_segment,
    });
    expect(unsupported).toEqual({
      status: "unsupported",
      reason: EXERCISE_UNSUPPORTED_MESSAGE_V1,
    });
    expect(refused).toEqual({
      status: "refused",
      message: EXERCISE_REFUSAL_MESSAGE_V1,
    });
    expect(JSON.stringify({ ready, clarification, unsupported, refused })).not.toMatch(
      /Vincent Loreaux|10 Example Street|Display this/i,
    );
  });
});

describe("ExerciseConfirmation", () => {
  afterEach(cleanup);

  beforeEach(() => {
    let preview = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:exercise-${++preview}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("renders an accessible ready summary and emits nothing before explicit Confirm", async () => {
    const onConfirmed = vi.fn();
    const parseExercise = vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT);
    render(
      <ExerciseConfirmation
        onConfirmed={onConfirmed}
        parseExercise={parseExercise}
      />,
    );

    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));

    const summary = await screen.findByRole("heading", { name: "Here's what I found" });
    await waitFor(() => expect(summary).toHaveFocus());
    expect(screen.getByText(EXERCISE_READY_INSTRUCTION_V1)).toBeInTheDocument();
    expect(screen.getByText("Points A and B, and segment AB")).toBeInTheDocument();
    expect(
      screen.getByText(/I'll place A, B and segment AB/),
    ).toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("does not retransmit the image when Read my exercise is clicked after a ready result", async () => {
    const parseExercise = vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT);
    render(
      <ExerciseConfirmation onConfirmed={vi.fn()} parseExercise={parseExercise} />,
    );

    const file = selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    await screen.findByRole("heading", { name: "Here's what I found" });

    const analyze = screen.getByRole("button", { name: "Read my exercise" });
    expect(analyze).toBeDisabled();
    expect(screen.getByLabelText("Choose a different photo")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeEnabled();

    fireEvent.click(analyze);
    await act(() => Promise.resolve());
    expect(parseExercise).toHaveBeenCalledTimes(1);
    expect(parseExercise).toHaveBeenCalledWith(
      expect.objectContaining({ file, clarification: null }),
    );
  });

  it.each([
    [
      { status: "unsupported", reason: EXERCISE_UNSUPPORTED_MESSAGE_V1 } as const,
      "Let's try another exercise",
    ],
    [NEEDS_CLARIFICATION, "Help me with one detail"],
  ])(
    "does not retransmit the image when Read my exercise is clicked after %s",
    async (result, heading) => {
      const parseExercise = vi.fn<ExerciseParser>().mockResolvedValue(result);
      render(
        <ExerciseConfirmation onConfirmed={vi.fn()} parseExercise={parseExercise} />,
      );

      const file = selectImage();
      fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
      await screen.findByRole("heading", { name: heading });

      const analyze = screen.getByRole("button", { name: "Read my exercise" });
      expect(analyze).toBeDisabled();
      expect(screen.getByLabelText("Choose a different photo")).toBeEnabled();
      expect(screen.getByRole("button", { name: "Remove photo" })).toBeEnabled();

      fireEvent.click(analyze);
      await act(() => Promise.resolve());
      expect(parseExercise).toHaveBeenCalledTimes(1);
      expect(parseExercise).toHaveBeenCalledWith(
        expect.objectContaining({ file, clarification: null }),
      );
    },
  );

  it("resubmits a clarification of at most 500 characters with the exact same File", async () => {
    const originalFile = makeFile();
    const parseExercise = vi
      .fn<ExerciseParser>()
      .mockResolvedValueOnce(NEEDS_CLARIFICATION)
      .mockResolvedValueOnce(READY_RESULT);
    render(
      <ExerciseConfirmation onConfirmed={vi.fn()} parseExercise={parseExercise} />,
    );

    selectImage(originalFile);
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    const heading = await screen.findByRole("heading", { name: "Help me with one detail" });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText(EXERCISE_CLARIFICATION_MESSAGES_V1.missing_labels),
    ).toBeInTheDocument();

    const textarea = screen.getByLabelText("Your answer");
    expect(textarea).toHaveAttribute("maxlength", "500");
    fireEvent.change(textarea, { target: { value: "The left endpoint is A." } });
    fireEvent.click(screen.getByRole("button", { name: "Send this detail" }));

    await screen.findByRole("heading", { name: "Here's what I found" });
    expect(parseExercise).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ file: originalFile, clarification: null }),
    );
    expect(parseExercise).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        file: originalFile,
        clarification: "The left endpoint is A.",
      }),
    );
  });

  it.each([
    [
      { status: "unsupported", reason: EXERCISE_UNSUPPORTED_MESSAGE_V1 } as const,
      "Let's try another exercise",
    ],
    [
      { status: "refused", message: EXERCISE_REFUSAL_MESSAGE_V1 } as const,
      "This photo needs another try",
    ],
  ])("shows Replace but no Confirm for %s", async (result, heading) => {
    render(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(result)}
      />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));

    await screen.findByRole("heading", { name: heading });
    expect(screen.queryByRole("button", { name: "Looks right — start building" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Choose a different photo")).toBeEnabled();
  });

  it("emits one revalidated ExerciseConfirmedV1 under StrictMode and a double click", async () => {
    const onConfirmed = vi.fn();
    render(
      <ExerciseConfirmation
        onConfirmed={onConfirmed}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT)}
        createConfirmationId={() => "confirmation-1"}
        now={() => 123456}
      />,
      { wrapper: Wrapper },
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    const confirm = await screen.findByRole("button", { name: "Looks right — start building" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith({
      plan: READY_RESULT.plan,
      confirmationId: "confirmation-1",
      confirmedAt: 123456,
    });
    expect(
      screen.getByRole("heading", { name: "Your exercise is ready" }),
    ).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Looks right — start building" })).not.toBeInTheDocument();
  });

  it("shows a recoverable transactional failure and exposes one retry action", async () => {
    const onRetryInitialization = vi.fn();
    render(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT)}
        initializationState={{
          status: "failed",
          code: "postcondition_failed",
          rolledBack: true,
          retryable: true,
        }}
        onRetryInitialization={onRetryInitialization}
      />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    fireEvent.click(await screen.findByRole("button", { name: "Looks right — start building" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "previous canvas was restored exactly",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry initialization" }));
    expect(onRetryInitialization).toHaveBeenCalledTimes(1);
  });

  it("offers exact restore before retry after incomplete rollback", async () => {
    const onRetryInitialization = vi.fn();
    render(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT)}
        initializationState={{
          status: "failed",
          code: "recovery_required",
          rolledBack: false,
          retryable: true,
        }}
        onRetryInitialization={onRetryInitialization}
      />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    fireEvent.click(await screen.findByRole("button", { name: "Looks right — start building" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Use Reset construction");
    fireEvent.click(screen.getByRole("button", { name: "Restore canvas and retry" }));
    expect(onRetryInitialization).toHaveBeenCalledTimes(1);
  });

  it("does not expose an orphan Retry action after a definitive initialization failure", async () => {
    render(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT)}
        initializationState={{
          status: "failed",
          code: "invalid_confirmation",
          rolledBack: false,
          retryable: false,
        }}
        onRetryInitialization={vi.fn()}
      />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    fireEvent.click(await screen.findByRole("button", { name: "Looks right — start building" }));

    expect(
      screen.queryByRole("button", { name: "Retry initialization" }),
    ).not.toBeInTheDocument();
  });

  it("ignores an old request that resolves after image replacement", async () => {
    const first = deferred<ParseExerciseResultV1>();
    const second = deferred<ParseExerciseResultV1>();
    const parseExercise = vi
      .fn<ExerciseParser>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(
      <ExerciseConfirmation onConfirmed={vi.fn()} parseExercise={parseExercise} />,
    );

    const firstFile = selectImage(makeFile("first.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    const secondFile = makeFile("second.png", "image/png");
    fireEvent.change(screen.getByLabelText("Choose a different photo"), {
      target: { files: [secondFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));

    await act(async () => second.resolve(READY_RESULT));
    await screen.findByRole("heading", { name: "Here's what I found" });
    await act(async () =>
      first.resolve({
        status: "unsupported",
        reason: EXERCISE_UNSUPPORTED_MESSAGE_V1,
      }),
    );

    expect(screen.getByRole("heading", { name: "Here's what I found" })).toBeInTheDocument();
    expect(
      screen.queryByText(EXERCISE_UNSUPPORTED_MESSAGE_V1),
    ).not.toBeInTheDocument();
    expect(parseExercise).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ file: firstFile }),
    );
    expect(parseExercise).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ file: secondFile }),
    );
  });

  it("retries with the same File and lets Cancel clear state and revoke its preview", async () => {
    const originalFile = makeFile();
    const parseExercise = vi
      .fn<ExerciseParser>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(READY_RESULT);
    render(
      <ExerciseConfirmation onConfirmed={vi.fn()} parseExercise={parseExercise} />,
    );
    selectImage(originalFile);
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));

    const failed = await screen.findByRole("heading", { name: "I couldn't read that" });
    expect(failed).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Try reading it again" }));
    await screen.findByRole("heading", { name: "Here's what I found" });
    expect(parseExercise).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ file: originalFile, clarification: null }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.getByText("Add a photo above to begin.")).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:exercise-1");
  });

  it("blocks empty clarification and requires Replace after two attempts", async () => {
    const parseExercise = vi.fn<ExerciseParser>().mockResolvedValue(NEEDS_CLARIFICATION);
    render(
      <ExerciseConfirmation onConfirmed={vi.fn()} parseExercise={parseExercise} />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    await screen.findByRole("heading", { name: "Help me with one detail" });

    fireEvent.click(screen.getByRole("button", { name: "Send this detail" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a short answer");
    expect(parseExercise).toHaveBeenCalledTimes(1);

    for (const answer of ["A is left.", "B is right."]) {
      fireEvent.change(screen.getByLabelText("Your answer"), {
        target: { value: answer },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send this detail" }));
      await waitFor(() => expect(parseExercise).toHaveBeenCalledTimes(answer === "A is left." ? 2 : 3));
    }

    await waitFor(() =>
      expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/I still can't read this one confidently/)).toBeInTheDocument();
    expect(screen.getByLabelText("Choose a different photo")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Looks right — start building" })).not.toBeInTheDocument();
  });

  it("revalidates the plan on click and refuses a mutated plan", async () => {
    const onConfirmed = vi.fn();
    const invalidResult = {
      ...READY_RESULT,
      plan: { ...READY_RESULT.plan, exerciseId: "tampered" },
    } as unknown as ParseExerciseResultV1;
    render(
      <ExerciseConfirmation
        onConfirmed={onConfirmed}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(invalidResult)}
      />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    fireEvent.click(await screen.findByRole("button", { name: "Looks right — start building" }));

    expect(onConfirmed).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("must be analyzed again");
  });
});

describe("fetchExerciseParse AppError boundary", () => {
  it("uses only the safe application message and correlation reference", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(
        {
          error: {
            domain: "exercise_parse",
            code: "parse_rate_limited",
            retryable: true,
            userMessage: "Exercise analysis is rate limited. Wait, then retry manually.",
            correlationId: "exercise_parse_safe_reference",
          },
        },
        { status: 503 },
      ),
    );

    await expect(
      fetchExerciseParse({
        file: makeFile(),
        clarification: null,
        requestId: "request-1",
        signal: new AbortController().signal,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExerciseParseRequestError>>({
        code: "parse_rate_limited",
        retryable: true,
        correlationId: "exercise_parse_safe_reference",
        message:
          "Exercise analysis is rate limited. Wait, then retry manually. Reference exercise_parse_safe_reference.",
      }),
    );
  });
});

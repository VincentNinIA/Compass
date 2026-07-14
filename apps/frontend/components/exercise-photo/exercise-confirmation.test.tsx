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

import { ExerciseConfirmation, type ExerciseParser } from "./exercise-confirmation";
import {
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
  extraction: READY_EXTRACTION,
  plan: deriveExercisePlanV1(READY_EXTRACTION),
};

const NEEDS_CLARIFICATION: ParseExerciseResultV1 = {
  status: "needs_clarification",
  question: "Which endpoint is labelled A?",
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
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    const summary = await screen.findByRole("heading", { name: "Exercise summary" });
    expect(summary).toHaveFocus();
    expect(screen.getByText(READY_EXTRACTION.instruction!)).toBeInTheDocument();
    expect(screen.getByText("Points A and B, and segment AB")).toBeInTheDocument();
    expect(
      screen.getByText(/GeoGebra will create A, B and AB only/),
    ).toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("does not retransmit the image when Analyze is clicked after a ready result", async () => {
    const parseExercise = vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT);
    render(
      <ExerciseConfirmation onConfirmed={vi.fn()} parseExercise={parseExercise} />,
    );

    const file = selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByRole("heading", { name: "Exercise summary" });

    const analyze = screen.getByRole("button", { name: "Analyze" });
    expect(analyze).toBeDisabled();
    expect(screen.getByLabelText("Replace image")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel selection" })).toBeEnabled();

    fireEvent.click(analyze);
    await act(() => Promise.resolve());
    expect(parseExercise).toHaveBeenCalledTimes(1);
    expect(parseExercise).toHaveBeenCalledWith(
      expect.objectContaining({ file, clarification: null }),
    );
  });

  it.each([
    [
      { status: "unsupported", reason: "Only the perpendicular bisector is supported." } as const,
      "Exercise not supported",
    ],
    [NEEDS_CLARIFICATION, "Clarify one detail"],
  ])(
    "does not retransmit the image when Analyze is clicked after %s",
    async (result, heading) => {
      const parseExercise = vi.fn<ExerciseParser>().mockResolvedValue(result);
      render(
        <ExerciseConfirmation onConfirmed={vi.fn()} parseExercise={parseExercise} />,
      );

      const file = selectImage();
      fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
      await screen.findByRole("heading", { name: heading });

      const analyze = screen.getByRole("button", { name: "Analyze" });
      expect(analyze).toBeDisabled();
      expect(screen.getByLabelText("Replace image")).toBeEnabled();
      expect(screen.getByRole("button", { name: "Cancel selection" })).toBeEnabled();

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
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    const heading = await screen.findByRole("heading", { name: "Clarify one detail" });
    expect(heading).toHaveFocus();
    expect(screen.getByText("Which endpoint is labelled A?")).toBeInTheDocument();

    const textarea = screen.getByLabelText("Your clarification");
    expect(textarea).toHaveAttribute("maxlength", "500");
    fireEvent.change(textarea, { target: { value: "The left endpoint is A." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit clarification" }));

    await screen.findByRole("heading", { name: "Exercise summary" });
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
      { status: "unsupported", reason: "Only the perpendicular bisector is supported." } as const,
      "Exercise not supported",
    ],
    [
      { status: "refused", message: "The image could not be analyzed." } as const,
      "Analysis unavailable for this image",
    ],
  ])("shows Replace but no Confirm for %s", async (result, heading) => {
    render(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(result)}
      />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await screen.findByRole("heading", { name: heading });
    expect(screen.queryByRole("button", { name: "Confirm exercise" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Replace image")).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    const confirm = await screen.findByRole("button", { name: "Confirm exercise" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith({
      plan: READY_RESULT.plan,
      confirmationId: "confirmation-1",
      confirmedAt: 123456,
    });
    expect(
      screen.getByRole("heading", { name: "Exercise confirmed" }),
    ).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Confirm exercise" })).not.toBeInTheDocument();
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
        }}
        onRetryInitialization={onRetryInitialization}
      />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm exercise" }));

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
        }}
        onRetryInitialization={onRetryInitialization}
      />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm exercise" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Use Reset construction");
    fireEvent.click(screen.getByRole("button", { name: "Restore canvas and retry" }));
    expect(onRetryInitialization).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    const secondFile = makeFile("second.png", "image/png");
    fireEvent.change(screen.getByLabelText("Replace image"), {
      target: { files: [secondFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await act(async () => second.resolve(READY_RESULT));
    await screen.findByRole("heading", { name: "Exercise summary" });
    await act(async () =>
      first.resolve({ status: "unsupported", reason: "Late old result" }),
    );

    expect(screen.getByRole("heading", { name: "Exercise summary" })).toBeInTheDocument();
    expect(screen.queryByText("Late old result")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    const failed = await screen.findByRole("heading", { name: "Analysis failed" });
    expect(failed).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Retry analysis" }));
    await screen.findByRole("heading", { name: "Exercise summary" });
    expect(parseExercise).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ file: originalFile, clarification: null }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel selection" }));
    expect(screen.getByText("Choose an exercise image to begin.")).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:exercise-1");
  });

  it("blocks empty clarification and requires Replace after two attempts", async () => {
    const parseExercise = vi.fn<ExerciseParser>().mockResolvedValue(NEEDS_CLARIFICATION);
    render(
      <ExerciseConfirmation onConfirmed={vi.fn()} parseExercise={parseExercise} />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByRole("heading", { name: "Clarify one detail" });

    fireEvent.click(screen.getByRole("button", { name: "Submit clarification" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a short answer");
    expect(parseExercise).toHaveBeenCalledTimes(1);

    for (const answer of ["A is left.", "B is right."]) {
      fireEvent.change(screen.getByLabelText("Your clarification"), {
        target: { value: answer },
      });
      fireEvent.click(screen.getByRole("button", { name: "Submit clarification" }));
      await waitFor(() => expect(parseExercise).toHaveBeenCalledTimes(answer === "A is left." ? 2 : 3));
    }

    await waitFor(() =>
      expect(screen.queryByLabelText("Your clarification")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Two clarification attempts were not enough/)).toBeInTheDocument();
    expect(screen.getByLabelText("Replace image")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Confirm exercise" })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm exercise" }));

    expect(onConfirmed).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("must be analyzed again");
  });
});

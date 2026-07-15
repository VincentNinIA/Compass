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
  EXERCISE_IMAGE_ACCEPT,
  ExerciseUploader,
  MAX_EXERCISE_IMAGE_BYTES,
  type SelectedExerciseImage,
} from "./exercise-uploader";

const createObjectURL = vi.fn<(file: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

function makeFile(
  name: string,
  type: string,
  content: BlobPart = "exercise image",
) {
  return new File([content], name, { type });
}

function makeFileWithSize(name: string, type: string, size: number) {
  const file = makeFile(name, type);
  Object.defineProperty(file, "size", { configurable: true, value: size });
  return file;
}

describe("ExerciseUploader", () => {
  afterEach(cleanup);

  beforeEach(() => {
    createObjectURL.mockReset();
    revokeObjectURL.mockReset();
    createObjectURL
      .mockReturnValueOnce("blob:exercise-1")
      .mockReturnValueOnce("blob:exercise-2")
      .mockReturnValueOnce("blob:exercise-3");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  it.each([
    ["exercise.jpg", "image/jpeg"],
    ["exercise.png", "image/png"],
    ["exercise.webp", "image/webp"],
  ])("accepts one locally valid %s and emits it only on Read my exercise", async (name, type) => {
    const onAnalyze = vi.fn<(selection: SelectedExerciseImage) => void>();
    render(<ExerciseUploader onAnalyze={onAnalyze} />);

    const input = screen.getByLabelText("Take or choose a photo");
    const file = makeFile(name, type);
    expect(input).toHaveAttribute("accept", EXERCISE_IMAGE_ACCEPT);
    expect(input).toHaveAttribute("capture", "environment");

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByRole("status")).toHaveAttribute("data-state", "selected");
    expect(screen.getByRole("img", { name: `Preview of ${name}` })).toHaveAttribute(
      "src",
      "blob:exercise-1",
    );
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(onAnalyze).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(1));
    expect(onAnalyze).toHaveBeenCalledWith({
      file,
      previewUrl: "blob:exercise-1",
      declaredMime: type,
      byteLength: file.size,
    });
  });

  it.each([
    ["exercise.heic", "image/heic", 12, "format is not supported"],
    ["empty.png", "image/png", 0, "image is empty"],
    [
      "large.webp",
      "image/webp",
      MAX_EXERCISE_IMAGE_BYTES + 1,
      "larger than 10 MiB",
    ],
  ])(
    "rejects %s locally and never emits it",
    async (name, type, size, expectedMessage) => {
      const onAnalyze = vi.fn();
      render(<ExerciseUploader onAnalyze={onAnalyze} />);
      const input = screen.getByLabelText("Take or choose a photo");
      const file = makeFileWithSize(name, type, size);

      fireEvent.change(input, { target: { files: [file] } });

      expect(screen.getByRole("status")).toHaveAttribute(
        "data-state",
        "client_rejected",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(expectedMessage);
      expect(screen.getByRole("button", { name: "Read my exercise" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
      await act(() => Promise.resolve());
      expect(onAnalyze).not.toHaveBeenCalled();
      expect(createObjectURL).not.toHaveBeenCalled();
    },
  );

  it("rejects multiple files and submits none", () => {
    const onAnalyze = vi.fn();
    render(<ExerciseUploader onAnalyze={onAnalyze} />);
    const input = screen.getByLabelText("Take or choose a photo");

    fireEvent.change(input, {
      target: {
        files: [
          makeFile("first.jpg", "image/jpeg"),
          makeFile("second.png", "image/png"),
        ],
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("exactly one");
    expect(screen.getByRole("button", { name: "Read my exercise" })).toBeDisabled();
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it("revokes every Object URL on replacement, rejection, cancellation, and unmount", () => {
    const { unmount } = render(<ExerciseUploader onAnalyze={vi.fn()} />);
    const input = screen.getByLabelText("Take or choose a photo");

    fireEvent.change(input, {
      target: { files: [makeFile("first.jpg", "image/jpeg")] },
    });
    fireEvent.change(input, {
      target: { files: [makeFile("second.png", "image/png")] },
    });
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:exercise-1");

    fireEvent.change(input, {
      target: { files: [makeFile("replacement.heic", "image/heic")] },
    });
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:exercise-2");

    fireEvent.change(input, {
      target: { files: [makeFile("third.webp", "image/webp")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(revokeObjectURL).toHaveBeenNthCalledWith(3, "blob:exercise-3");

    createObjectURL.mockReturnValueOnce("blob:exercise-4");
    fireEvent.change(input, {
      target: { files: [makeFile("fourth.jpg", "image/jpeg")] },
    });
    unmount();
    expect(revokeObjectURL).toHaveBeenNthCalledWith(4, "blob:exercise-4");
    expect(revokeObjectURL).toHaveBeenCalledTimes(4);
  });

  it("exposes submitting while replacement remains available and ignores the old completion", async () => {
    let finishAnalysis: (() => void) | undefined;
    const onAnalyze = vi.fn(
      () => new Promise<void>((resolve) => {
        finishAnalysis = resolve;
      }),
    );
    render(<ExerciseUploader onAnalyze={onAnalyze} />);
    const input = screen.getByLabelText("Take or choose a photo");
    fireEvent.change(input, {
      target: { files: [makeFile("exercise.jpg", "image/jpeg")] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));

    expect(screen.getByRole("status")).toHaveAttribute("data-state", "submitting");
    expect(input).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeEnabled();

    fireEvent.change(input, {
      target: { files: [makeFile("replacement.png", "image/png")] },
    });
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "selected");
    expect(screen.getByText("replacement.png")).toBeInTheDocument();

    await act(async () => finishAnalysis?.());
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "selected");
    expect(input).toBeEnabled();
  });

  it("signals selection, replacement, rejection, and cancellation to its owner", () => {
    const onSelectionChange = vi.fn();
    render(
      <ExerciseUploader
        onAnalyze={vi.fn()}
        onSelectionChange={onSelectionChange}
      />,
    );
    const input = screen.getByLabelText("Take or choose a photo");
    const first = makeFile("first.jpg", "image/jpeg");
    const second = makeFile("second.png", "image/png");

    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.change(input, { target: { files: [second] } });
    fireEvent.change(input, {
      target: { files: [makeFile("bad.heic", "image/heic")] },
    });
    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(onSelectionChange.mock.calls.map(([selection]) => selection?.file)).toEqual([
      first,
      second,
      undefined,
      first,
      undefined,
    ]);
  });

  it("blocks Read my exercise independently while keeping replacement and cancellation available", async () => {
    const onAnalyze = vi.fn();
    render(<ExerciseUploader onAnalyze={onAnalyze} analyzeEnabled={false} />);
    const input = screen.getByLabelText("Take or choose a photo");

    fireEvent.change(input, {
      target: { files: [makeFile("exercise.jpg", "image/jpeg")] },
    });

    const analyze = screen.getByRole("button", { name: "Read my exercise" });
    expect(analyze).toBeDisabled();
    expect(input).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeEnabled();

    fireEvent.click(analyze);
    await act(() => Promise.resolve());
    expect(onAnalyze).not.toHaveBeenCalled();
  });
});

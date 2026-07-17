import type OpenAI from "openai";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ExerciseConfirmation,
  type ExerciseParser,
} from "@/components/exercise-photo/exercise-confirmation";
import {
  createExerciseReadyClientExtractionV1,
  deriveExercisePlanV1,
  type ExerciseExtractionWireV1,
} from "./exercise-contracts";
import {
  emitExerciseParseLog,
  type ExerciseParseLogEntry,
} from "./exercise-parse-logger";
import { createExerciseParseHandler } from "./exercise-parse-route";

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
  status: "ready" as const,
  extraction: createExerciseReadyClientExtractionV1(READY_EXTRACTION),
  plan: deriveExercisePlanV1(READY_EXTRACTION),
};

function multipartRequest() {
  const body = new FormData();
  body.append(
    "image",
    new File(["private image bytes"], "private-filename.jpg", {
      type: "image/jpeg",
    }),
  );
  body.append("clarification", "private clarification");
  return new Request("http://localhost/api/exercise/parse", {
    method: "POST",
    body,
  });
}

function makeFile(name = "private-filename.jpg") {
  return new File(["private image bytes"], name, { type: "image/jpeg" });
}

function selectImage(file = makeFile()) {
  fireEvent.change(screen.getByLabelText("Choose a photo"), {
    target: { files: [file] },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("exercise data minimization", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "caches");
    Reflect.deleteProperty(window, "indexedDB");
  });

  beforeEach(() => {
    let preview = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:private-${++preview}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("accepts only the closed logger allowlist and rejects payload fields", () => {
    const logger = vi.fn<(entry: ExerciseParseLogEntry) => void>();
    const allowed = {
      requestId: "exercise_request-1",
      status: "completed",
      code: "ready",
      durationMs: 25,
      normalizedByteLength: 4,
      normalizedWidth: 20,
      normalizedHeight: 10,
      model: "gpt-5.6-terra",
    } as const;

    expect(emitExerciseParseLog(logger, allowed)).toBe(true);
    expect(logger).toHaveBeenCalledWith(allowed);
    expect(Object.keys(logger.mock.calls[0]![0])).toMatchInlineSnapshot(`
      [
        "requestId",
        "status",
        "code",
        "durationMs",
        "normalizedByteLength",
        "normalizedWidth",
        "normalizedHeight",
        "model",
      ]
    `);
    expect(Object.isFrozen(logger.mock.calls[0]![0])).toBe(true);

    for (const forbidden of [
      { clarification: "private clarification" },
      { filename: "private-filename.jpg" },
      { image: "private image bytes" },
      { dataUrl: "data:image/jpeg;base64,cHJpdmF0ZQ==" },
      { extraction: READY_EXTRACTION },
      { plan: READY_RESULT.plan },
      { apiKey: "server-secret" },
    ]) {
      expect(emitExerciseParseLog(logger, { ...allowed, ...forbidden })).toBe(false);
    }
    expect(logger).toHaveBeenCalledTimes(1);
  });

  it("keeps Responses stateless, calls no Files API, wipes buffers, and logs metadata only", async () => {
    const normalizedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    let inputBytes: Buffer | undefined;
    const parse = vi.fn(async (body: unknown) => {
      expect(body).toMatchObject({
        model: "gpt-5.6-terra",
        store: false,
        tools: [],
      });
      return {
        status: "completed",
        output: [],
        output_parsed: READY_EXTRACTION,
      };
    });
    const filesCreate = vi.fn();
    const logger = vi.fn<(entry: ExerciseParseLogEntry) => void>();
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125);
    const response = await createExerciseParseHandler({
      apiKey: "server-secret",
      requestIdFactory: () => "exercise_request-1",
      now,
      logger,
      normalizeImage: vi.fn(async (bytes) => {
        inputBytes = bytes;
        return {
          bytes: normalizedBytes,
          mime: "image/jpeg" as const,
          width: 20,
          height: 10,
          byteLength: normalizedBytes.byteLength,
        };
      }),
      openAIClientFactory: () =>
        ({ responses: { parse }, files: { create: filesCreate } }) as unknown as OpenAI,
    })(multipartRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(filesCreate).not.toHaveBeenCalled();
    expect(inputBytes).toBeDefined();
    expect([...inputBytes!]).toEqual(new Array(inputBytes!.byteLength).fill(0));
    expect([...normalizedBytes]).toEqual([0, 0, 0, 0]);
    expect(logger).toHaveBeenCalledWith({
      requestId: "exercise_request-1",
      status: "completed",
      code: "ready",
      durationMs: 25,
      normalizedByteLength: 4,
      normalizedWidth: 20,
      normalizedHeight: 10,
      model: "gpt-5.6-terra",
    });
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(
      /private|data:image|server-secret|perpendicular bisector/i,
    );
  });

  it("performs the same server cleanup and no-store response on an OpenAI error", async () => {
    const normalizedBytes = Buffer.from([1, 2, 3]);
    const logger = vi.fn<(entry: ExerciseParseLogEntry) => void>();
    const response = await createExerciseParseHandler({
      apiKey: "server-secret",
      requestIdFactory: () => "exercise_request-2",
      now: () => 10,
      logger,
      normalizeImage: vi.fn(async () => ({
        bytes: normalizedBytes,
        mime: "image/jpeg" as const,
        width: 3,
        height: 1,
        byteLength: 3,
      })),
      openAIClientFactory: () =>
        ({
          responses: { parse: vi.fn().mockRejectedValue(new Error("upstream")) },
        }) as unknown as OpenAI,
    })(multipartRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect([...normalizedBytes]).toEqual([0, 0, 0]);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        code: "parse_unavailable",
      }),
    );
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(
      /private|data:image|server-secret|upstream/i,
    );
  });

  it("never retransmits a terminal ready File while Replace and Cancel remain available", async () => {
    const parseExercise = vi
      .fn<ExerciseParser>()
      .mockResolvedValue(READY_RESULT);
    render(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={parseExercise}
      />,
    );

    const originalFile = makeFile("original-private.jpg");
    selectImage(originalFile);
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    await screen.findByRole("heading", { name: "Here's what I found" });

    const analyze = screen.getByRole("button", { name: "Read my exercise" });
    expect(analyze).toBeDisabled();
    fireEvent.click(analyze);
    await act(() => Promise.resolve());

    expect(parseExercise).toHaveBeenCalledTimes(1);
    expect(parseExercise).toHaveBeenCalledWith(
      expect.objectContaining({ file: originalFile, clarification: null }),
    );

    const replaceInput = screen.getByLabelText("Choose a different photo");
    const replacementFile = makeFile("replacement-private.jpg");
    expect(replaceInput).toBeEnabled();
    fireEvent.change(replaceInput, { target: { files: [replacementFile] } });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-1");
    expect(screen.getByText("replacement-private.jpg")).toBeInTheDocument();

    const cancel = screen.getByRole("button", { name: "Remove photo" });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(screen.getByText("Waiting for your photo")).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-2");
    expect(parseExercise).toHaveBeenCalledTimes(1);
  });

  it("revokes the preview and drops File, extraction, and plan state after Confirm", async () => {
    const onConfirmed = vi.fn();
    render(
      <ExerciseConfirmation
        onConfirmed={onConfirmed}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT)}
        createConfirmationId={() => "confirmation-1"}
        now={() => 123}
      />,
    );

    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    fireEvent.click(await screen.findByRole("button", { name: "Looks right — start building" }));

    await waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-1"),
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(READY_EXTRACTION.instruction!)).not.toBeInTheDocument();
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Your exercise is ready" })).toBeInTheDocument();
  });

  it("aborts and clears pending client work on reset and unmount", async () => {
    const pending = deferred<typeof READY_RESULT>();
    let signal: AbortSignal | undefined;
    const parseExercise = vi.fn<ExerciseParser>((input) => {
      signal = input.signal;
      return pending.promise;
    });
    const { rerender, unmount } = render(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={parseExercise}
        resetToken={0}
      />,
    );
    selectImage();
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    expect(signal?.aborted).toBe(false);

    rerender(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={parseExercise}
        resetToken={1}
        initializationState={{ status: "reset" }}
      />,
    );
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-1");
    expect(screen.getByText(/old construction has been cleared/i)).toBeInTheDocument();
    expect(screen.getByText("Waiting for your photo")).toBeInTheDocument();

    const second = deferred<typeof READY_RESULT>();
    parseExercise.mockImplementationOnce((input) => {
      signal = input.signal;
      return second.promise;
    });
    selectImage(makeFile("second.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-2");

    await act(async () => {
      pending.resolve(READY_RESULT);
      second.resolve(READY_RESULT);
    });
  });

  it("revokes on replacement and does not use browser persistent storage", async () => {
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    const localRemove = vi.spyOn(Storage.prototype, "removeItem");
    const indexedOpen = vi.fn();
    const cacheOpen = vi.fn();
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: { open: indexedOpen },
    });
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: { open: cacheOpen },
    });
    render(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT)}
      />,
    );

    selectImage(makeFile("first.jpg"));
    fireEvent.change(screen.getByLabelText("Choose a different photo"), {
      target: { files: [makeFile("second.jpg")] },
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-1");
    fireEvent.click(screen.getByRole("button", { name: "Read my exercise" }));
    await screen.findByRole("heading", { name: "Here's what I found" });

    expect(localSet).not.toHaveBeenCalled();
    expect(localRemove).not.toHaveBeenCalled();
    expect(indexedOpen).not.toHaveBeenCalled();
    expect(cacheOpen).not.toHaveBeenCalled();
    expect(
      screen.getByText(/not saved by Compass/i),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/zero data retention|zero retention/i);
  });

  it("locks new photo selection only while a GeoGebra transaction is in flight", () => {
    const { rerender } = render(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT)}
        initializationState={{ status: "waiting_for_applet" }}
      />,
    );
    expect(screen.getByLabelText("Choose a photo")).toBeEnabled();
    expect(screen.getByLabelText("Take a photo")).toBeEnabled();

    rerender(
      <ExerciseConfirmation
        onConfirmed={vi.fn()}
        parseExercise={vi.fn<ExerciseParser>().mockResolvedValue(READY_RESULT)}
        initializationState={{ status: "initializing" }}
      />,
    );
    expect(screen.getByLabelText("Choose a photo")).toBeDisabled();
    expect(screen.getByLabelText("Take a photo")).toBeDisabled();
  });
});

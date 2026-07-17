import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "./language-provider";
import { GeometryTeacherStudio } from "./geometry-teacher-studio";

vi.mock("./geogebra-scratchpad", () => ({
  GeoGebraScratchpad: ({
    investigation,
    onReadiness,
  }: {
    investigation: { id: string };
    onReadiness?(value: Record<string, unknown>): void;
  }) => (
    <div data-testid="real-preview">
      GeoGebra preview
      <button
        type="button"
        onClick={() =>
          onReadiness?.({
            schemaVersion: "geometry_scratchpad_readiness.v1",
            activityId: investigation.id,
            status: "ready",
            scaffoldVerified: true,
            epoch: 1,
            revision: 1,
            snapshotHash: "preview-hash",
          })
        }
      >
        Signal preview ready
      </button>
      <button
        type="button"
        onClick={() =>
          onReadiness?.({
            schemaVersion: "geometry_scratchpad_readiness.v1",
            activityId: investigation.id,
            status: "fatal",
            scaffoldVerified: false,
          })
        }
      >
        Signal preview fatal
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GeometryTeacherStudio", () => {
  it("requires a valid real preview before publishing the exact draft", async () => {
    const onPublished = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { draft } = JSON.parse(String(init?.body)) as {
        draft: Record<string, unknown>;
      };
      return Response.json(
        {
          publication: {
            ...draft,
            schemaVersion: "teacher_exercise_publication.v2",
            id: "teacher_geometry-001",
            publishedAt: 123,
          },
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LanguageProvider>
        <GeometryTeacherStudio onPublished={onPublished} />
      </LanguageProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare the Varignon investigation" }),
    );
    expect(
      screen.getByRole("button", { name: "Share the investigation" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Open the real preview" }),
    );
    expect(screen.getByTestId("real-preview")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview reviewed" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Signal preview ready" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview reviewed" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Share the investigation" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(onPublished).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "teacher_geometry-001",
        content: expect.objectContaining({ kind: "geometry_investigation" }),
      }),
    );
    expect(
      screen.getByRole("link", { name: "Open the student view in a new tab" }),
    ).toHaveAttribute("target", "_blank");
  });

  it("blocks preview and publication while an editable field is red", () => {
    render(
      <LanguageProvider>
        <GeometryTeacherStudio />
      </LanguageProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare the Varignon investigation" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "" },
    });
    expect(
      screen.getByRole("button", { name: "Open the real preview" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Correct the red review before previewing or sharing."),
    ).toBeInTheDocument();
  });

  it("invalidates approval on preview failure and reset", () => {
    render(
      <LanguageProvider>
        <GeometryTeacherStudio />
      </LanguageProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare the Varignon investigation" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open the real preview" }),
    );
    const approve = screen.getByRole("button", { name: "Preview reviewed" });
    fireEvent.click(screen.getByRole("button", { name: "Signal preview ready" }));
    expect(approve).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Signal preview fatal" }));
    expect(approve).toBeDisabled();
    expect(
      screen.getByText("The real preview failed and cannot be approved."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Signal preview ready" }));
    fireEvent.click(approve);
    expect(
      screen.getByRole("button", { name: "Share the investigation" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset preview" }));
    expect(
      screen.getByRole("button", { name: "Share the investigation" }),
    ).toBeDisabled();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "./language-provider";
import { TeacherWorkspace } from "./teacher-workspace";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TeacherWorkspace", () => {
  it("publishes a reviewed manual draft and keeps the publication identity", async () => {
    const onPublished = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { draft: Record<string, unknown> };
      return Response.json(
        {
          publication: {
            ...body.draft,
            id: "teacher_manual-001",
            publishedAt: 123,
          },
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LanguageProvider>
        <TeacherWorkspace
          onBack={() => undefined}
          onOpenLibrary={() => undefined}
          onPublished={onPublished}
        />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Write it myself" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: /Exercise title or instructions/ }),
      { target: { value: "Compare fractions" } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Steps students must complete/ }), {
      target: {
        value: "Find a common denominator.\nCompare the numerators.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview my exercise" }));
    fireEvent.click(screen.getByRole("button", { name: "Share with students" }));

    await waitFor(() =>
      expect(
        screen.getByText("Exercise shared. It is now available in the student library."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "See it in the student library" })).toBeInTheDocument();
    expect(
      screen.getByText("Every step is present and no exact duplicate was found."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/closed teacher exercise schema/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/gpt-5.6/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onPublished).toHaveBeenCalledWith(
      expect.objectContaining({ id: "teacher_manual-001" }),
    );
  });

  it("renders only anonymous factual learning signals", () => {
    render(
      <LanguageProvider>
        <TeacherWorkspace
          onBack={() => undefined}
          onOpenLibrary={() => undefined}
          learningReports={[
            {
              schemaVersion: "learning_session_report.v1",
              exerciseId: "teacher_manual-001",
              title: "Compare fractions",
              subject: "mathematics",
              totalMissions: 3,
              completedMissions: 2,
              verifiedMissions: 1,
              reflectedMissions: 1,
              exerciseXp: 30,
              transferCompleted: false,
              updatedAt: 123,
            },
          ]}
        />
      </LanguageProvider>,
    );

    expect(screen.getByRole("heading", { name: "What happened in this tab" })).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("Anonymous session facts only: no learner name, answer text, grade or saved history.")).toBeInTheDocument();
    expect(screen.queryByText(/learner name/i)).toBeInTheDocument();
  });

  it("offers a teacher-friendly fallback when Compass cannot prepare the exercise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message: "AI drafting is not configured. You can still create a manual draft.",
            },
          },
          { status: 503 },
        ),
      ),
    );

    render(
      <LanguageProvider>
        <TeacherWorkspace onBack={() => undefined} onOpenLibrary={() => undefined} />
      </LanguageProvider>,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: /What should students practise/ }),
      { target: { value: "Fractions" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create this exercise" }));

    expect(
      await screen.findByRole("button", { name: "Enter it myself" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Compass couldn't prepare the exercise. Try again or enter it yourself.",
      ),
    ).toBeInTheDocument();
  });
});

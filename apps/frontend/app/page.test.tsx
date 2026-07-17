import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LanguageProvider } from "@/components/language-provider";
import Home from "./page";

afterEach(cleanup);

describe("Home", () => {
  it("opens the teacher Varignon activity directly without class friction", () => {
    render(
      <LanguageProvider>
        <Home />
      </LanguageProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Build. Observe. Prove.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No account. No class code."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add my exercise/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Join my class/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Professor" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Start the exercise/ }));

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Varignon — the midpoint quadrilateral",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to the demo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Class code"),
    ).not.toBeInTheDocument();
  });

  it("opens the professor studio from the top-right access", () => {
    render(
      <LanguageProvider>
        <Home />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Professor" }));

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Prepare an exercise for your students.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Choose")).toBeInTheDocument();
    expect(screen.getByText("Guide")).toBeInTheDocument();
    expect(screen.getByText("Share")).toBeInTheDocument();
    expect(screen.queryByText(/gpt-5.6/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/model calls/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/prototype/i)).not.toBeInTheDocument();
  });

  it("switches the complete interface between English and French", async () => {
    render(
      <LanguageProvider>
        <Home />
      </LanguageProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Passer en français" }),
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Construis. Observe. Prouve.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Professeur" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Commencer l’exercice/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/devoir/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to English" }),
    ).toHaveTextContent("🇬🇧EN");
    await waitFor(() => expect(document.documentElement.lang).toBe("fr"));

    fireEvent.click(
      screen.getByRole("button", { name: "Switch to English" }),
    );
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  });
});

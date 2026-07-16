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
  it("renders the landing first, then opens a dedicated upload screen", () => {
    render(
      <LanguageProvider>
        <Home />
      </LanguageProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Bring the exercise. Find your own way through it.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Add your exercise")).toBeInTheDocument();
    expect(screen.getByText("Check the reading")).toBeInTheDocument();
    expect(screen.getByText("Work with Compass")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        level: 2,
        name: "Show me your exercise",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Keep wondering. Keep trying.",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Add my exercise" }));

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Show me your exercise",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read my exercise" })).toBeDisabled();
    expect(
      screen.queryByRole("heading", { name: "Keep wondering. Keep trying." }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
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
        name: "Apporte l'exercice. Trouve ton chemin pour le comprendre.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ajoute ton exercice")).toBeInTheDocument();
    expect(screen.getByText("Vérifie la lecture")).toBeInTheDocument();
    expect(screen.getByText("Travaille avec Compass")).toBeInTheDocument();
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

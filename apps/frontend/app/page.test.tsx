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
  it("renders the student-facing Compass journey without requiring a secret", () => {
    render(
      <LanguageProvider>
        <Home />
      </LanguageProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Geometry clicks when you can play with it.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Add your exercise")).toBeInTheDocument();
    expect(screen.getByText("Build it yourself")).toBeInTheDocument();
    expect(screen.getByText("Make it click")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Show me your exercise",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read my exercise" })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Add my exercise" }),
    ).toHaveAttribute("href", "#exercise-photo-title");
    expect(
      screen.getByRole("link", { name: "License and attribution" }),
    ).toHaveAttribute("href", "https://www.geogebra.org/license");
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Keep wondering. Keep drawing.",
      }),
    ).toBeInTheDocument();
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
        name: "La géométrie devient claire quand tu peux la manipuler.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ajoute ton exercice")).toBeInTheDocument();
    expect(screen.getByText("Construis par toi-même")).toBeInTheDocument();
    expect(screen.getByText("Comprends vraiment")).toBeInTheDocument();
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

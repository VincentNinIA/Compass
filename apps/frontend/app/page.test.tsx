import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("renders the student-facing GeoTutor journey without requiring a secret", () => {
    render(<Home />);

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
});

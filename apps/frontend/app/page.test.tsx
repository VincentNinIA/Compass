import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("renders the executable GeoTutor shell without requiring a secret", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Think it through. Draw it. Explain it.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Runtime ready")).toBeInTheDocument();
    expect(screen.getByText("Geometry workspace")).toBeInTheDocument();
    expect(screen.getByText("Voice session")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Start from the exercise sheet",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();
  });
});

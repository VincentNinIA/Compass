import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoAccessGate } from "./demo-access-gate";
import { LanguageProvider } from "./language-provider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("T24 DemoAccessGate", () => {
  it("keeps the code in a password field and reports a safe refusal", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: "demo_access_invalid", message: "Invalid." } },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <LanguageProvider>
        <DemoAccessGate />
      </LanguageProvider>,
    );

    const input = screen.getByLabelText("Access code");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "private-demo-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Open Compass" }));

    await waitFor(() =>
      expect(screen.getByText("This access code is not valid.")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/demo/access",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    expect(document.body.textContent).not.toContain("private-demo-code");
  });

  it("renders a closed message without an input when configuration is unavailable", () => {
    render(
      <LanguageProvider>
        <DemoAccessGate unavailable />
      </LanguageProvider>,
    );
    expect(screen.getByText(/temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Access code")).not.toBeInTheDocument();
  });
});

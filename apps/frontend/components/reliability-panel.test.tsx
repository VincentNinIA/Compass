import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LatencyBudgetMonitor } from "@/lib/reliability/latency-budget";
import { ReliabilityPanel } from "./reliability-panel";

afterEach(cleanup);

describe("ReliabilityPanel", () => {
  it("renders all budgets without claiming unmeasured paths passed", () => {
    const monitor = new LatencyBudgetMonitor({ now: () => 1 });
    render(<ReliabilityPanel monitor={monitor} />);
    const table = screen.getByRole("table", {
      name: "In-memory latency distributions for this page session",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Unmeasured paths are never presented as passed",
    );
    expect(table).not.toHaveTextContent("provider");
  });

  it("announces an honest fallback when a budget is exceeded", () => {
    const monitor = new LatencyBudgetMonitor({ now: () => 1 });
    render(<ReliabilityPanel monitor={monitor} />);
    act(() => {
      monitor.record("first_audio", 5_001);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "use live text or scripted local mode",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Active fallback: typed live",
    );
  });
});

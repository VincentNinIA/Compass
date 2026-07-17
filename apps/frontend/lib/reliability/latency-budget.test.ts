import { describe, expect, it, vi } from "vitest";

import { LATENCY_BUDGETS, LatencyBudgetMonitor } from "./latency-budget";

describe("LatencyBudgetMonitor", () => {
  it("publishes all five named budgets and exact nearest-rank p50/p95", () => {
    const monitor = new LatencyBudgetMonitor({ now: () => 42 });
    for (const duration of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
      monitor.record("feedback_local", duration);
    }
    const exported = monitor.exportDebug();
    const feedback = exported.distributions.find(
      ({ name }) => name === "feedback_local",
    );

    expect(Object.keys(LATENCY_BUDGETS)).toEqual([
      "image",
      "feedback_local",
      "session",
      "first_audio",
      "tool",
    ]);
    expect(feedback).toMatchObject({
      sampleCount: 10,
      p50Ms: 50,
      p95Ms: 100,
      latestMs: 100,
      status: "within_budget",
    });
    expect(exported.version).toBe("geotutor.latency.v1");
    expect(exported.generatedAt).toBe(42);
    expect(Object.isFrozen(exported.distributions)).toBe(true);
  });

  it.each([
    ["image", 20_001, "manual_image_retry"],
    ["feedback_local", 251, "local_feedback_delayed"],
    ["session", 12_001, "scripted_local"],
    ["first_audio", 5_001, "typed_live"],
    ["tool", 2_001, "stop_tool_turn"],
  ] as const)("degrades %s honestly above its named budget", (name, duration, fallback) => {
    const monitor = new LatencyBudgetMonitor({ now: () => 7 });
    const sample = monitor.record(name, duration);
    expect(sample).toEqual({
      name,
      durationMs: duration,
      budgetMs: LATENCY_BUDGETS[name].limitMs,
      status: "degraded",
      fallback,
      measuredAt: 7,
    });
    expect(
      monitor.exportDebug().distributions.find((entry) => entry.name === name),
    ).toMatchObject({ status: "degraded", fallback });
  });

  it("bounds distributions, ignores invalid samples and notifies subscribers", () => {
    const monitor = new LatencyBudgetMonitor({ maximumSamplesPerBudget: 2 });
    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);
    expect(monitor.record("tool", Number.NaN)).toBeUndefined();
    monitor.record("tool", 1);
    monitor.record("tool", 2);
    monitor.record("tool", 3);
    expect(
      monitor.exportDebug().distributions.find(({ name }) => name === "tool"),
    ).toMatchObject({ sampleCount: 2, p50Ms: 2, p95Ms: 3 });
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    monitor.clear();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

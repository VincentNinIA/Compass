export const LATENCY_BUDGETS = Object.freeze({
  image: Object.freeze({
    limitMs: 20_000,
    fallback: "manual_image_retry",
    userMessage: "Image analysis is delayed; retry manually or continue locally.",
  }),
  feedback_local: Object.freeze({
    limitMs: 250,
    fallback: "local_feedback_delayed",
    userMessage: "Local feedback is delayed; geometric claims remain unspoken until verified.",
  }),
  session: Object.freeze({
    limitMs: 12_000,
    fallback: "scripted_local",
    userMessage: "Live session setup exceeded its budget; scripted local mode remains active.",
  }),
  first_audio: Object.freeze({
    limitMs: 5_000,
    fallback: "typed_live",
    userMessage: "First audio exceeded its budget; use live text or scripted local mode.",
  }),
  tool: Object.freeze({
    limitMs: 2_000,
    fallback: "stop_tool_turn",
    userMessage: "A tool exceeded its budget; the turn stopped without a late mutation.",
  }),
});

export type LatencyBudgetName = keyof typeof LATENCY_BUDGETS;
export type LatencyFallback =
  (typeof LATENCY_BUDGETS)[LatencyBudgetName]["fallback"];

export type LatencySample = Readonly<{
  name: LatencyBudgetName;
  durationMs: number;
  budgetMs: number;
  status: "within_budget" | "degraded";
  fallback: LatencyFallback;
  measuredAt: number;
}>;

export type LatencyDistribution = Readonly<{
  name: LatencyBudgetName;
  budgetMs: number;
  sampleCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  latestMs: number | null;
  status: "unmeasured" | "within_budget" | "degraded";
  fallback: LatencyFallback;
  userMessage: string;
}>;

export type LatencyBudgetExport = Readonly<{
  version: "geotutor.latency.v1";
  generatedAt: number;
  distributions: readonly LatencyDistribution[];
}>;

const BUDGET_NAMES = Object.freeze(
  Object.keys(LATENCY_BUDGETS) as LatencyBudgetName[],
);

export class LatencyBudgetMonitor {
  private readonly samples = new Map<LatencyBudgetName, number[]>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly options: {
      now?: () => number;
      maximumSamplesPerBudget?: number;
    } = {},
  ) {}

  record(name: LatencyBudgetName, durationMs: number): LatencySample | undefined {
    if (!BUDGET_NAMES.includes(name) || !Number.isFinite(durationMs) || durationMs < 0) {
      return undefined;
    }
    const normalized = Math.round(durationMs * 1_000) / 1_000;
    const maximum = Math.max(
      1,
      Math.min(256, this.options.maximumSamplesPerBudget ?? 64),
    );
    const samples = [...(this.samples.get(name) ?? []), normalized].slice(-maximum);
    this.samples.set(name, samples);
    const definition = LATENCY_BUDGETS[name];
    const sample = Object.freeze({
      name,
      durationMs: normalized,
      budgetMs: definition.limitMs,
      status:
        normalized <= definition.limitMs
          ? ("within_budget" as const)
          : ("degraded" as const),
      fallback: definition.fallback,
      measuredAt: (this.options.now ?? Date.now)(),
    });
    for (const listener of this.listeners) listener();
    return sample;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  exportDebug(): LatencyBudgetExport {
    const distributions = BUDGET_NAMES.map((name) => {
      const definition = LATENCY_BUDGETS[name];
      const samples = this.samples.get(name) ?? [];
      const latest = samples.at(-1) ?? null;
      const distribution: LatencyDistribution = {
        name,
        budgetMs: definition.limitMs,
        sampleCount: samples.length,
        p50Ms: percentile(samples, 0.5),
        p95Ms: percentile(samples, 0.95),
        latestMs: latest,
        status:
          latest === null
            ? "unmeasured"
            : latest <= definition.limitMs
              ? "within_budget"
              : "degraded",
        fallback: definition.fallback,
        userMessage: definition.userMessage,
      };
      return Object.freeze(distribution);
    });
    return Object.freeze({
      version: "geotutor.latency.v1",
      generatedAt: (this.options.now ?? Date.now)(),
      distributions: Object.freeze(distributions),
    });
  }

  clear(): void {
    this.samples.clear();
    for (const listener of this.listeners) listener();
  }
}

function percentile(samples: readonly number[], ratio: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ratio * sorted.length) - 1);
  return sorted[index] ?? null;
}

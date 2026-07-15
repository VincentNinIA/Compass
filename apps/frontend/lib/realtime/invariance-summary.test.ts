import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_POSITION_VERSION,
  INVARIANCE_SAMPLE_PARAMETERS,
  type InvarianceRunCompleted,
} from "@/lib/invariance/contracts";
import {
  INVARIANCE_GENERALIZATION_DIRECTIVE_VERSION,
  INVARIANCE_GENERALIZATION_GOAL,
  type InvarianceGeneralizationDirective,
  type InvarianceVerbalizationContext,
} from "@/lib/invariance/verbalization";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvent,
  type PedagogyState,
  type VerifiedFact,
} from "@/lib/pedagogy/state";
import {
  INVARIANCE_SUMMARY_METADATA_KIND,
  InvarianceOobSummaryCoordinator,
  createDeterministicInvarianceSummary,
  type InvarianceSummaryClientEvent,
} from "./invariance-summary";

const PLAN = deriveExercisePlanV1({
  schemaVersion: "exercise_extraction.v1",
  outcome: "ready",
  language: "en",
  instruction: "Construct the perpendicular bisector of AB.",
  pointLabels: ["A", "B"],
  segmentEndpoints: ["A", "B"],
  requestedConstruction: "perpendicular_bisector",
  learningObjective: "perpendicular_bisector_equidistance",
  ambiguityCode: null,
  clarificationQuestion: null,
  unsupportedReason: null,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("T5-C05 Realtime out-of-band invariance summary", () => {
  it("sends a text-only no-tool response.create outside the conversation with string metadata", async () => {
    const harness = createHarness();

    const outcome = harness.coordinator.request(harness.result, harness.directive);
    const event = requireSentEvent(harness.sent, 0);

    expect(event).toMatchObject({
      type: "response.create",
      event_id: "summary-event-1",
      response: {
        conversation: "none",
        output_modalities: ["text"],
        tools: [],
        tool_choice: "none",
        metadata: {
          kind: INVARIANCE_SUMMARY_METADATA_KIND,
          runId: "run-1",
          revision: "11",
        },
      },
    });
    expect(event.response.metadata).toEqual({
      kind: "geotutor_invariance_summary_v1",
      runId: "run-1",
      revision: "11",
    });
    expect(
      Object.values(event.response.metadata).every(
        (value) => typeof value === "string",
      ),
    ).toBe(true);
    expect(JSON.stringify(event)).not.toContain("audio");
    expect(JSON.stringify(event)).not.toContain("conversation.item.create");

    const input = JSON.parse(event.response.input[0].content[0].text) as {
      samples: Array<Record<string, unknown>>;
    };
    expect(input).toEqual({
      samples: harness.result.samples.map(
        ({ index, parameter, pa, pb, delta, tolerance, id }) => ({
          index,
          parameter,
          pa,
          pb,
          delta,
          tolerance,
          evidenceId: id,
        }),
      ),
    });
    expect(input.samples).toHaveLength(5);
    const serializedInput = event.response.input[0].content[0].text;
    expect(serializedInput).not.toContain("hash-11");
    expect(serializedInput).not.toContain("evidence-11-perpendicular");
    expect(serializedInput).not.toContain("passes_midpoint");
    expect(serializedInput).not.toContain("candidateLine");
    expect(serializedInput).not.toContain("transcript");

    complete(harness.coordinator, event, "response-1", "Model synthesis.");
    expect(await outcome).toMatchObject({
      status: "rendered",
      render: {
        source: "realtime",
        text: "Model synthesis.",
        reason: "completed",
      },
    });
  });

  it("routes concurrent response.created/done events by metadata and response ID without cross-talk", async () => {
    const harness = createHarness();
    const resultA = harness.result;
    const directiveA = harness.directive;
    const pendingA = harness.coordinator.request(resultA, directiveA);
    const eventA = requireSentEvent(harness.sent, 0);

    const resultB = completedResult("run-2", 12);
    const contextB = contextFor(resultB);
    const directiveB = directiveFor(resultB, contextB);
    harness.setContext(contextB);
    const pendingB = harness.coordinator.request(resultB, directiveB);
    const eventB = requireSentEvent(harness.sent, 1);

    expect(
      harness.coordinator.handle(responseCreated(eventB, "response-b")),
    ).toBe(true);
    expect(
      harness.coordinator.handle(responseCreated(eventA, "response-a")),
    ).toBe(true);
    expect(
      harness.coordinator.handle(
        responseDone(eventB, "response-b", "Summary for B."),
      ),
    ).toBe(true);
    expect(
      harness.coordinator.handle(
        responseDone(eventA, "response-a", "Stale summary for A."),
      ),
    ).toBe(true);

    expect(await pendingB).toMatchObject({
      status: "rendered",
      render: { responseId: "response-b", text: "Summary for B." },
    });
    expect(await pendingA).toMatchObject({
      status: "fallback",
      render: {
        responseId: "response-a",
        source: "deterministic",
        reason: "stale_authority",
        text: createDeterministicInvarianceSummary(resultA),
      },
    });
    expect(harness.renders.map(({ runId }) => runId).sort()).toEqual([
      "run-1",
      "run-2",
    ]);
  });

  it("accepts response.done without response.created when metadata identifies the request", async () => {
    const harness = createHarness();
    const pending = harness.coordinator.request(harness.result, harness.directive);
    const event = requireSentEvent(harness.sent, 0);

    expect(
      harness.coordinator.handle(
        responseDone(event, "response-direct", "Direct done text."),
      ),
    ).toBe(true);

    expect(await pending).toMatchObject({
      status: "rendered",
      render: {
        responseId: "response-direct",
        text: "Direct done text.",
      },
    });
  });

  it("accepts a live text-only response that echoes session audio configuration but emits only output_text", async () => {
    const harness = createHarness();
    const pending = harness.coordinator.request(harness.result, harness.directive);
    const event = requireSentEvent(harness.sent, 0);
    const done = responseDone(event, "response-live-shape", "Live text only.");
    Object.assign(done.response, {
      audio: { output: { voice: "marin" } },
    });

    expect(harness.coordinator.handle(done)).toBe(true);
    expect(await pending).toMatchObject({
      status: "rendered",
      render: {
        source: "realtime",
        reason: "completed",
        text: "Live text only.",
      },
    });
  });

  it("deduplicates both an in-flight and a terminal five-proof signature", async () => {
    const harness = createHarness();
    const first = harness.coordinator.request(harness.result, harness.directive);
    const duplicateInFlight = await harness.coordinator.request(
      harness.result,
      harness.directive,
    );

    expect(duplicateInFlight).toMatchObject({
      status: "ignored",
      reason: "duplicate",
    });
    expect(harness.sent).toHaveLength(1);

    const event = requireSentEvent(harness.sent, 0);
    complete(harness.coordinator, event, "response-once", "Only once.");
    await first;
    expect(
      await harness.coordinator.request(harness.result, harness.directive),
    ).toMatchObject({ status: "ignored", reason: "duplicate" });
    expect(harness.sent).toHaveLength(1);
    expect(harness.renderSummary).toHaveBeenCalledOnce();
  });

  it("revalidates revision authority before send and renders the exact local fallback", async () => {
    const harness = createHarness();
    harness.setContext({ ...harness.context, currentRevision: 12 });

    const outcome = await harness.coordinator.request(
      harness.result,
      harness.directive,
    );

    expect(harness.sent).toEqual([]);
    expect(outcome).toEqual({
      status: "fallback",
      render: {
        runId: "run-1",
        revision: 11,
        eventId: "summary-event-1",
        responseId: null,
        source: "deterministic",
        text: exactFallback(),
        reason: "stale_authority",
      },
    });
  });

  it.each(["cancelled", "failed", "incomplete"] as const)(
    "falls back when response.done is %s",
    async (status) => {
      const harness = createHarness();
      const pending = harness.coordinator.request(
        harness.result,
        harness.directive,
      );
      const event = requireSentEvent(harness.sent, 0);
      harness.coordinator.handle(responseCreated(event, "response-status"));
      harness.coordinator.handle({
        ...responseDone(event, "response-status", "Must be ignored."),
        response: {
          ...responseDone(event, "response-status", "Must be ignored.").response,
          status,
        },
      });

      expect(await pending).toMatchObject({
        status: "fallback",
        render: {
          source: "deterministic",
          text: exactFallback(),
          reason: "response_not_completed",
        },
      });
    },
  );

  it.each([
    ["empty text", "", "empty_text"],
    ["audio payload", "Model text.", "invalid_payload"],
    ["conversation leak", "Model text.", "invalid_payload"],
  ] as const)("uses fallback for %s", async (variant, text, expectedReason) => {
    const harness = createHarness();
    const pending = harness.coordinator.request(harness.result, harness.directive);
    const event = requireSentEvent(harness.sent, 0);
    const done = responseDone(event, "response-invalid", text);
    if (variant === "audio payload") {
      done.response.output_modalities = ["audio"];
      const outputItem = done.response.output[0] as {
        content: Array<{
          type: string;
          text?: string;
          transcript?: string;
        }>;
      };
      outputItem.content = [
        { type: "output_audio", transcript: "must not render" },
      ];
    }
    if (variant === "conversation leak") {
      done.response.conversation_id = "conv-default";
    }

    harness.coordinator.handle(done);

    expect(await pending).toMatchObject({
      status: "fallback",
      render: {
        source: "deterministic",
        text: exactFallback(),
        reason: expectedReason,
      },
    });
  });

  it("routes a correlated Realtime error to fallback and ignores unrelated errors", async () => {
    const harness = createHarness();
    const pending = harness.coordinator.request(harness.result, harness.directive);

    expect(
      harness.coordinator.handle({
        type: "error",
        error: { event_id: "unrelated-event", message: "unrelated" },
      }),
    ).toBe(false);
    expect(
      harness.coordinator.handle({
        type: "error",
        error: { event_id: "summary-event-1", message: "private upstream" },
      }),
    ).toBe(true);

    expect(await pending).toMatchObject({
      status: "fallback",
      render: { reason: "realtime_error", text: exactFallback() },
    });
    expect(JSON.stringify(harness.renders)).not.toContain("private upstream");
  });

  it.each(["returns false", "throws"])(
    "falls back when send %s",
    async (mode) => {
      const harness = createHarness({ sendMode: mode === "throws" ? "throw" : "false" });

      expect(
        await harness.coordinator.request(harness.result, harness.directive),
      ).toMatchObject({
        status: "fallback",
        render: { reason: "send_failed", text: exactFallback() },
      });
      expect(harness.renderSummary).toHaveBeenCalledOnce();
    },
  );

  it("times out once, renders fallback, and ignores a late duplicate done", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ timeoutMs: 25 });
    const pending = harness.coordinator.request(harness.result, harness.directive);
    const event = requireSentEvent(harness.sent, 0);

    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toMatchObject({
      status: "fallback",
      render: { reason: "timeout", text: exactFallback() },
    });
    expect(harness.coordinator.handle(responseDone(event, "late", "Late."))).toBe(
      false,
    );
    expect(harness.renderSummary).toHaveBeenCalledOnce();
  });

  it("closes an in-flight OOB response with the deterministic transport fallback", async () => {
    const harness = createHarness();
    const pending = harness.coordinator.request(harness.result, harness.directive);
    const event = requireSentEvent(harness.sent, 0);
    expect(
      harness.coordinator.handle(responseCreated(event, "response-closing")),
    ).toBe(true);

    await harness.coordinator.close();

    expect(await pending).toMatchObject({
      status: "fallback",
      render: {
        responseId: "response-closing",
        reason: "transport_closed",
        text: exactFallback(),
      },
    });
    expect(
      harness.coordinator.handle(
        responseDone(event, "response-closing", "Late model text."),
      ),
    ).toBe(false);
    expect(harness.renderSummary).toHaveBeenCalledOnce();
  });

  it("cancels an in-flight OOB response on reset without rendering fallback or late text", async () => {
    const harness = createHarness();
    const pending = harness.coordinator.request(harness.result, harness.directive);
    const event = requireSentEvent(harness.sent, 0);
    expect(
      harness.coordinator.handle(responseCreated(event, "response-reset")),
    ).toBe(true);

    expect(harness.coordinator.cancelPending()).toEqual([
      { eventId: "summary-event-1", responseId: "response-reset" },
    ]);
    expect(await pending).toEqual({
      status: "ignored",
      reason: "cancelled",
      runId: "run-1",
      revision: 11,
    });
    expect(harness.renders).toEqual([]);
    expect(
      harness.coordinator.handle(
        responseDone(event, "response-reset", "Late reset text."),
      ),
    ).toBe(false);
    expect(harness.renders).toEqual([]);
  });

  it("falls back on malformed metadata and does not render an unverified model text", async () => {
    const harness = createHarness();
    const pending = harness.coordinator.request(harness.result, harness.directive);
    const event = requireSentEvent(harness.sent, 0);
    const done = responseDone(event, "response-malformed", "Forged summary.");
    done.response.metadata.revision = 11 as unknown as string;

    expect(harness.coordinator.handle(done)).toBe(true);
    expect(await pending).toMatchObject({
      status: "fallback",
      render: { reason: "invalid_payload", text: exactFallback() },
    });
    expect(JSON.stringify(harness.renders)).not.toContain("Forged summary");
  });
});

function createHarness(
  options: Readonly<{
    sendMode?: "true" | "false" | "throw";
    timeoutMs?: number;
  }> = {},
) {
  const result = completedResult("run-1", 11);
  let context = contextFor(result);
  const directive = directiveFor(result, context);
  const sent: InvarianceSummaryClientEvent[] = [];
  const renders: Parameters<
    ConstructorParameters<typeof InvarianceOobSummaryCoordinator>[0]["renderSummary"]
  >[0][] = [];
  const send = vi.fn((event: InvarianceSummaryClientEvent) => {
    sent.push(event);
    if (options.sendMode === "throw") throw new Error("send failed");
    return options.sendMode !== "false";
  });
  const renderSummary = vi.fn((summary: (typeof renders)[number]) => {
    renders.push(summary);
  });
  let eventSequence = 0;
  const coordinator = new InvarianceOobSummaryCoordinator({
    send,
    getCurrentContext: () => context,
    renderSummary,
    createEventId: () => `summary-event-${++eventSequence}`,
    timeoutMs: options.timeoutMs ?? 1_000,
  });
  return {
    result,
    directive,
    get context() {
      return context;
    },
    setContext(next: InvarianceVerbalizationContext) {
      context = next;
    },
    sent,
    renders,
    send,
    renderSummary,
    coordinator,
  };
}

function completedResult(runId: string, revision: number): InvarianceRunCompleted {
  const samples = INVARIANCE_SAMPLE_PARAMETERS.map((parameter, index) => {
    const distance = 3 + index;
    return Object.freeze({
      id: `invariance-${runId}-${index}`,
      index: index as 0 | 1 | 2 | 3 | 4,
      parameter,
      coords: Object.freeze([parameter, 0]) as readonly [number, number],
      pa: distance,
      pb: distance,
      delta: 0,
      tolerance: INVARIANCE_DISTANCE_TOLERANCE,
      toleranceVersion: INVARIANCE_DISTANCE_TOLERANCE_VERSION,
      positionVersion: INVARIANCE_POSITION_VERSION,
      pass: true,
      revision,
    });
  }) as unknown as InvarianceRunCompleted["samples"];
  return Object.freeze({
    status: "completed",
    runId,
    revision,
    inputEvidenceIds: Object.freeze([
      `evidence-${revision}-perpendicular`,
      `evidence-${revision}-passes_midpoint`,
    ]),
    samples: Object.freeze(samples),
    pass: true,
    evidenceIds: Object.freeze(
      samples.map(({ id }) => id),
    ) as InvarianceRunCompleted["evidenceIds"],
  });
}

function contextFor(result: InvarianceRunCompleted): InvarianceVerbalizationContext {
  return {
    state: completedPedagogyState(result.revision),
    currentRunId: result.runId,
    currentRevision: result.revision,
    inputEvidenceIds: [...result.inputEvidenceIds],
    evidenceIds: [...result.evidenceIds],
  };
}

function completedPedagogyState(revision: number): PedagogyState {
  const initial = createInitialPedagogyState(PLAN, { epoch: 4 });
  const facts: VerifiedFact[] = (
    ["perpendicular", "passes_midpoint"] as const
  ).map((relationKey) => ({
    relationKey,
    status: "verified",
    evidenceId: `evidence-${revision}-${relationKey}`,
  }));
  const committed = pedagogyReducer(initial, {
    type: "validated_action_committed",
    epoch: initial.epoch,
    exerciseId: initial.exerciseId,
    stepId: initial.stepId,
    actionId: `action-${revision}`,
    revision,
    snapshotHash: `hash-${revision}`,
    facts,
    evidence: facts.map((fact) => ({
      id: fact.evidenceId,
      relation: fact.relationKey,
      pass: true,
      observed: 0,
      tolerance: INVARIANCE_DISTANCE_TOLERANCE,
      revision,
      objects:
        fact.relationKey === "perpendicular"
          ? ["d", "AB"]
          : ["d", "A", "B"],
      snapshotHash: `hash-${revision}`,
    })),
    meaningfulDelta: {
      isMeaningful: true,
      constructionChanged: true,
      factsChanged: true,
      changedStudentObjects: ["d"],
      previousFactSignature: "",
      currentFactSignature:
        "passes_midpoint:verified|perpendicular:verified",
      missingRelationKeys: [],
      reason: "construction_and_facts_changed",
    },
  } satisfies Extract<PedagogyEvent, { type: "validated_action_committed" }>);
  return pedagogyReducer(committed, {
    type: "policy_evaluated",
    decision: "SPEAK",
    sourceActionId: `action-${revision}`,
    sourceRequestId: null,
    epoch: committed.epoch,
    revision: committed.revision,
    snapshotHash: committed.studentSnapshotHash,
  });
}

function directiveFor(
  result: InvarianceRunCompleted,
  context: InvarianceVerbalizationContext,
): InvarianceGeneralizationDirective {
  return Object.freeze({
    schemaVersion: INVARIANCE_GENERALIZATION_DIRECTIVE_VERSION,
    directiveId: `directive-${result.runId}`,
    kind: "completion",
    epoch: context.state.epoch,
    exerciseId: context.state.exerciseId,
    stepId: context.state.stepId,
    baseRevision: result.revision,
    snapshotHash: context.state.studentSnapshotHash,
    sourceActionId: `action-${result.revision}`,
    sourceRunId: result.runId,
    inputEvidenceIds: Object.freeze([...result.inputEvidenceIds]) as readonly [
      string,
      string,
    ],
    evidenceIds: Object.freeze([...result.evidenceIds]) as readonly [
      string,
      string,
      string,
      string,
      string,
    ],
    helpLevel: 1,
    goal: INVARIANCE_GENERALIZATION_GOAL,
    allowedTools: Object.freeze([]) as readonly [],
    status: "draft",
  });
}

function requireSentEvent(
  sent: readonly InvarianceSummaryClientEvent[],
  index: number,
): InvarianceSummaryClientEvent {
  const event = sent[index];
  if (!event) throw new Error(`Missing sent event ${index}.`);
  return event;
}

function responseCreated(
  event: InvarianceSummaryClientEvent,
  responseId: string,
) {
  return {
    type: "response.created",
    response: {
      id: responseId,
      metadata: { ...event.response.metadata },
    },
  };
}

function responseDone(
  event: InvarianceSummaryClientEvent,
  responseId: string,
  text: string,
) {
  return {
    type: "response.done",
    response: {
      id: responseId,
      status: "completed",
      conversation_id: null as string | null,
      output_modalities: ["text"],
      metadata: { ...event.response.metadata },
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text }],
        },
      ],
    },
  };
}

function complete(
  coordinator: InvarianceOobSummaryCoordinator,
  event: InvarianceSummaryClientEvent,
  responseId: string,
  text: string,
): void {
  coordinator.handle(responseCreated(event, responseId));
  coordinator.handle(responseDone(event, responseId, text));
}

function exactFallback(): string {
  return "Observed 5/5 tested positions within tolerance 0.000001: p=-1 (PA=3, PB=3); p=-0.5 (PA=4, PB=4); p=0 (PA=5, PB=5); p=0.5 (PA=6, PB=6); p=1 (PA=7, PB=7). These five measurements support the conjecture that points on the perpendicular bisector are equidistant from A and B; they are numerical evidence, not a universal proof.";
}

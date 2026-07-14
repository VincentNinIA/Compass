import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import {
  DirectiveCorrelationLedger,
  materializeDirective,
  queueDirective,
  toPendingIntervention,
  type InterventionDirective,
} from "@/lib/pedagogy/directive";
import { createFactSignature, deriveMissingRelationKeys } from "@/lib/pedagogy/meaningful-delta";
import type { PolicyDecision } from "@/lib/pedagogy/policy";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvent,
  type PedagogyState,
  type VerifiedFact,
} from "@/lib/pedagogy/state";
import {
  ResponseGate,
  explicitResponseOwner,
} from "./response-gate";
import {
  ProactiveTurnOrchestrator,
  shouldInvalidateQueuedDirective,
  type ProactiveClientEvent,
  type ProactiveTurnSnapshot,
} from "./proactive-turn";

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

const SPEAK: PolicyDecision = {
  type: "speak",
  reason: "repeated_block",
  directiveDraft: {
    kind: "proactive",
    sourceActionId: "action-1",
    sourceRequestId: null,
    helpLevel: 1,
    goal: "ask_reflective_question",
    allowedTools: [],
  },
};

afterEach(() => vi.useRealTimers());

describe("T4-C06 proactive Realtime path", () => {
  it.each(["unavailable", "ignored", "busy", "failed"] as const)(
    "invalidates a locally queued directive after request result %s",
    (result) => {
      expect(shouldInvalidateQueuedDirective(result)).toBe(true);
    },
  );

  it("keeps only a directive whose proactive item was sent", () => {
    expect(shouldInvalidateQueuedDirective("item_sent")).toBe(false);
  });

  it("sends a compact item, waits for its ack, then creates one response", () => {
    const test = harness();
    expect(test.orchestrator.request(SPEAK, test.directive)).toBe("item_sent");
    expect(test.sent.map(({ type }) => type)).toEqual([
      "conversation.item.create",
    ]);
    const item = test.sent[0] as Extract<
      ProactiveClientEvent,
      { type: "conversation.item.create" }
    >;
    const payload = JSON.parse(item.item.content[0].text) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      type: "geotutor_verified_intervention",
      directiveId: "directive-1",
      revision: 1,
      evidenceIds: [
        "evidence-1-passes_midpoint",
        "evidence-1-perpendicular",
      ],
      missingRelationKeys: ["passes_midpoint"],
      helpLevel: 1,
      allowedTools: [],
    });
    expect(JSON.stringify(payload)).not.toContain("rejectedTransitions");

    expect(
      test.orchestrator.handle({
        type: "conversation.item.created",
        item: { id: item.item.id },
      }),
    ).toBe(true);
    expect(test.sent.map(({ type }) => type)).toEqual([
      "conversation.item.create",
      "response.create",
    ]);
    expect(test.sent[0]).toMatchObject({ event_id: "event-1" });
    expect(test.sent[1]).toMatchObject({
      event_id: "event-2",
      response: {
        metadata: {
          geotutor_response_owner: "proactive:directive-1",
          geotutor_directive_id: "directive-1",
          geotutor_response_event_id: "event-2",
        },
      },
    });
  });

  it("correlates response.created/done and releases the unique gate", () => {
    const test = harness();
    test.orchestrator.request(SPEAK, test.directive);
    const item = test.sent[0] as Extract<
      ProactiveClientEvent,
      { type: "conversation.item.create" }
    >;
    test.orchestrator.handle({
      type: "conversation.item.created",
      item: { id: item.item.id },
    });
    const metadata = responseMetadata(test.sent[1]);
    expect(
      test.orchestrator.handle({
        type: "response.created",
        response: { id: "response-1", metadata },
      }),
    ).toBe(true);
    expect(test.state.activeResponse).toEqual({
      responseId: "response-1",
      directiveId: "directive-1",
    });
    expect(
      test.orchestrator.handle({
        type: "response.done",
        response: { id: "response-1", status: "completed", metadata },
      }),
    ).toBe(true);

    expect(test.gate.snapshot()).toBeUndefined();
    expect(test.orchestrator.snapshot()).toBeUndefined();
    expect(test.state.activeResponse).toBeNull();
    expect(test.ledger.get("directive-1")).toMatchObject({
      responseEventId: "event-2",
      responseId: "response-1",
    });
    expect(test.statuses.map(({ status }) => status)).toEqual([
      "item_sent",
      "response_requested",
      "responding",
      "completed",
    ]);
  });

  it.each([
    { type: "silent", reason: "first_incorrect_attempt" },
    {
      type: "queue",
      reason: "floor_busy",
      candidate: {
        kind: "proactive",
        sourceActionId: "action-1",
        sourceRequestId: null,
        helpLevel: 1,
        goal: "ask_reflective_question",
        allowedTools: [],
        businessReason: "repeated_block",
      },
    },
  ] as const)("sends nothing for decision $type", (decision) => {
    const test = harness();
    expect(
      test.orchestrator.request(decision as PolicyDecision, test.directive),
    ).toBe("ignored");
    expect(test.sent).toEqual([]);
  });

  it("re-guards after item ack and sends no response for a newer revision", () => {
    const test = harness();
    test.orchestrator.request(SPEAK, test.directive);
    const item = test.sent[0] as Extract<
      ProactiveClientEvent,
      { type: "conversation.item.create" }
    >;
    test.state = pedagogyReducer(
      test.state,
      actionEvent(test.state, ["verified", "verified"]),
    );

    test.orchestrator.handle({
      type: "conversation.item.created",
      item: { id: item.item.id },
    });
    expect(test.sent.map(({ type }) => type)).toEqual([
      "conversation.item.create",
    ]);
    expect(test.gate.snapshot()).toBeUndefined();
    expect(test.statuses.at(-1)?.status).toBe("failed");
  });

  it("fails an unacknowledged item without retrying", () => {
    vi.useFakeTimers();
    const test = harness({ ackTimeoutMs: 10 });
    test.orchestrator.request(SPEAK, test.directive);
    vi.advanceTimersByTime(11);

    expect(test.sent.map(({ type }) => type)).toEqual([
      "conversation.item.create",
    ]);
    expect(test.statuses.at(-1)?.status).toBe("failed");
    expect(test.gate.snapshot()).toBeUndefined();
  });

  it("emits no item while an explicit response owns the gate", () => {
    const gate = new ResponseGate();
    expect(gate.reserve(explicitResponseOwner("turn-1"))).toBe(true);
    const test = harness({ gate });
    expect(test.orchestrator.request(SPEAK, test.directive)).toBe("busy");
    expect(test.sent).toEqual([]);
  });

  it("cancels an active proactive response before yielding to explicit", () => {
    const test = harness();
    test.orchestrator.request(SPEAK, test.directive);
    const item = test.sent[0] as Extract<
      ProactiveClientEvent,
      { type: "conversation.item.create" }
    >;
    test.orchestrator.handle({
      type: "conversation.item.created",
      item: { id: item.item.id },
    });
    const metadata = responseMetadata(test.sent[1]);
    test.orchestrator.handle({
      type: "response.created",
      response: { id: "response-1", metadata },
    });

    expect(test.orchestrator.cancelForExplicit()).toBe(true);
    expect(test.sent.slice(-2)).toEqual([
      { type: "response.cancel", response_id: "response-1" },
      { type: "output_audio_buffer.clear" },
    ]);
    expect(test.gate.snapshot()).toBeUndefined();
    expect(test.state.activeResponse).toBeNull();
    expect(test.resumeExplicit).toHaveBeenCalledOnce();
  });
});

function harness(options: { gate?: ResponseGate; ackTimeoutMs?: number } = {}) {
  let state = queuedState();
  const directive = queuedDirective(state);
  const sent: ProactiveClientEvent[] = [];
  const statuses: ProactiveTurnSnapshot[] = [];
  const gate = options.gate ?? new ResponseGate();
  const ledger = new DirectiveCorrelationLedger();
  const resumeExplicit = vi.fn();
  let eventSequence = 0;
  const holder = {
    get state() {
      return state;
    },
    set state(value: PedagogyState) {
      state = value;
    },
    directive,
    sent,
    statuses,
    gate,
    ledger,
    resumeExplicit,
    orchestrator: undefined as unknown as ProactiveTurnOrchestrator,
  };
  holder.orchestrator = new ProactiveTurnOrchestrator({
    send: (event) => {
      sent.push(event);
      return true;
    },
    getState: () => state,
    dispatch: (event) => {
      state = pedagogyReducer(state, event);
      return state;
    },
    responseGate: gate,
    correlations: ledger,
    createEventId: () => `event-${++eventSequence}`,
    createItemId: () => "item-directive-1",
    ackTimeoutMs: options.ackTimeoutMs,
    onStatus: (snapshot) => statuses.push(snapshot),
    onGateReleased: resumeExplicit,
  });
  return holder;
}

function queuedState(): PedagogyState {
  const initial = createInitialPedagogyState(PLAN, { epoch: 3 });
  const committed = pedagogyReducer(
    initial,
    actionEvent(initial, ["verified", "missing"]),
  );
  const directive = queuedDirective(committed);
  return pedagogyReducer(committed, {
    type: "directive_queued",
    intervention: toPendingIntervention(directive),
    ...anchor(committed),
  });
}

function queuedDirective(state: PedagogyState): InterventionDirective {
  const draft = SPEAK.type === "speak" ? SPEAK.directiveDraft : neverSpeak();
  const materialized = materializeDirective(state, draft, () => "directive-1");
  if (!materialized) throw new Error("Directive fixture failed.");
  const queued = queueDirective(materialized);
  if (!queued.ok) throw new Error(queued.reason);
  return queued.directive;
}

function neverSpeak(): never {
  throw new Error("Unreachable policy fixture.");
}

function responseMetadata(event: ProactiveClientEvent | undefined) {
  if (event?.type !== "response.create") {
    throw new Error("Expected response.create.");
  }
  return event.response.metadata;
}

function anchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

function actionEvent(
  state: PedagogyState,
  statuses: readonly [VerifiedFact["status"], VerifiedFact["status"]],
): Extract<PedagogyEvent, { type: "validated_action_committed" }> {
  const revision = state.revision + 1;
  const snapshotHash = `hash-${revision}`;
  const facts: VerifiedFact[] = (
    ["perpendicular", "passes_midpoint"] as const
  ).map((relationKey, index) => ({
    relationKey,
    status: statuses[index],
    evidenceId: `evidence-${revision}-${relationKey}`,
  }));
  const previousFactSignature = createFactSignature(state.verifiedFacts);
  const currentFactSignature = createFactSignature(facts);
  return {
    type: "validated_action_committed",
    epoch: state.epoch,
    exerciseId: state.exerciseId,
    stepId: state.stepId,
    actionId: `action-${revision}`,
    revision,
    snapshotHash,
    facts,
    evidence: facts.map((fact) => ({
      id: fact.evidenceId,
      relation: fact.relationKey,
      pass: fact.status === "verified",
      observed: fact.status === "verified" ? 0 : 1,
      tolerance: 0.000001,
      revision,
      objects: ["d", "AB"],
      snapshotHash,
    })),
    meaningfulDelta: {
      isMeaningful: true,
      constructionChanged: true,
      factsChanged: previousFactSignature !== currentFactSignature,
      changedStudentObjects: ["d"],
      previousFactSignature,
      currentFactSignature,
      missingRelationKeys: deriveMissingRelationKeys(facts),
      reason: "construction_and_facts_changed",
    },
  };
}

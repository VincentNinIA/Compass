import { describe, expect, it, vi } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import {
  ToolGateway,
  type GatewayContext,
  type ToolHandlers,
} from "@/lib/tools/gateway";
import { createFactSignature, deriveMissingRelationKeys } from "./meaningful-delta";
import type { DirectiveDraft } from "./policy";
import {
  DirectiveCorrelationLedger,
  completeDirective,
  createDirectiveToolAuthorization,
  dispatchDirective,
  guardDirective,
  interventionDirectiveSchema,
  invalidateDirective,
  materializeDirective,
  queueDirective,
  toPendingIntervention,
  type InterventionDirective,
} from "./directive";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyEvent,
  type PedagogyState,
  type VerifiedFact,
} from "./state";

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

const DRAFT: DirectiveDraft = {
  kind: "proactive",
  sourceActionId: "action-1",
  sourceRequestId: null,
  helpLevel: 1,
  goal: "ask_reflective_question",
  allowedTools: ["check_relation", "highlight_objects"],
};

describe("T4-C05 versioned intervention directives", () => {
  it("materializes a strict directive from current state and immutable evidence", () => {
    const state = committedState();
    const directive = requiredDirective(state);

    expect(directive).toMatchObject({
      schemaVersion: "intervention_directive.v1",
      directiveId: "directive-1",
      kind: "proactive",
      epoch: 7,
      exerciseId: state.exerciseId,
      stepId: state.stepId,
      baseRevision: 1,
      snapshotHash: "hash-1",
      sourceActionId: "action-1",
      sourceRequestId: null,
      evidenceIds: [
        "evidence-1-passes_midpoint",
        "evidence-1-perpendicular",
      ],
      missingRelationKeys: ["passes_midpoint"],
      helpLevel: 1,
      allowedTools: ["check_relation", "highlight_objects"],
      status: "draft",
    });
    expect(
      interventionDirectiveSchema.safeParse({ ...directive, rogue: true })
        .success,
    ).toBe(false);
    expect(() => {
      (directive.evidenceIds as string[]).push("forged");
    }).toThrow();
    expect(directive.evidenceIds).not.toContain("forged");
  });

  it("allows exactly one queue and dispatch then makes terminal states immutable", () => {
    const draft = requiredDirective(committedState());
    const queued = requireTransition(queueDirective(draft));
    const dispatched = requireTransition(dispatchDirective(queued));
    const completed = requireTransition(completeDirective(dispatched));

    expect(queueDirective(queued)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    expect(invalidateDirective(completed, "explicitly_cancelled")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    const invalidated = requireTransition(
      invalidateDirective(dispatched, "revision_changed"),
    );
    expect(invalidated).toMatchObject({
      status: "invalidated",
      invalidationReason: "revision_changed",
    });
    expect(dispatchDirective(invalidated)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it.each([
    ["epoch", (state: PedagogyState) => ({ ...state, epoch: state.epoch + 1 }), "stale_epoch"],
    [
      "exercise",
      (state: PedagogyState) => ({
        ...state,
        exerciseId:
          "other-exercise" as unknown as PedagogyState["exerciseId"],
      }),
      "exercise_changed",
    ],
    ["step", (state: PedagogyState) => ({ ...state, stepId: "other-step" }), "step_changed"],
    ["revision", (state: PedagogyState) => ({ ...state, revision: 2 }), "revision_changed"],
    ["snapshot", (state: PedagogyState) => ({ ...state, studentSnapshotHash: "other-hash" }), "snapshot_changed"],
    ["source", (state: PedagogyState) => ({ ...state, attemptState: { ...state.attemptState, lastActionId: "other-action" } }), "source_changed"],
    ["evidence", (state: PedagogyState) => ({ ...state, evidenceById: {} }), "evidence_changed"],
  ] as const)("rejects stale %s before item injection", (_, mutate, reason) => {
    const current = queuedState();
    expect(
      guardDirective(mutate(current.state), current.directive, "before_item"),
    ).toEqual({ ok: false, reason });
  });

  it("guards item then response once and refuses a busy floor", () => {
    const current = queuedState();
    expect(guardDirective(current.state, current.directive, "before_item")).toEqual({
      ok: true,
    });
    expect(
      guardDirective(
        {
          ...current.state,
          interaction: {
            ...current.state.interaction,
            studentIsDragging: true,
          },
        },
        current.directive,
        "before_item",
      ),
    ).toEqual({ ok: false, reason: "floor_busy" });

    const directive = requireTransition(dispatchDirective(current.directive));
    const state = pedagogyReducer(current.state, {
      type: "directive_dispatched",
      directiveId: directive.directiveId,
      ...anchor(current.state),
    });
    expect(guardDirective(state, directive, "before_response")).toEqual({
      ok: true,
    });
    expect(guardDirective(state, current.directive, "before_response")).toEqual({
      ok: false,
      reason: "state_mismatch",
    });
  });

  it("sends no response event when revision changes before response.create", () => {
    const current = queuedState();
    const directive = requireTransition(dispatchDirective(current.directive));
    const dispatched = pedagogyReducer(current.state, {
      type: "directive_dispatched",
      directiveId: directive.directiveId,
      ...anchor(current.state),
    });
    const stale = { ...dispatched, revision: dispatched.revision + 1 };
    const sendResponse = vi.fn();
    const guard = guardDirective(stale, directive, "before_response");
    if (guard.ok) sendResponse();

    expect(guard).toEqual({ ok: false, reason: "revision_changed" });
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("refuses missing evidence and creates a fresh ID after invalidation", () => {
    const state = committedState();
    expect(
      materializeDirective(
        { ...state, evidenceById: {} },
        DRAFT,
        () => "directive-missing",
      ),
    ).toBeNull();
    const original = requiredDirective(state);
    const invalidated = requireTransition(
      invalidateDirective(original, "explicitly_cancelled"),
    );
    const replacement = materializeDirective(
      state,
      DRAFT,
      () => "directive-2",
    );
    expect(invalidated.directiveId).toBe("directive-1");
    expect(replacement?.directiveId).toBe("directive-2");
  });

  it("keeps a complete directive/event/response/call correlation trace", () => {
    const ledger = correlatedLedger();
    expect(ledger.get("directive-1")).toEqual({
      directiveId: "directive-1",
      itemEventId: "event-item-1",
      itemId: "item-1",
      responseEventId: "event-response-1",
      responseId: "response-1",
      callIds: ["call-1"],
    });
    expect(ledger.bindCall("directive-1", "response-1", "call-1")).toBe(false);
    expect(ledger.bindResponse("directive-1", "event-2", "response-2")).toBe(
      false,
    );
  });

  it("rejects a late correlated tool call before the gateway handler", async () => {
    const current = activeResponseState();
    let liveState = current.state;
    const ledger = correlatedLedger();
    expect(ledger.bindCall("directive-1", "response-1", "call-late")).toBe(true);
    const handlers = toolHandlers();
    const gateway = new ToolGateway(handlers);
    const authorization = createDirectiveToolAuthorization(
      () => liveState,
      current.directive,
      ledger,
    );

    expect(
      (
        await gateway.execute(
          {
            callId: "call-1",
            name: "check_relation",
            arguments:
              '{"relation":"perpendicular","objects":["d","AB"],"revision":1}',
          },
          context(liveState, authorization),
        )
      ).ok,
    ).toBe(true);

    liveState = pedagogyReducer(
      liveState,
      actionEvent(liveState, ["verified", "verified"]),
    );
    const late = await gateway.execute(
      {
        callId: "call-late",
        name: "highlight_objects",
        arguments:
          '{"names":["A"],"style":"hint","ttlMs":500,"revision":2}',
      },
      context(liveState, authorization),
    );

    expect(late).toMatchObject({
      ok: false,
      error: { code: "rejected_stale" },
    });
    expect(handlers.highlight_objects).not.toHaveBeenCalled();
  });

  it("rejects unknown, uncorrelated, or disallowed tools at the tool gate", () => {
    const current = activeResponseState();
    const ledger = correlatedLedger();
    expect(
      guardDirective(current.state, current.directive, "before_tool", {
        toolName: "highlight_objects",
        callId: "unknown-call",
        correlation: ledger,
      }),
    ).toEqual({ ok: false, reason: "correlation_mismatch" });
    expect(
      guardDirective(
        current.state,
        { ...current.directive, allowedTools: ["check_relation"] },
        "before_tool",
        {
          toolName: "highlight_objects",
          callId: "call-1",
          correlation: ledger,
        },
      ),
    ).toEqual({ ok: false, reason: "tool_not_allowed" });
  });
});

function committedState(): PedagogyState {
  const initial = createInitialPedagogyState(PLAN, { epoch: 7 });
  return pedagogyReducer(initial, actionEvent(initial, ["verified", "missing"]));
}

function requiredDirective(state: PedagogyState): InterventionDirective {
  const directive = materializeDirective(state, DRAFT, () => "directive-1");
  if (!directive) throw new Error("Expected a valid directive.");
  return directive;
}

function queuedState(): {
  state: PedagogyState;
  directive: InterventionDirective;
} {
  const state = committedState();
  const directive = requireTransition(queueDirective(requiredDirective(state)));
  return {
    directive,
    state: pedagogyReducer(state, {
      type: "directive_queued",
      intervention: toPendingIntervention(directive),
      ...anchor(state),
    }),
  };
}

function activeResponseState(): {
  state: PedagogyState;
  directive: InterventionDirective;
} {
  const queued = queuedState();
  const directive = requireTransition(dispatchDirective(queued.directive));
  const dispatched = pedagogyReducer(queued.state, {
    type: "directive_dispatched",
    directiveId: directive.directiveId,
    ...anchor(queued.state),
  });
  return {
    directive,
    state: pedagogyReducer(dispatched, {
      type: "response_started",
      responseId: "response-1",
      directiveId: directive.directiveId,
      ...anchor(dispatched),
    }),
  };
}

function correlatedLedger(): DirectiveCorrelationLedger {
  const ledger = new DirectiveCorrelationLedger();
  expect(ledger.create("directive-1")).toBe(true);
  expect(ledger.bindItem("directive-1", "event-item-1", "item-1")).toBe(true);
  expect(
    ledger.bindResponse(
      "directive-1",
      "event-response-1",
      "response-1",
    ),
  ).toBe(true);
  expect(ledger.bindCall("directive-1", "response-1", "call-1")).toBe(true);
  return ledger;
}

function requireTransition(
  result: ReturnType<
    | typeof queueDirective
    | typeof dispatchDirective
    | typeof completeDirective
    | typeof invalidateDirective
  >,
): InterventionDirective {
  if (!result.ok) throw new Error(result.reason);
  return result.directive;
}

function anchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

function context(
  state: PedagogyState,
  directive: NonNullable<GatewayContext["directive"]>,
): GatewayContext {
  return {
    turnId: "turn-directive-1",
    phase: "constructing",
    revision: state.revision,
    directive,
  };
}

function toolHandlers(): ToolHandlers {
  return {
    read_construction: vi.fn(() => ({ data: {} })),
    initialize_exercise: vi.fn(() => ({ data: {} })),
    check_relation: vi.fn(() => ({ data: { pass: true } })),
    highlight_objects: vi.fn(() => ({ data: { highlighted: true } })),
  };
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

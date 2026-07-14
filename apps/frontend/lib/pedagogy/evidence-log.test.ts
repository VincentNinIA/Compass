import { describe, expect, it } from "vitest";

import { EvidenceLog, type EvidenceLogInput } from "./evidence-log";

describe("EvidenceLog", () => {
  it("exports only allowlisted redacted fields with one run and monotone sequence", () => {
    let now = 100;
    const log = new EvidenceLog({ runId: "run-c08", now: () => now++ });
    const tainted = {
      eventType: "action_committed",
      epoch: 3,
      revision: 8,
      actionId: "action-8",
      evidenceIds: ["evidence-perpendicular"],
      outcome: "accepted",
      reason: "meaningful",
      transcript: "student raw speech",
      audio: "base64-audio",
      sdp: "v=0 secret",
      apiKey: "sk-secret",
      image: "data:image/png;base64,secret",
    } as EvidenceLogInput;
    const first = log.append(tainted);
    const second = log.append({
      eventType: "policy_decision",
      epoch: 3,
      revision: 8,
      actionId: "action-8",
      decision: "SPEAK",
      evidenceIds: ["evidence-perpendicular"],
      outcome: "accepted",
      reason: "repeated_block",
    });

    expect(first).toMatchObject({ runId: "run-c08", sequence: 1, at: 100 });
    expect(second).toMatchObject({ runId: "run-c08", sequence: 2, at: 101 });
    const exported = log.export();
    expect(exported.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(new Set(exported.map(({ runId }) => runId))).toEqual(new Set(["run-c08"]));
    expect(JSON.stringify(exported)).not.toMatch(
      /transcript|student raw speech|base64-audio|v=0 secret|sk-secret|data:image/i,
    );
    expect(Object.isFrozen(exported)).toBe(true);
    expect(Object.isFrozen(exported[0])).toBe(true);
    expect(Object.isFrozen(exported[0]?.evidenceIds)).toBe(true);
  });

  it("keeps action to decision to directive to response to call to evidence correlated", () => {
    const log = new EvidenceLog({ runId: "run-chain", now: () => 500 });
    const common = {
      epoch: 4,
      revision: 9,
      actionId: "action-9",
      evidenceIds: ["evidence-9-perpendicular", "evidence-9-midpoint"],
      outcome: "accepted",
    } as const;
    log.append({ ...common, eventType: "action_committed", reason: "meaningful" });
    log.append({
      ...common,
      eventType: "policy_decision",
      decision: "SPEAK",
      reason: "repeated_block",
    });
    log.append({
      ...common,
      eventType: "directive_dispatched",
      decision: "SPEAK",
      directiveId: "directive-9",
      reason: "response_requested",
    });
    log.append({
      ...common,
      eventType: "response_started",
      decision: "SPEAK",
      directiveId: "directive-9",
      responseId: "response-9",
      reason: "owned_response",
    });
    log.append({
      ...common,
      eventType: "tool_call",
      directiveId: "directive-9",
      responseId: "response-9",
      callId: "call-9",
      reason: "guard_pending",
    });
    log.append({
      ...common,
      eventType: "evidence_committed",
      directiveId: "directive-9",
      responseId: "response-9",
      callId: "call-9",
      reason: "deterministic_validation",
    });

    const chain = log.export();
    expect(chain.map(({ eventType }) => eventType)).toEqual([
      "action_committed",
      "policy_decision",
      "directive_dispatched",
      "response_started",
      "tool_call",
      "evidence_committed",
    ]);
    expect(chain.every(({ actionId }) => actionId === "action-9")).toBe(true);
    expect(chain.slice(2).every(({ directiveId }) => directiveId === "directive-9")).toBe(true);
    expect(chain.slice(3).every(({ responseId }) => responseId === "response-9")).toBe(true);
    expect(chain.slice(4).every(({ callId }) => callId === "call-9")).toBe(true);
    expect(chain.every(({ evidenceIds }) => evidenceIds?.length === 2)).toBe(true);
  });

  it("rejects unsafe free text instead of turning the log into a payload sink", () => {
    const log = new EvidenceLog({ runId: "run-safe" });
    expect(
      log.append({
        eventType: "cancellation",
        epoch: 0,
        revision: 0,
        outcome: "cancelled",
        reason: "student said their full name",
      }),
    ).toBeNull();
    expect(log.export()).toEqual([]);
  });
});

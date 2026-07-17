import { describe, expect, it } from "vitest";

import {
  EVIDENCE_LOG_VERSION,
  EvidenceLog,
  type EvidenceLogInput,
} from "./evidence-log";

describe("EvidenceLog", () => {
  it("exports the exact closed schema and redacts forbidden payload fields", () => {
    const log = new EvidenceLog({ runId: "run-c04", now: () => 100 });
    const tainted = {
      revision: 8,
      actionId: "action-8",
      kind: "action",
      correlationIds: {
        evidenceIds: ["evidence-perpendicular"],
        transcript: "student raw speech",
        apiKey: "sk-inside-correlation",
      },
      status: "accepted",
      transcript: "student raw speech",
      audio: "base64-audio",
      sdp: "v=0 secret",
      apiKey: "sk-secret",
      image: "data:image/png;base64,secret",
      toolPayload: '{"revision":8,"student":"Alice"}',
    } as EvidenceLogInput;

    expect(log.append(tainted)).toEqual({
      timestamp: 100,
      runId: "run-c04",
      actionId: "action-8",
      revision: 8,
      kind: "action",
      correlationIds: { evidenceIds: ["evidence-perpendicular"] },
      status: "accepted",
      durationMs: 0,
    });
    const exported = log.exportDebug();
    expect(exported).toMatchObject({
      version: EVIDENCE_LOG_VERSION,
      runId: "run-c04",
      dropped: 0,
    });
    expect(Object.keys(exported.entries[0] ?? {}).sort()).toEqual([
      "actionId",
      "correlationIds",
      "durationMs",
      "kind",
      "revision",
      "runId",
      "status",
      "timestamp",
    ]);
    expect(JSON.stringify(exported)).not.toMatch(
      /transcript|student raw speech|base64-audio|v=0 secret|sk-|data:image|toolPayload|Alice/i,
    );
    expect(Object.isFrozen(exported)).toBe(true);
    expect(Object.isFrozen(exported.entries)).toBe(true);
    expect(Object.isFrozen(exported.entries[0]?.correlationIds)).toBe(true);
    expect(
      Object.isFrozen(exported.entries[0]?.correlationIds.evidenceIds),
    ).toBe(true);
  });

  it("correlates action, decision, response, tool and evidence with measured spans", () => {
    const clock = [10, 11, 12, 20, 23, 29, 30];
    const log = new EvidenceLog({
      runId: "run-chain",
      now: () => clock.shift() ?? 30,
    });
    const evidenceIds = ["evidence-perpendicular", "evidence-midpoint"];
    log.append({
      revision: 9,
      actionId: "action-9",
      kind: "action",
      correlationIds: { evidenceIds },
      status: "accepted",
    });
    log.append({
      revision: 9,
      actionId: "action-9",
      kind: "decision_speak",
      correlationIds: { evidenceIds },
      status: "accepted",
    });
    log.append({
      revision: 9,
      actionId: "action-9",
      kind: "response",
      correlationIds: {
        directiveId: "directive-9",
        responseId: "response-9",
        evidenceIds,
      },
      status: "started",
    });
    log.append({
      revision: 9,
      actionId: "action-9",
      kind: "tool",
      correlationIds: {
        directiveId: "directive-9",
        responseId: "response-9",
        callId: "call-9",
        evidenceIds,
      },
      status: "started",
    });
    log.append({
      revision: 9,
      actionId: "action-9",
      kind: "tool",
      correlationIds: {
        directiveId: "directive-9",
        responseId: "response-9",
        callId: "call-9",
        evidenceIds,
      },
      status: "completed",
    });
    log.append({
      revision: 9,
      actionId: "action-9",
      kind: "response",
      correlationIds: {
        directiveId: "directive-9",
        responseId: "response-9",
        evidenceIds,
      },
      status: "completed",
    });
    log.append({
      revision: 9,
      actionId: "action-9",
      kind: "evidence",
      correlationIds: {
        directiveId: "directive-9",
        responseId: "response-9",
        callId: "call-9",
        evidenceIds,
      },
      status: "completed",
    });

    const chain = log.export();
    expect(chain.map(({ kind }) => kind)).toEqual([
      "action",
      "decision_speak",
      "response",
      "tool",
      "tool",
      "response",
      "evidence",
    ]);
    expect(chain.every(({ runId }) => runId === "run-chain")).toBe(true);
    expect(chain.every(({ actionId }) => actionId === "action-9")).toBe(true);
    expect(chain[4]?.durationMs).toBe(3);
    expect(chain[5]?.durationMs).toBe(17);
    expect(chain.at(-1)?.correlationIds).toEqual({
      directiveId: "directive-9",
      responseId: "response-9",
      callId: "call-9",
      evidenceIds,
    });
  });

  it("bounds the ring buffer and reports every dropped event", () => {
    let now = 1;
    const log = new EvidenceLog({
      runId: "run-ring",
      capacity: 2,
      now: () => now++,
    });
    for (const revision of [1, 2, 3]) {
      log.append({
        revision,
        kind: "action",
        status: "accepted",
      });
    }

    expect(log.exportDebug()).toMatchObject({
      runId: "run-ring",
      dropped: 1,
      entries: [
        expect.objectContaining({ revision: 2 }),
        expect.objectContaining({ revision: 3 }),
      ],
    });
  });

  it("projects all four operation boundaries without payload or free reason", () => {
    const log = new EvidenceLog({ runId: "run-boundaries", now: () => 4 });
    for (const boundary of [
      "geogebra_mutation",
      "ui_commit",
      "realtime_emit",
      "tool_publish",
    ] as const) {
      log.appendOperationTrace({
        tokenId: `operation-${boundary}`,
        revision: 5,
        event: "committed",
        boundary,
      });
    }
    expect(
      log.export().map(({ kind, correlationIds, status }) => ({
        kind,
        correlationIds,
        status,
      })),
    ).toEqual([
      "geogebra_mutation",
      "ui_commit",
      "realtime_emit",
      "tool_publish",
    ].map((kind) => ({
      kind,
      correlationIds: { operationId: `operation-${kind}` },
      status: "completed",
    })));
    expect(
      log.appendOperationTrace({
        tokenId: "operation-no-boundary",
        revision: 5,
        event: "started",
      }),
    ).toBeNull();
  });

  it("rejects invalid required fields, redacts overlong optional IDs and rotates on clear", () => {
    const runIds = ["after-reset"];
    const log = new EvidenceLog({
      runId: "run-safe",
      createRunId: () => runIds.shift() ?? "later",
    });
    expect(
      log.append({
        revision: -1,
        kind: "action",
        status: "accepted",
      }),
    ).toBeNull();
    expect(
      log.append({
        revision: 1,
        actionId: "x".repeat(300),
        kind: "evidence",
        correlationIds: {
          responseId: "y".repeat(300),
          evidenceIds: ["valid-evidence", "z".repeat(300)],
        },
        status: "completed",
      }),
    ).toMatchObject({
      correlationIds: { evidenceIds: ["valid-evidence"] },
    });

    log.clear();
    expect(log.exportDebug()).toEqual({
      version: EVIDENCE_LOG_VERSION,
      runId: "run-after-reset",
      dropped: 0,
      entries: [],
    });
  });
});

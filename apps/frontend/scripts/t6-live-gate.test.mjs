import { describe, expect, it } from "vitest";

import {
  REQUIRED_STEP_IDS,
  RUN_EVIDENCE_KEYS,
  computeCandidateIdentity,
  nextConsecutiveCount,
  qualificationIdentityStable,
  validateEvidenceFileList,
  validateRunManifest,
} from "./t6-live-gate.mjs";

function completeManifest(overrides = {}) {
  return {
    version: "geotutor_live_run.v1",
    seriesId: "series-test",
    runIndex: 1,
    candidate: { id: "candidate-test" },
    environment: { id: "environment-test" },
    startedAt: "2026-07-15T00:00:00.000Z",
    completedAt: "2026-07-15T00:00:01.000Z",
    steps: REQUIRED_STEP_IDS.map((id) => ({
      id,
      status: "pass",
      startedAt: "2026-07-15T00:00:00.000Z",
      durationMs: 10,
      evidence: Object.fromEntries(
        RUN_EVIDENCE_KEYS[id].map((key) => [key, true]),
      ),
    })),
    evidence: {
      geogebra: "real_applet_5.4.920.0",
      exerciseService: "live_openai_responses",
      realtimeService: "live_openai_realtime",
      scriptedLocal: false,
    },
    artifacts: ["run.png", "video.webm"],
    result: "pass",
    ...overrides,
  };
}

const expected = {
  runIndex: 1,
  seriesId: "series-test",
  candidateId: "candidate-test",
  environmentId: "environment-test",
};

describe("T6-C07 live gate manifest", () => {
  it("accepts only a complete live manifest with all artifacts", () => {
    expect(validateRunManifest(completeManifest(), expected)).toEqual({
      ok: true,
      reason: "complete",
    });
  });

  it("resets the counter for failure, missing proof, or identity drift", () => {
    const valid = validateRunManifest(completeManifest(), expected);
    const incomplete = completeManifest({
      steps: REQUIRED_STEP_IDS.slice(0, -1).map((id) => ({
        id,
        status: "pass",
        startedAt: "2026-07-15T00:00:00.000Z",
        durationMs: 10,
        evidence: Object.fromEntries(
          RUN_EVIDENCE_KEYS[id].map((key) => [key, true]),
        ),
      })),
    });
    const invalid = validateRunManifest(incomplete, expected);

    expect(nextConsecutiveCount(0, valid, true)).toBe(1);
    expect(nextConsecutiveCount(2, invalid, true)).toBe(0);
    expect(nextConsecutiveCount(2, valid, false)).toBe(0);
  });

  it("rejects secrets and raw payload-shaped evidence", () => {
    const sensitive = completeManifest({
      steps: REQUIRED_STEP_IDS.map((id, index) => ({
        id,
        status: "pass",
        startedAt: "2026-07-15T00:00:00.000Z",
        durationMs: 10,
        evidence: Object.fromEntries(
          RUN_EVIDENCE_KEYS[id].map((key) => [
            key,
            index === 0 && key === "extractionOutcome"
              ? "OPENAI_API_KEY"
              : true,
          ]),
        ),
      })),
    });
    expect(validateRunManifest(sensitive, expected)).toEqual({
      ok: false,
      reason: "sensitive_evidence",
    });
  });

  it("computes a stable exact source identity", async () => {
    const first = await computeCandidateIdentity();
    const second = await computeCandidateIdentity();
    expect(first).toEqual(second);
    expect(first.head).toMatch(/^[a-f0-9]{40}$/);
    expect(first.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sourceFileCount).toBeGreaterThan(100);
  });

  it("resets qualification when either the candidate or environment drifts", () => {
    const expectedIdentity = {
      candidateId: "candidate-a",
      environmentId: "environment-a",
    };
    expect(
      qualificationIdentityStable(
        expectedIdentity,
        { id: "candidate-a" },
        { id: "environment-a" },
      ),
    ).toBe(true);
    expect(
      qualificationIdentityStable(
        expectedIdentity,
        { id: "candidate-a" },
        { id: "environment-b" },
      ),
    ).toBe(false);
  });

  it("accepts only the closed 12-file evidence inventory", () => {
    const files = [
      "gate-verdict.json",
      "preflight.json",
      "run-1.json",
      "run-2.json",
      "run-3.json",
      "series-state.json",
      "T6-C07-run-1-completed.png",
      "T6-C07-run-2-completed.png",
      "T6-C07-run-3-completed.png",
      "playwright-run-1/test/video.webm",
      "playwright-run-2/test/video.webm",
      "playwright-run-3/test/video.webm",
    ];
    expect(validateEvidenceFileList(files)).toEqual({
      ok: true,
      reason: "complete",
    });
    expect(
      validateEvidenceFileList([
        ...files,
        "playwright-run-1/.last-run.json",
      ]),
    ).toEqual({ ok: false, reason: "unexpected_artifact" });
  });

  it("rejects a step with a missing or extra schema field", () => {
    const missingDuration = completeManifest();
    delete missingDuration.steps[0].durationMs;
    expect(validateRunManifest(missingDuration, expected)).toEqual({
      ok: false,
      reason: "step_evidence_incomplete",
    });

    const extraField = completeManifest();
    extraField.steps[0].rawPayload = "not allowed";
    expect(validateRunManifest(extraField, expected)).toEqual({
      ok: false,
      reason: "step_evidence_incomplete",
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import type { BisectorValidation } from "@/types/geogebra";
import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_PARAMETER_VERSION,
  INVARIANCE_POSITION_VERSION,
  INVARIANCE_SAMPLE_PARAMETERS,
  RUN_INVARIANCE_TEST_OPERATION,
  type InvarianceRunEvent,
  type InvarianceSceneRequest,
  type InvarianceSampleEvidence,
  type InvarianceSampleRequest,
  type InvarianceTemporaryScene,
  type RunInvarianceTestDependencies,
  type RunInvarianceTestInput,
} from "./contracts";
import { RunInvarianceTestOperation } from "./run-invariance-test";

const REVISION = 7;
const CANDIDATE = "studentLine";
const INPUT_EVIDENCE_IDS = Object.freeze([
  "evidence-r7-perpendicular",
  "evidence-r7-passes_midpoint",
] as const);

const INPUT: RunInvarianceTestInput = Object.freeze({
  candidateLine: CANDIDATE,
  revision: REVISION,
  evidenceIds: INPUT_EVIDENCE_IDS,
});

const TEST_SCENE: InvarianceTemporaryScene = Object.freeze({
  namespace: "gtInv_inv_run_t5_c01_",
  helperName: (suffix: string) => `gtInv_inv_run_t5_c01_${suffix}`,
  createHelper: (suffix: string) => `gtInv_inv_run_t5_c01_${suffix}`,
});

function validation(
  overrides: Partial<BisectorValidation> = {},
): BisectorValidation {
  return {
    candidate: CANDIDATE,
    revision: REVISION,
    score: 2,
    evidence: [
      {
        id: INPUT_EVIDENCE_IDS[0],
        relation: "perpendicular",
        pass: true,
        observed: 1,
        tolerance: 0,
        revision: REVISION,
        objects: [CANDIDATE, "AB"],
      },
      {
        id: INPUT_EVIDENCE_IDS[1],
        relation: "passes_midpoint",
        pass: true,
        observed: 0,
        tolerance: 1e-6,
        revision: REVISION,
        objects: [CANDIDATE, "A", "B"],
      },
    ],
    ...overrides,
  };
}

function sample(
  request: InvarianceSampleRequest,
  overrides: Partial<InvarianceSampleEvidence> = {},
): InvarianceSampleEvidence {
  return {
    id: `inv-evidence-${request.index}`,
    index: request.index,
    parameter: request.parameter,
    coords: [0, request.parameter * 4],
    pa: 5 + request.index,
    pb: 5 + request.index,
    delta: 0,
    tolerance: INVARIANCE_DISTANCE_TOLERANCE,
    toleranceVersion: INVARIANCE_DISTANCE_TOLERANCE_VERSION,
    positionVersion: INVARIANCE_POSITION_VERSION,
    pass: true,
    revision: request.revision,
    ...overrides,
  };
}

function harness(options: {
  getCurrentValidation?: () => BisectorValidation | null;
  sample?: (
    request: InvarianceSampleRequest,
  ) => Promise<InvarianceSampleEvidence> | InvarianceSampleEvidence;
  observe?: (event: InvarianceRunEvent) => void;
  enterScene?: (request: InvarianceSceneRequest) => void;
} = {}) {
  const events: InvarianceRunEvent[] = [];
  const sampleRunner = vi.fn(options.sample ?? sample);
  const getCurrentValidation = vi.fn(
    options.getCurrentValidation ?? (() => validation()),
  );
  const runInTemporaryScene: RunInvarianceTestDependencies["runInTemporaryScene"] =
    async (request, execute) => {
      options.enterScene?.(request);
      return execute(TEST_SCENE);
    };
  const operation = new RunInvarianceTestOperation({
    getCurrentValidation,
    runInTemporaryScene,
    sample: sampleRunner,
    createRunId: () => "inv-run-t5-c01",
    observe: options.observe ?? ((event) => events.push(event)),
  });
  return { operation, events, sampleRunner, getCurrentValidation };
}

describe("T5-C01 run_invariance_test contract", () => {
  it("fixes the closed operation name and five versioned line parameters", () => {
    expect(RUN_INVARIANCE_TEST_OPERATION).toBe("run_invariance_test");
    expect(INVARIANCE_PARAMETER_VERSION).toBe("normalized-line-v1");
    expect(INVARIANCE_SAMPLE_PARAMETERS).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(Object.isFrozen(INVARIANCE_SAMPLE_PARAMETERS)).toBe(true);
  });

  it("runs exactly five ordered samples under the same current 2/2 authority", async () => {
    const sceneRequests: InvarianceSceneRequest[] = [];
    const test = harness({
      enterScene: (request) => sceneRequests.push(request),
      sample: (request) => {
        expect(request.isAuthorityCurrent()).toBe(true);
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.inputEvidenceIds)).toBe(true);
        expect(request.scene).toBe(TEST_SCENE);
        return sample(request);
      },
    });

    const handle = test.operation.start(INPUT);
    await expect(handle.result).resolves.toMatchObject({
      status: "completed",
      runId: "inv-run-t5-c01",
      revision: REVISION,
      inputEvidenceIds: INPUT_EVIDENCE_IDS,
      pass: true,
      evidenceIds: [
        "inv-evidence-0",
        "inv-evidence-1",
        "inv-evidence-2",
        "inv-evidence-3",
        "inv-evidence-4",
      ],
    });
    const result = await handle.result;
    expect(result.samples).toHaveLength(5);
    expect(test.sampleRunner).toHaveBeenCalledTimes(5);
    expect(sceneRequests).toHaveLength(1);
    expect(sceneRequests[0]).toMatchObject({
      runId: "inv-run-t5-c01",
      candidateLine: CANDIDATE,
      revision: REVISION,
      inputEvidenceIds: INPUT_EVIDENCE_IDS,
    });
    expect(Object.isFrozen(sceneRequests[0])).toBe(true);
    expect(
      test.sampleRunner.mock.calls.map(([request]) => ({
        index: request.index,
        parameter: request.parameter,
        revision: request.revision,
        evidenceIds: request.inputEvidenceIds,
      })),
    ).toEqual(
      INVARIANCE_SAMPLE_PARAMETERS.map((parameter, index) => ({
        index,
        parameter,
        revision: REVISION,
        evidenceIds: INPUT_EVIDENCE_IDS,
      })),
    );
    expect(test.events.map(({ type }) => type)).toEqual([
      "started",
      "sample_completed",
      "sample_completed",
      "sample_completed",
      "sample_completed",
      "sample_completed",
      "completed",
    ]);
    expect(test.events.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.samples)).toBe(true);
    expect(Object.isFrozen(result.evidenceIds)).toBe(true);
    expect(result.samples.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(
      result.samples.every((entry) => Object.isFrozen(entry.coords)),
    ).toBe(true);
  });

  it("completes five samples but aggregates pass=false when one sample fails", async () => {
    const test = harness({
      sample: (request) =>
        sample(
          request,
          request.index === 3
            ? { pa: 0, pb: 0.1, pass: false, delta: 0.1 }
            : {},
        ),
    });

    const result = await test.operation.start(INPUT).result;

    expect(result).toMatchObject({ status: "completed", pass: false });
    expect(result.samples).toHaveLength(5);
    expect(test.sampleRunner).toHaveBeenCalledTimes(5);
    expect(test.events.at(-1)).toMatchObject({
      type: "completed",
      pass: false,
    });
  });

  it.each([
    ["score", validation({ score: 1 })],
    ["candidate", validation({ candidate: "otherLine" })],
    ["revision", validation({ revision: REVISION + 1 })],
    [
      "forged score",
      validation({
        score: 2,
        evidence: [
          { ...validation().evidence[0], pass: false },
          validation().evidence[1],
        ],
      }),
    ],
    [
      "relation tuple",
      validation({
        evidence: [
          { ...validation().evidence[0], objects: [CANDIDATE, "A"] },
          validation().evidence[1],
        ],
      }),
    ],
    [
      "evidence",
      validation({
        evidence: [
          validation().evidence[0],
          { ...validation().evidence[1], id: "different-evidence" },
        ],
      }),
    ],
  ])("rejects a non-current 2/2 %s precondition before sampling", async (_, current) => {
    const test = harness({ getCurrentValidation: () => current });

    await expect(test.operation.start(INPUT).result).resolves.toEqual({
      status: "failed",
      runId: "inv-run-t5-c01",
      revision: REVISION,
      inputEvidenceIds: INPUT_EVIDENCE_IDS,
      samples: [],
      pass: false,
      evidenceIds: [],
      error: { code: "precondition_not_met" },
    });
    expect(test.sampleRunner).not.toHaveBeenCalled();
    expect(test.events).toEqual([
      {
        type: "rejected",
        runId: "inv-run-t5-c01",
        revision: REVISION,
        code: "precondition_not_met",
      },
    ]);
  });

  it.each([
    { ...INPUT, candidateLine: "invalid line" },
    { ...INPUT, revision: -1 },
    { ...INPUT, evidenceIds: [INPUT_EVIDENCE_IDS[0], INPUT_EVIDENCE_IDS[0]] },
    { ...INPUT, evidenceIds: [INPUT_EVIDENCE_IDS[0]] },
  ])("rejects malformed closed input without sampling", async (invalidInput) => {
    const test = harness();

    const result = await test.operation.start(
      invalidInput as RunInvarianceTestInput,
    ).result;

    expect(result).toMatchObject({
      status: "failed",
      pass: false,
      samples: [],
      evidenceIds: [],
      error: { code: "invalid_input" },
    });
    expect(test.getCurrentValidation).not.toHaveBeenCalled();
    expect(test.sampleRunner).not.toHaveBeenCalled();
    expect(test.events).toHaveLength(1);
    expect(test.events[0]).toMatchObject({ type: "rejected", code: "invalid_input" });
  });

  it("fails all-or-nothing when revision authority becomes stale mid-run", async () => {
    let current = validation();
    const test = harness({
      getCurrentValidation: () => current,
      sample: (request) => {
        if (request.index === 1) {
          current = validation({ revision: REVISION + 1 });
        }
        return sample(request);
      },
    });

    const result = await test.operation.start(INPUT).result;

    expect(result).toMatchObject({
      status: "failed",
      pass: false,
      samples: [],
      evidenceIds: [],
      error: { code: "stale_authority" },
    });
    expect(test.sampleRunner).toHaveBeenCalledTimes(2);
    expect(test.events.map(({ type }) => type)).toEqual([
      "started",
      "sample_completed",
      "failed",
    ]);
  });

  it.each([
    ["non-finite", { pa: Number.NaN }],
    ["wrong index", { index: 4 }],
    ["wrong revision", { revision: REVISION + 1 }],
    ["forged delta", { pa: 2, pb: 3, delta: 0 }],
    ["forged pass", { pa: 0, pb: 0.1, delta: 0.1, pass: true }],
    ["wrong tolerance", { tolerance: 0.1 }],
    ["wrong tolerance version", { toleranceVersion: "unversioned" }],
    ["wrong position version", { positionVersion: "unversioned" }],
  ] as const)("fails all-or-nothing for an invalid %s sample", async (_, override) => {
    const test = harness({
      sample: (request) =>
        sample(
          request,
          request.index === 2
            ? (override as Partial<InvarianceSampleEvidence>)
            : {},
        ),
    });

    const result = await test.operation.start(INPUT).result;

    expect(result).toMatchObject({
      status: "failed",
      samples: [],
      pass: false,
      evidenceIds: [],
      error: { code: "invalid_sample" },
    });
    expect(test.sampleRunner).toHaveBeenCalledTimes(3);
  });

  it("rejects duplicate sample evidence IDs and never exposes the partial array", async () => {
    const test = harness({
      sample: (request) =>
        sample(request, request.index === 1 ? { id: "inv-evidence-0" } : {}),
    });

    const result = await test.operation.start(INPUT).result;

    expect(result).toMatchObject({
      status: "failed",
      samples: [],
      pass: false,
      evidenceIds: [],
      error: { code: "invalid_sample" },
    });
    expect(test.sampleRunner).toHaveBeenCalledTimes(2);
  });

  it("converts a sample exception to a safe all-or-nothing failure", async () => {
    const test = harness({
      sample: (request) => {
        if (request.index === 2) throw new Error("raw GeoGebra payload");
        return sample(request);
      },
    });

    const result = await test.operation.start(INPUT).result;

    expect(result).toMatchObject({
      status: "failed",
      samples: [],
      pass: false,
      evidenceIds: [],
      error: { code: "sample_execution_failed" },
    });
    expect(JSON.stringify(result)).not.toContain("GeoGebra");
    expect(test.sampleRunner).toHaveBeenCalledTimes(3);
  });

  it("cancels an active run idempotently and propagates the abort signal", async () => {
    let activeRequest: InvarianceSampleRequest | undefined;
    let resolveSample: ((value: InvarianceSampleEvidence) => void) | undefined;
    const test = harness({
      sample: (request) => {
        activeRequest = request;
        return new Promise<InvarianceSampleEvidence>((resolve) => {
          resolveSample = resolve;
        });
      },
    });
    const handle = test.operation.start(INPUT);
    await vi.waitFor(() => expect(activeRequest).toBeDefined());

    expect(handle.cancel("student_drag")).toBe(true);
    expect(handle.cancel("student_drag")).toBe(false);
    expect(activeRequest?.signal.aborted).toBe(true);
    resolveSample?.(sample(activeRequest!));

    await expect(handle.result).resolves.toEqual({
      status: "cancelled",
      runId: "inv-run-t5-c01",
      revision: REVISION,
      inputEvidenceIds: INPUT_EVIDENCE_IDS,
      samples: [],
      pass: false,
      evidenceIds: [],
      reason: "student_drag",
    });
    expect(test.sampleRunner).toHaveBeenCalledTimes(1);
    expect(test.events.at(-1)).toMatchObject({
      type: "cancelled",
      reason: "student_drag",
    });
    expect(handle.cancel()).toBe(false);
  });

  it("honors an already-aborted caller signal before any precondition read", async () => {
    const controller = new AbortController();
    controller.abort();
    const test = harness();

    const result = await test.operation.start(INPUT, {
      signal: controller.signal,
    }).result;

    expect(result).toMatchObject({
      status: "cancelled",
      samples: [],
      pass: false,
      evidenceIds: [],
      reason: "application_stop",
    });
    expect(test.getCurrentValidation).not.toHaveBeenCalled();
    expect(test.sampleRunner).not.toHaveBeenCalled();
  });

  it("isolates observer failures from the composite result", async () => {
    const test = harness({
      observe: () => {
        throw new Error("observer unavailable");
      },
    });

    await expect(test.operation.start(INPUT).result).resolves.toMatchObject({
      status: "completed",
      samples: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }],
      pass: true,
    });
    expect(test.sampleRunner).toHaveBeenCalledTimes(5);
  });
});

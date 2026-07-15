import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_PARAMETER_VERSION,
  INVARIANCE_POSITION_VERSION,
  INVARIANCE_SAMPLE_PARAMETERS,
  type InvarianceCancellationReason,
  type InvarianceInputEvidenceIds,
  type InvarianceRunCompleted,
  type InvarianceRunErrorCode,
  type InvarianceRunEvent,
  type InvarianceRunFailed,
  type InvarianceRunHandle,
  type InvarianceRunResult,
  type InvarianceSampleEvidence,
  type InvarianceSampleEvidenceIds,
  type InvarianceSampleIndex,
  type InvarianceSampleParameter,
  type InvarianceSamples,
  type InvarianceTemporaryScene,
  type RunInvarianceTestDependencies,
  type RunInvarianceTestInput,
  type RunInvarianceTestOptions,
} from "./contracts";

const OBJECT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMPTY_RESULT_ARRAY = Object.freeze([]) as readonly [];

type NormalizedInput = Readonly<{
  candidateLine: string;
  revision: number;
  evidenceIds: readonly string[];
}>;

export class RunInvarianceTestOperation {
  constructor(private readonly dependencies: RunInvarianceTestDependencies) {}

  start(
    input: RunInvarianceTestInput,
    options: RunInvarianceTestOptions = {},
  ): InvarianceRunHandle {
    const runId = this.createRunId();
    const normalized = normalizeInput(input);
    const controller = new AbortController();
    let cancellationReason: InvarianceCancellationReason = "application_stop";
    let settled = false;
    const forwardAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", forwardAbort, { once: true });

    const result = this.execute(
      runId,
      normalized,
      controller.signal,
      () => cancellationReason,
    ).finally(() => {
      settled = true;
      options.signal?.removeEventListener("abort", forwardAbort);
    });

    return Object.freeze({
      runId,
      result,
      cancel: (reason: InvarianceCancellationReason = "application_stop") => {
        if (settled || controller.signal.aborted) return false;
        cancellationReason = reason;
        controller.abort();
        return true;
      },
    });
  }

  private async execute(
    runId: string,
    input: NormalizedInput,
    signal: AbortSignal,
    getCancellationReason: () => InvarianceCancellationReason,
  ): Promise<InvarianceRunResult> {
    if (!validInput(input)) {
      this.emit(
        Object.freeze({
          type: "rejected",
          runId,
          revision: safeRevision(input.revision),
          code: "invalid_input",
        }),
      );
      return failed(runId, input, "invalid_input");
    }
    if (signal.aborted) {
      return this.cancelled(runId, input, getCancellationReason());
    }
    if (!this.hasAuthority(input)) {
      this.emit(
        Object.freeze({
          type: "rejected",
          runId,
          revision: input.revision,
          code: "precondition_not_met",
        }),
      );
      return failed(runId, input, "precondition_not_met");
    }

    const inputEvidenceIds = tuple2(input.evidenceIds);
    this.emit(
      Object.freeze({
        type: "started",
        runId,
        candidateLine: input.candidateLine,
        revision: input.revision,
        inputEvidenceIds,
        parameterVersion: INVARIANCE_PARAMETER_VERSION,
        sampleParameters: INVARIANCE_SAMPLE_PARAMETERS,
      }),
    );

    const samples: InvarianceSampleEvidence[] = [];
    const usedEvidenceIds = new Set<string>();
    let interrupted: InvarianceRunResult | undefined;
    try {
      await this.dependencies.runInTemporaryScene(
        Object.freeze({
          runId,
          candidateLine: input.candidateLine,
          revision: input.revision,
          inputEvidenceIds,
          signal,
          isAuthorityCurrent: () =>
            !signal.aborted && this.hasAuthority(input),
        }),
        async (scene) => {
          interrupted = await this.collectSamples(
            runId,
            input,
            inputEvidenceIds,
            signal,
            scene,
            samples,
            usedEvidenceIds,
          );
        },
      );
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return this.cancelled(runId, input, getCancellationReason());
      }
      return this.failure(runId, input, "sample_execution_failed");
    }

    if (interrupted) return interrupted;

    if (samples.length !== INVARIANCE_SAMPLE_PARAMETERS.length) {
      return this.failure(runId, input, "invalid_sample");
    }
    const completedSamples = Object.freeze([...samples]) as InvarianceSamples;
    const evidenceIds = Object.freeze(
      completedSamples.map(({ id }) => id),
    ) as InvarianceSampleEvidenceIds;
    const result: InvarianceRunCompleted = Object.freeze({
      status: "completed",
      runId,
      revision: input.revision,
      inputEvidenceIds,
      samples: completedSamples,
      pass: completedSamples.every(({ pass }) => pass),
      evidenceIds,
    });
    this.emit(
      Object.freeze({
        type: "completed",
        runId,
        revision: input.revision,
        pass: result.pass,
        evidenceIds,
      }),
    );
    return result;
  }

  private async collectSamples(
    runId: string,
    input: NormalizedInput,
    inputEvidenceIds: InvarianceInputEvidenceIds,
    signal: AbortSignal,
    scene: InvarianceTemporaryScene,
    samples: InvarianceSampleEvidence[],
    usedEvidenceIds: Set<string>,
  ): Promise<InvarianceRunResult | undefined> {
    for (const [index, parameter] of INVARIANCE_SAMPLE_PARAMETERS.entries()) {
      if (signal.aborted) {
        throw cancellationError();
      }
      if (!this.hasAuthority(input)) {
        return this.failure(runId, input, "stale_authority");
      }
      const sample = await this.dependencies.sample(
        Object.freeze({
          runId,
          candidateLine: input.candidateLine,
          revision: input.revision,
          inputEvidenceIds,
          index: index as InvarianceSampleIndex,
          parameter,
          scene,
          signal,
          isAuthorityCurrent: () =>
            !signal.aborted && this.hasAuthority(input),
        }),
      );
      if (signal.aborted) {
        throw cancellationError();
      }
      if (!this.hasAuthority(input)) {
        return this.failure(runId, input, "stale_authority");
      }
      if (
        !validSample(
          sample,
          index as InvarianceSampleIndex,
          parameter,
          input.revision,
        ) || usedEvidenceIds.has(sample.id)
      ) {
        return this.failure(runId, input, "invalid_sample");
      }
      const immutableSample = freezeSample(sample);
      usedEvidenceIds.add(immutableSample.id);
      samples.push(immutableSample);
      this.emit(
        Object.freeze({
          type: "sample_completed",
          runId,
          revision: input.revision,
          index: immutableSample.index,
          parameter: immutableSample.parameter,
          evidenceId: immutableSample.id,
          pass: immutableSample.pass,
        }),
      );
    }
    return undefined;
  }

  private hasAuthority(input: NormalizedInput): boolean {
    const current = this.dependencies.getCurrentValidation();
    const perpendicular = current?.evidence[0];
    const passesMidpoint = current?.evidence[1];
    if (
      !current ||
      current.score !== 2 ||
      current.candidate !== input.candidateLine ||
      current.revision !== input.revision ||
      current.evidence.length !== 2 ||
      current.evidence.some(
        (entry) => !entry.pass || entry.revision !== input.revision,
      ) ||
      perpendicular?.relation !== "perpendicular" ||
      !sameTuple(perpendicular.objects, [input.candidateLine, "AB"]) ||
      passesMidpoint?.relation !== "passes_midpoint" ||
      !sameTuple(passesMidpoint.objects, [input.candidateLine, "A", "B"])
    ) {
      return false;
    }
    return current.evidence.every(
      ({ id }, index) => id === input.evidenceIds[index],
    );
  }

  private failure(
    runId: string,
    input: NormalizedInput,
    code: Exclude<
      InvarianceRunErrorCode,
      "invalid_input" | "precondition_not_met"
    >,
  ): InvarianceRunFailed {
    this.emit(
      Object.freeze({
        type: "failed",
        runId,
        revision: input.revision,
        code,
      }),
    );
    return failed(runId, input, code);
  }

  private cancelled(
    runId: string,
    input: NormalizedInput,
    reason: InvarianceCancellationReason,
  ): InvarianceRunResult {
    this.emit(
      Object.freeze({
        type: "cancelled",
        runId,
        revision: safeRevision(input.revision),
        reason,
      }),
    );
    return Object.freeze({
      status: "cancelled",
      runId,
      revision: safeRevision(input.revision),
      inputEvidenceIds: Object.freeze([...input.evidenceIds]),
      samples: EMPTY_RESULT_ARRAY,
      pass: false,
      evidenceIds: EMPTY_RESULT_ARRAY,
      reason,
    });
  }

  private emit(event: InvarianceRunEvent): void {
    try {
      this.dependencies.observe?.(event);
    } catch {
      // Observability cannot acquire execution authority over the operation.
    }
  }

  private createRunId(): string {
    const supplied = this.dependencies.createRunId?.();
    if (supplied && SAFE_RUN_ID.test(supplied)) return supplied;
    try {
      return `inv-${globalThis.crypto.randomUUID()}`;
    } catch {
      return `inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }
}

function normalizeInput(input: RunInvarianceTestInput): NormalizedInput {
  const candidateLine =
    input && typeof input.candidateLine === "string" ? input.candidateLine : "";
  const revision = input && typeof input.revision === "number" ? input.revision : -1;
  const evidenceIds = Array.isArray(input?.evidenceIds)
    ? Object.freeze([...input.evidenceIds])
    : Object.freeze([]);
  return Object.freeze({ candidateLine, revision, evidenceIds });
}

function validInput(input: NormalizedInput): boolean {
  return (
    OBJECT_NAME.test(input.candidateLine) &&
    Number.isSafeInteger(input.revision) &&
    input.revision >= 0 &&
    input.evidenceIds.length === 2 &&
    new Set(input.evidenceIds).size === 2 &&
    input.evidenceIds.every((id) => SAFE_ID.test(id))
  );
}

function validSample(
  sample: InvarianceSampleEvidence,
  expectedIndex: InvarianceSampleIndex,
  expectedParameter: InvarianceSampleParameter,
  expectedRevision: number,
): boolean {
  return (
    Boolean(sample && typeof sample === "object") &&
    typeof sample.id === "string" &&
    SAFE_ID.test(sample.id) &&
    sample.index === expectedIndex &&
    Object.is(sample.parameter, expectedParameter) &&
    sample.revision === expectedRevision &&
    Array.isArray(sample.coords) &&
    sample.coords.length === 2 &&
    sample.coords.every(Number.isFinite) &&
    Number.isFinite(sample.pa) &&
    sample.pa >= 0 &&
    Number.isFinite(sample.pb) &&
    sample.pb >= 0 &&
    Number.isFinite(sample.delta) &&
    sample.delta >= 0 &&
    Number.isFinite(sample.tolerance) &&
    Object.is(sample.tolerance, INVARIANCE_DISTANCE_TOLERANCE) &&
    sample.toleranceVersion === INVARIANCE_DISTANCE_TOLERANCE_VERSION &&
    sample.positionVersion === INVARIANCE_POSITION_VERSION &&
    Object.is(sample.delta, Math.abs(sample.pa - sample.pb)) &&
    sample.pass === sample.delta <= sample.tolerance
  );
}

function freezeSample(sample: InvarianceSampleEvidence): InvarianceSampleEvidence {
  return Object.freeze({
    ...sample,
    coords: Object.freeze([sample.coords[0], sample.coords[1]]) as readonly [
      number,
      number,
    ],
  });
}

function failed(
  runId: string,
  input: NormalizedInput,
  code: InvarianceRunErrorCode,
): InvarianceRunFailed {
  return Object.freeze({
    status: "failed",
    runId,
    revision: safeRevision(input.revision),
    inputEvidenceIds: Object.freeze([...input.evidenceIds]),
    samples: EMPTY_RESULT_ARRAY,
    pass: false,
    evidenceIds: EMPTY_RESULT_ARRAY,
    error: Object.freeze({ code }),
  });
}

function tuple2(values: readonly string[]): InvarianceInputEvidenceIds {
  return Object.freeze([values[0], values[1]]) as InvarianceInputEvidenceIds;
}

function sameTuple(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function safeRevision(revision: number): number {
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function cancellationError(): DOMException {
  return new DOMException("Invariance run cancelled.", "AbortError");
}

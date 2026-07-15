import type { BisectorValidation } from "@/types/geogebra";
import type { SceneObjectKind } from "@/types/geogebra";

export const RUN_INVARIANCE_TEST_OPERATION = "run_invariance_test" as const;
export const INVARIANCE_PARAMETER_VERSION = "normalized-line-v1" as const;
export const INVARIANCE_POSITION_VERSION =
  "projected-midpoint-distance-ab-v1" as const;
export const INVARIANCE_DISTANCE_TOLERANCE_VERSION =
  "absolute-distance-v1" as const;
export const INVARIANCE_DISTANCE_TOLERANCE = 1e-6 as const;
export const INVARIANCE_SAMPLE_PARAMETERS = Object.freeze([
  -1,
  -0.5,
  0,
  0.5,
  1,
] as const);

export type InvarianceSampleIndex = 0 | 1 | 2 | 3 | 4;
export type InvarianceSampleParameter =
  (typeof INVARIANCE_SAMPLE_PARAMETERS)[InvarianceSampleIndex];
export type InvarianceInputEvidenceIds = readonly [string, string];

export type RunInvarianceTestInput = Readonly<{
  candidateLine: string;
  revision: number;
  evidenceIds: InvarianceInputEvidenceIds;
}>;

export type InvarianceSampleEvidence = Readonly<{
  id: string;
  index: InvarianceSampleIndex;
  parameter: InvarianceSampleParameter;
  coords: readonly [number, number];
  pa: number;
  pb: number;
  delta: number;
  tolerance: number;
  toleranceVersion: typeof INVARIANCE_DISTANCE_TOLERANCE_VERSION;
  positionVersion: typeof INVARIANCE_POSITION_VERSION;
  pass: boolean;
  revision: number;
}>;

export type InvarianceSamples = readonly [
  InvarianceSampleEvidence,
  InvarianceSampleEvidence,
  InvarianceSampleEvidence,
  InvarianceSampleEvidence,
  InvarianceSampleEvidence,
];

export type InvarianceSampleEvidenceIds = readonly [
  string,
  string,
  string,
  string,
  string,
];

export type InvarianceRunErrorCode =
  | "invalid_input"
  | "precondition_not_met"
  | "stale_authority"
  | "invalid_sample"
  | "sample_execution_failed";

export type InvarianceCancellationReason =
  | "student_drag"
  | "student_speech"
  | "application_stop"
  | "stale_revision"
  | "reset";

type InvarianceRunBase = Readonly<{
  runId: string;
  revision: number;
  inputEvidenceIds: readonly string[];
}>;

export type InvarianceRunCompleted = InvarianceRunBase &
  Readonly<{
    status: "completed";
    samples: InvarianceSamples;
    pass: boolean;
    evidenceIds: InvarianceSampleEvidenceIds;
  }>;

export type InvarianceRunFailed = InvarianceRunBase &
  Readonly<{
    status: "failed";
    samples: readonly [];
    pass: false;
    evidenceIds: readonly [];
    error: Readonly<{ code: InvarianceRunErrorCode }>;
  }>;

export type InvarianceRunCancelled = InvarianceRunBase &
  Readonly<{
    status: "cancelled";
    samples: readonly [];
    pass: false;
    evidenceIds: readonly [];
    reason: InvarianceCancellationReason;
  }>;

export type InvarianceRunResult =
  | InvarianceRunCompleted
  | InvarianceRunFailed
  | InvarianceRunCancelled;

export type InvarianceSampleRequest = Readonly<{
  runId: string;
  candidateLine: string;
  revision: number;
  inputEvidenceIds: InvarianceInputEvidenceIds;
  index: InvarianceSampleIndex;
  parameter: InvarianceSampleParameter;
  scene: InvarianceTemporaryScene;
  signal: AbortSignal;
  isAuthorityCurrent(): boolean;
}>;

export type InvarianceTemporaryScene = Readonly<{
  namespace: string;
  helperName(suffix: string): string;
  createHelper(
    suffix: string,
    expression: string,
    kind: SceneObjectKind,
  ): string;
}>;

export type InvarianceSceneRequest = Readonly<{
  runId: string;
  candidateLine: string;
  revision: number;
  inputEvidenceIds: InvarianceInputEvidenceIds;
  signal: AbortSignal;
  isAuthorityCurrent(): boolean;
}>;

export type InvarianceRunEvent =
  | Readonly<{
      type: "rejected";
      runId: string;
      revision: number;
      code: "invalid_input" | "precondition_not_met";
    }>
  | Readonly<{
      type: "started";
      runId: string;
      candidateLine: string;
      revision: number;
      inputEvidenceIds: InvarianceInputEvidenceIds;
      parameterVersion: typeof INVARIANCE_PARAMETER_VERSION;
      sampleParameters: typeof INVARIANCE_SAMPLE_PARAMETERS;
    }>
  | Readonly<{
      type: "sample_completed";
      runId: string;
      revision: number;
      index: InvarianceSampleIndex;
      parameter: InvarianceSampleParameter;
      evidenceId: string;
      pass: boolean;
    }>
  | Readonly<{
      type: "completed";
      runId: string;
      revision: number;
      pass: boolean;
      evidenceIds: InvarianceSampleEvidenceIds;
    }>
  | Readonly<{
      type: "failed";
      runId: string;
      revision: number;
      code: Exclude<
        InvarianceRunErrorCode,
        "invalid_input" | "precondition_not_met"
      >;
    }>
  | Readonly<{
      type: "cancelled";
      runId: string;
      revision: number;
      reason: InvarianceCancellationReason;
    }>;

export type InvarianceRunHandle = Readonly<{
  runId: string;
  result: Promise<InvarianceRunResult>;
  cancel(reason?: InvarianceCancellationReason): boolean;
}>;

export type RunInvarianceTestDependencies = Readonly<{
  getCurrentValidation(): BisectorValidation | null;
  runInTemporaryScene<T>(
    request: InvarianceSceneRequest,
    execute: (scene: InvarianceTemporaryScene) => Promise<T> | T,
  ): Promise<T>;
  sample(
    request: InvarianceSampleRequest,
  ): Promise<InvarianceSampleEvidence> | InvarianceSampleEvidence;
  createRunId?(): string;
  observe?(event: InvarianceRunEvent): void;
}>;

export type RunInvarianceTestOptions = Readonly<{
  signal?: AbortSignal;
}>;

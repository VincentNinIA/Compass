export const APP_ERROR_DOMAINS = [
  "exercise_parse",
  "realtime_session",
] as const;

export type AppErrorDomain = (typeof APP_ERROR_DOMAINS)[number];

export type AppError = Readonly<{
  domain: AppErrorDomain;
  code: string;
  retryable: boolean;
  userMessage: string;
  correlationId: string;
}>;

export const UPSTREAM_RETRY_POLICY = Object.freeze({
  maximumAutomaticServerRetries: 1,
  serverRetryDelayMs: 50,
  defaultRateLimitBackoffMs: 1_000,
  maximumRateLimitBackoffMs: 5_000,
});

const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

export function createCorrelationId(
  domain: AppErrorDomain,
  randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
): string {
  const safeRandom = randomId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return `${domain}_${safeRandom || "unavailable"}`;
}

export function createAppError(input: AppError): AppError {
  if (
    !APP_ERROR_DOMAINS.includes(input.domain) ||
    !SAFE_TOKEN.test(input.code) ||
    !SAFE_TOKEN.test(input.correlationId) ||
    input.userMessage.trim().length === 0 ||
    input.userMessage.length > 240
  ) {
    throw new Error("Invalid AppError boundary.");
  }
  return Object.freeze({ ...input });
}

export function parseAppErrorPayload(value: unknown): AppError | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;
  const error = value.error;
  if (
    Object.keys(error).sort().join("|") !==
      "code|correlationId|domain|retryable|userMessage" ||
    typeof error.domain !== "string" ||
    !APP_ERROR_DOMAINS.includes(error.domain as AppErrorDomain) ||
    typeof error.code !== "string" ||
    !SAFE_TOKEN.test(error.code) ||
    typeof error.retryable !== "boolean" ||
    typeof error.userMessage !== "string" ||
    error.userMessage.trim().length === 0 ||
    error.userMessage.length > 240 ||
    typeof error.correlationId !== "string" ||
    !SAFE_TOKEN.test(error.correlationId)
  ) {
    return undefined;
  }
  return createAppError(error as AppError);
}

export function shouldAutomaticallyRetryStatus(
  status: number,
  retriesAlreadyAttempted: number,
): boolean {
  return (
    status >= 500 &&
    status <= 599 &&
    retriesAlreadyAttempted <
      UPSTREAM_RETRY_POLICY.maximumAutomaticServerRetries
  );
}

export function safeRateLimitBackoffMs(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return UPSTREAM_RETRY_POLICY.defaultRateLimitBackoffMs;
  }
  return Math.min(
    UPSTREAM_RETRY_POLICY.maximumRateLimitBackoffMs,
    Math.max(1_000, Math.round(parsed)),
  );
}

export function appErrorResponse(
  status: number,
  error: AppError,
  options: { private?: boolean; retryAfterMs?: number } = {},
): Response {
  const headers = new Headers({
    "Cache-Control": options.private ? "private, no-store" : "no-store",
    "X-GeoTutor-Correlation-Id": error.correlationId,
  });
  if (options.private) headers.set("Pragma", "no-cache");
  if (options.retryAfterMs !== undefined) {
    headers.set(
      "Retry-After",
      String(Math.ceil(safeRateLimitBackoffMs(options.retryAfterMs) / 1_000)),
    );
  }
  return Response.json({ error }, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { describe, expect, it } from "vitest";

import {
  UPSTREAM_RETRY_POLICY,
  appErrorResponse,
  createAppError,
  createCorrelationId,
  parseAppErrorPayload,
  safeRateLimitBackoffMs,
  shouldAutomaticallyRetryStatus,
} from "./app-error";

describe("AppError reliability boundary", () => {
  it("creates an exact, frozen and safe application error", async () => {
    const correlationId = createCorrelationId(
      "realtime_session",
      "unsafe/request id:secret",
    );
    const error = createAppError({
      domain: "realtime_session",
      code: "upstream_rate_limited",
      retryable: true,
      userMessage: "Realtime is temporarily rate limited.",
      correlationId,
    });
    const response = appErrorResponse(503, error, { retryAfterMs: 2_300 });

    expect(error).toEqual({
      domain: "realtime_session",
      code: "upstream_rate_limited",
      retryable: true,
      userMessage: "Realtime is temporarily rate limited.",
      correlationId: "realtime_session_unsaferequestidsecret",
    });
    expect(Object.isFrozen(error)).toBe(true);
    expect(response.headers.get("x-geotutor-correlation-id")).toBe(
      error.correlationId,
    );
    expect(response.headers.get("retry-after")).toBe("3");
    expect(parseAppErrorPayload(await response.json())).toEqual(error);
  });

  it.each([
    [{ error: { domain: "realtime_session" } }, "partial"],
    [
      {
        error: {
          domain: "realtime_session",
          code: "failed",
          retryable: true,
          userMessage: "Safe.",
          correlationId: "rtc_1",
          rawBody: "provider secret",
        },
      },
      "unknown field",
    ],
    [
      {
        error: {
          domain: "unknown",
          code: "failed",
          retryable: true,
          userMessage: "Safe.",
          correlationId: "rtc_1",
        },
      },
      "unknown domain",
    ],
  ])("rejects %s payloads (%s)", (payload, label) => {
    expect(label).toBeTruthy();
    expect(parseAppErrorPayload(payload)).toBeUndefined();
  });

  it("never retries authentication or 429 and caps 5xx at one retry", () => {
    for (const status of [401, 403, 429]) {
      expect(shouldAutomaticallyRetryStatus(status, 0)).toBe(false);
    }
    expect(shouldAutomaticallyRetryStatus(500, 0)).toBe(true);
    expect(shouldAutomaticallyRetryStatus(503, 0)).toBe(true);
    expect(shouldAutomaticallyRetryStatus(500, 1)).toBe(false);
    expect(UPSTREAM_RETRY_POLICY.maximumAutomaticServerRetries).toBe(1);
  });

  it("bounds rate-limit backoff to an explicit 1-5 second window", () => {
    expect(safeRateLimitBackoffMs(undefined)).toBe(1_000);
    expect(safeRateLimitBackoffMs(200)).toBe(1_000);
    expect(safeRateLimitBackoffMs("2300")).toBe(2_300);
    expect(safeRateLimitBackoffMs(99_000)).toBe(5_000);
  });
});

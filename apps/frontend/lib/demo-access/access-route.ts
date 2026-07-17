import {
  DEMO_ACCESS_MAX_BODY_BYTES,
  DEMO_ACCESS_MAX_CODE_LENGTH,
  DEMO_SESSION_COOKIE_NAME,
  inspectDemoSession,
  issueDemoSession,
  readDemoProtectionConfig,
  serializeDemoSessionCookie,
  shouldUseSecureCookie,
  verifyDemoAccessCode,
} from "./server";

type Environment = Readonly<Record<string, string | undefined>>;

type AccessRouteDependencies = {
  environment?: Environment;
  now?: () => number;
  sessionIdFactory?: () => string;
};

function json(
  payload: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function safeFailure(
  status: 400 | 401 | 413 | 503,
  code:
    | "demo_access_invalid"
    | "demo_access_required"
    | "demo_protection_unavailable"
    | "invalid_request"
    | "request_too_large",
  message: string,
): Response {
  return json({ error: { code, message, retryable: false } }, status);
}

function isJson(request: Request): boolean {
  return (
    request.headers.get("content-type")?.toLowerCase().split(";", 1)[0] ===
    "application/json"
  );
}

function isCodePayload(value: unknown): value is { code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    typeof record.code === "string" &&
    record.code.length >= 8 &&
    record.code.length <= DEMO_ACCESS_MAX_CODE_LENGTH
  );
}

export function createDemoAccessRouteHandlers(
  dependencies: AccessRouteDependencies = {},
) {
  const now = dependencies.now ?? Date.now;

  return {
    GET(request: Request): Promise<Response> {
      const inspection = inspectDemoSession(request.headers.get("cookie"), {
        environment: dependencies.environment,
        now: now(),
      });
      if (inspection.status === "disabled") {
        return Promise.resolve(json({ status: "disabled" }, 200));
      }
      if (inspection.status === "unavailable") {
        return Promise.resolve(
          safeFailure(
            503,
            "demo_protection_unavailable",
            "Demo access is temporarily unavailable.",
          ),
        );
      }
      if (inspection.status === "authorized") {
        return Promise.resolve(
          json({ status: "authorized", expiresAt: inspection.expiresAt }, 200),
        );
      }
      return Promise.resolve(
        safeFailure(401, "demo_access_required", "Demo access is required."),
      );
    },

    async POST(request: Request): Promise<Response> {
      const config = readDemoProtectionConfig(dependencies.environment);
      if (config.status === "disabled") {
        return json({ status: "disabled" }, 200);
      }
      if (config.status === "unavailable") {
        return safeFailure(
          503,
          "demo_protection_unavailable",
          "Demo access is temporarily unavailable.",
        );
      }
      if (!isJson(request)) {
        return safeFailure(400, "invalid_request", "Expected a JSON request.");
      }
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > DEMO_ACCESS_MAX_BODY_BYTES
      ) {
        return safeFailure(413, "request_too_large", "The request is too large.");
      }

      let payload: unknown;
      try {
        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > DEMO_ACCESS_MAX_BODY_BYTES) {
          return safeFailure(413, "request_too_large", "The request is too large.");
        }
        payload = JSON.parse(rawBody);
      } catch {
        return safeFailure(400, "invalid_request", "The request is invalid.");
      }
      if (!isCodePayload(payload)) {
        return safeFailure(400, "invalid_request", "The request is invalid.");
      }
      if (!(await verifyDemoAccessCode(payload.code, config.accessHash))) {
        return safeFailure(401, "demo_access_invalid", "The access code is invalid.");
      }

      const issued = issueDemoSession(config, {
        now: now(),
        sessionId: dependencies.sessionIdFactory?.(),
      });
      return json(
        { status: "authorized", expiresAt: issued.expiresAt },
        200,
        {
          "Set-Cookie": serializeDemoSessionCookie(issued.token, {
            maxAge: config.sessionTtlSeconds,
            secure: shouldUseSecureCookie(
              request.url,
              dependencies.environment,
            ),
          }),
        },
      );
    },

    DELETE(request: Request): Promise<Response> {
      const secure = shouldUseSecureCookie(request.url, dependencies.environment);
      return Promise.resolve(
        json(
          { status: "signed_out" },
          200,
          {
            "Set-Cookie": serializeDemoSessionCookie("", {
              maxAge: 0,
              secure,
            }),
          },
        ),
      );
    },
  };
}

export { DEMO_SESSION_COOKIE_NAME };

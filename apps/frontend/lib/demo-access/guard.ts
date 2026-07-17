import {
  inspectDemoSession,
  type DemoSessionInspection,
} from "./server";

type Environment = Readonly<Record<string, string | undefined>>;
type RouteHandler = (request: Request) => Promise<Response>;

function jsonError(
  status: 401 | 503,
  code: "demo_access_required" | "demo_protection_unavailable",
  message: string,
): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

export function demoAccessDenial(
  inspection: DemoSessionInspection,
): Response | null {
  if (inspection.status === "disabled" || inspection.status === "authorized") {
    return null;
  }
  if (inspection.status === "unavailable") {
    return jsonError(
      503,
      "demo_protection_unavailable",
      "Demo access is temporarily unavailable.",
    );
  }
  return jsonError(
    401,
    "demo_access_required",
    "Demo access is required.",
  );
}

export function withDemoAccessProtection(
  handler: RouteHandler,
  dependencies: { environment?: Environment; now?: () => number } = {},
): RouteHandler {
  return async function protectedRoute(request: Request): Promise<Response> {
    const inspection = inspectDemoSession(request.headers.get("cookie"), {
      environment: dependencies.environment,
      now: dependencies.now?.(),
    });
    const denial = demoAccessDenial(inspection);
    if (denial) return denial;
    return handler(request);
  };
}

import { REALTIME_TOOL_DEFINITIONS } from "@/lib/tools/contracts";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_SDP_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

const SESSION_CONFIG = {
  type: "realtime",
  model: "gpt-realtime-2.1",
  instructions:
    "You are GeoTutor. Use only the provided tools. Never invent construction state or geometric facts. When a user explicitly asks you to read the current construction and provides its revision, call read_construction before answering.",
  reasoning: {
    effort: "low",
  },
  audio: {
    input: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.2,
        prefix_padding_ms: 300,
        silence_duration_ms: 400,
        create_response: false,
        interrupt_response: true,
      },
    },
    output: {
      voice: "marin",
    },
  },
  tools: REALTIME_TOOL_DEFINITIONS,
  tool_choice: "auto",
} as const;

export const REALTIME_SESSION_PROFILE = {
  model: SESSION_CONFIG.model,
  voice: SESSION_CONFIG.audio.output.voice,
  reasoningEffort: SESSION_CONFIG.reasoning.effort,
  turnDetection: SESSION_CONFIG.audio.input.turn_detection.type,
  createResponse: SESSION_CONFIG.audio.input.turn_detection.create_response,
  interruptResponse: SESSION_CONFIG.audio.input.turn_detection.interrupt_response,
} as const;

type SessionRouteDependencies = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type RouteErrorCode =
  | "unsupported_media_type"
  | "sdp_too_large"
  | "invalid_sdp"
  | "realtime_unconfigured"
  | "upstream_authentication_failed"
  | "upstream_configuration_rejected"
  | "upstream_rate_limited"
  | "upstream_unavailable"
  | "upstream_invalid_response"
  | "upstream_timeout";

const ERROR_MESSAGES: Record<RouteErrorCode, string> = {
  unsupported_media_type: "Expected an application/sdp request.",
  sdp_too_large: "The SDP offer exceeds the allowed size.",
  invalid_sdp: "The SDP offer is empty or malformed.",
  realtime_unconfigured: "Realtime is not configured on this server.",
  upstream_authentication_failed: "Realtime authentication failed upstream.",
  upstream_configuration_rejected: "Realtime rejected the server session configuration.",
  upstream_rate_limited: "Realtime is temporarily rate limited.",
  upstream_unavailable: "Realtime is temporarily unavailable.",
  upstream_invalid_response: "Realtime returned an invalid SDP answer.",
  upstream_timeout: "Realtime session creation timed out.",
};

function errorResponse(
  status: number,
  code: RouteErrorCode,
  retryable: boolean,
): Response {
  return Response.json(
    {
      error: {
        code,
        message: ERROR_MESSAGES[code],
        retryable,
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function isApplicationSdp(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/sdp";
}

function isValidSdp(value: string): boolean {
  const normalized = value.replaceAll("\r\n", "\n");
  return (
    normalized.startsWith("v=0\n") &&
    normalized.includes("\no=") &&
    normalized.includes("\nm=audio ")
  );
}

async function mapUpstreamFailure(upstream: Response): Promise<Response> {
  const status = upstream.status;
  if (status === 400) {
    const diagnostic = await safeUpstreamDiagnostic(upstream);
    console.error("Realtime configuration rejected upstream.", diagnostic);
    return errorResponse(502, "upstream_configuration_rejected", false);
  }
  if (status === 401 || status === 403) {
    return errorResponse(502, "upstream_authentication_failed", false);
  }
  if (status === 429) {
    return errorResponse(503, "upstream_rate_limited", true);
  }
  return errorResponse(502, "upstream_unavailable", status >= 500);
}

async function safeUpstreamDiagnostic(upstream: Response) {
  try {
    const payload = (await upstream.json()) as {
      error?: { code?: unknown; param?: unknown; type?: unknown };
    };
    return {
      code: typeof payload.error?.code === "string" ? payload.error.code : "unknown",
      param: typeof payload.error?.param === "string" ? payload.error.param : "unknown",
      type: typeof payload.error?.type === "string" ? payload.error.type : "unknown",
    };
  } catch {
    return { code: "unknown", param: "unknown", type: "unknown" };
  }
}

export function createRealtimeSessionHandler(
  dependencies: SessionRouteDependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function handleRealtimeSession(request: Request): Promise<Response> {
    if (!isApplicationSdp(request.headers.get("content-type"))) {
      return errorResponse(415, "unsupported_media_type", false);
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SDP_BYTES) {
      return errorResponse(413, "sdp_too_large", false);
    }

    const offer = await request.text();
    if (new TextEncoder().encode(offer).byteLength > MAX_SDP_BYTES) {
      return errorResponse(413, "sdp_too_large", false);
    }
    if (!isValidSdp(offer)) {
      return errorResponse(400, "invalid_sdp", false);
    }

    const apiKey = dependencies.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return errorResponse(503, "realtime_unconfigured", false);
    }

    const body = new FormData();
    body.set("sdp", offer);
    body.set("session", JSON.stringify(SESSION_CONFIG));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstream = await fetchImpl(OPENAI_REALTIME_CALLS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        cache: "no-store",
        signal: controller.signal,
      });

      if (!upstream.ok) {
        return mapUpstreamFailure(upstream);
      }

      const answer = await upstream.text();
      if (!isValidSdp(answer)) {
        return errorResponse(502, "upstream_invalid_response", true);
      }

      return new Response(answer, {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/sdp",
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return errorResponse(504, "upstream_timeout", true);
      }
      return errorResponse(502, "upstream_unavailable", true);
    } finally {
      clearTimeout(timeout);
    }
  };
}

export const REALTIME_ROUTE_LIMITS = {
  maxSdpBytes: MAX_SDP_BYTES,
  timeoutMs: DEFAULT_TIMEOUT_MS,
} as const;

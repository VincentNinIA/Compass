import { REALTIME_TOOL_DEFINITIONS } from "@/lib/tools/contracts";
import {
  UPSTREAM_RETRY_POLICY,
  appErrorResponse,
  createAppError,
  createCorrelationId,
  safeRateLimitBackoffMs,
  shouldAutomaticallyRetryStatus,
} from "@/lib/reliability/app-error";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_SDP_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

export type RealtimeSessionMode = "live_voice" | "typed_live";

const LIVE_VOICE_SESSION_CONFIG = {
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

const TYPED_LIVE_SESSION_CONFIG = {
  type: "realtime",
  model: "gpt-realtime-2.1",
  instructions:
    "You are GeoTutor in typed-only degraded mode. Give concise reflective geometry guidance. Never claim to read or change the current construction. Do not call tools.",
  reasoning: {
    effort: "low",
  },
  output_modalities: ["text"],
  tools: [],
  tool_choice: "none",
} as const;

export const REALTIME_SESSION_PROFILE = {
  model: LIVE_VOICE_SESSION_CONFIG.model,
  voice: LIVE_VOICE_SESSION_CONFIG.audio.output.voice,
  reasoningEffort: LIVE_VOICE_SESSION_CONFIG.reasoning.effort,
  turnDetection: LIVE_VOICE_SESSION_CONFIG.audio.input.turn_detection.type,
  createResponse:
    LIVE_VOICE_SESSION_CONFIG.audio.input.turn_detection.create_response,
  interruptResponse:
    LIVE_VOICE_SESSION_CONFIG.audio.input.turn_detection.interrupt_response,
} as const;

export const TYPED_REALTIME_SESSION_PROFILE = {
  model: TYPED_LIVE_SESSION_CONFIG.model,
  reasoningEffort: TYPED_LIVE_SESSION_CONFIG.reasoning.effort,
  outputModalities: TYPED_LIVE_SESSION_CONFIG.output_modalities,
  tools: TYPED_LIVE_SESSION_CONFIG.tools,
  toolChoice: TYPED_LIVE_SESSION_CONFIG.tool_choice,
} as const;

export type SessionRouteDependencies = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  correlationIdFactory?: () => string;
  sleep?: (delayMs: number) => Promise<void>;
};

type RouteErrorCode =
  | "unsupported_media_type"
  | "invalid_capability_mode"
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
  invalid_capability_mode: "Expected live_voice or typed_live capability mode.",
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
  correlationId: string,
  retryAfterMs?: number,
): Response {
  return appErrorResponse(
    status,
    createAppError({
      domain: "realtime_session",
      code,
      retryable,
      userMessage: ERROR_MESSAGES[code],
      correlationId,
    }),
    { retryAfterMs },
  );
}

function isApplicationSdp(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/sdp";
}

function readSessionMode(request: Request): RealtimeSessionMode | undefined {
  const value = request.headers.get("x-geotutor-capability-mode") ?? "live_voice";
  return value === "live_voice" || value === "typed_live" ? value : undefined;
}

function isValidSdp(value: string, mode: RealtimeSessionMode): boolean {
  const normalized = value.replaceAll("\r\n", "\n");
  return (
    normalized.startsWith("v=0\n") &&
    normalized.includes("\no=") &&
    normalized.includes("\nm=audio ") &&
    (mode === "live_voice" || normalized.includes("\nm=application "))
  );
}

function mapUpstreamFailure(
  upstream: Response,
  correlationId: string,
): Response {
  const status = upstream.status;
  if (status === 400) {
    return errorResponse(
      502,
      "upstream_configuration_rejected",
      false,
      correlationId,
    );
  }
  if (status === 401 || status === 403) {
    return errorResponse(
      502,
      "upstream_authentication_failed",
      false,
      correlationId,
    );
  }
  if (status === 429) {
    return errorResponse(
      503,
      "upstream_rate_limited",
      true,
      correlationId,
      safeRateLimitBackoffMs(
        Number(upstream.headers.get("retry-after")) * 1_000,
      ),
    );
  }
  return errorResponse(
    502,
    "upstream_unavailable",
    status >= 500,
    correlationId,
  );
}

export function createRealtimeSessionHandler(
  dependencies: SessionRouteDependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep =
    dependencies.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  return async function handleRealtimeSession(request: Request): Promise<Response> {
    const correlationId = createCorrelationId(
      "realtime_session",
      dependencies.correlationIdFactory?.(),
    );
    if (!isApplicationSdp(request.headers.get("content-type"))) {
      return errorResponse(415, "unsupported_media_type", false, correlationId);
    }

    const mode = readSessionMode(request);
    if (!mode) {
      return errorResponse(400, "invalid_capability_mode", false, correlationId);
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SDP_BYTES) {
      return errorResponse(413, "sdp_too_large", false, correlationId);
    }

    const offer = await request.text();
    if (new TextEncoder().encode(offer).byteLength > MAX_SDP_BYTES) {
      return errorResponse(413, "sdp_too_large", false, correlationId);
    }
    if (!isValidSdp(offer, mode)) {
      return errorResponse(400, "invalid_sdp", false, correlationId);
    }

    const apiKey = dependencies.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return errorResponse(503, "realtime_unconfigured", false, correlationId);
    }

    const body = new FormData();
    body.set("sdp", offer);
    body.set(
      "session",
      JSON.stringify(
        mode === "live_voice"
          ? LIVE_VOICE_SESSION_CONFIG
          : TYPED_LIVE_SESSION_CONFIG,
      ),
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let retries = 0;
      let upstream: Response;
      while (true) {
        upstream = await fetchImpl(OPENAI_REALTIME_CALLS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body,
          cache: "no-store",
          signal: controller.signal,
        });
        if (
          upstream.ok ||
          !shouldAutomaticallyRetryStatus(upstream.status, retries)
        ) {
          break;
        }
        retries += 1;
        await sleep(UPSTREAM_RETRY_POLICY.serverRetryDelayMs);
      }

      if (!upstream.ok) return mapUpstreamFailure(upstream, correlationId);

      const answer = await upstream.text();
      if (!isValidSdp(answer, mode)) {
        return errorResponse(
          502,
          "upstream_invalid_response",
          true,
          correlationId,
        );
      }

      return new Response(answer, {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/sdp",
          "X-GeoTutor-Correlation-Id": correlationId,
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return errorResponse(504, "upstream_timeout", true, correlationId);
      }
      return errorResponse(502, "upstream_unavailable", true, correlationId);
    } finally {
      clearTimeout(timeout);
    }
  };
}

export const REALTIME_ROUTE_LIMITS = {
  maxSdpBytes: MAX_SDP_BYTES,
  timeoutMs: DEFAULT_TIMEOUT_MS,
} as const;

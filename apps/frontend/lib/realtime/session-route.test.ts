import { describe, expect, it, vi } from "vitest";

import {
  REALTIME_ROUTE_LIMITS,
  createRealtimeSessionHandler,
} from "./session-route";
import { REALTIME_TOOL_DEFINITIONS } from "@/lib/tools/contracts";
import {
  GEOGEBRA_ASSIST_TOOL_DEFINITIONS,
  GEOGEBRA_ASSIST_TOOL_NAMES,
} from "@/lib/geogebra/assist-tools";
import {
  GEOMETRY_INVESTIGATION_MODEL_ACTIONS_V1,
  GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS,
} from "@/lib/geometry-investigation/actions";

const OFFER = [
  "v=0",
  "o=- 123 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=rtpmap:111 opus/48000/2",
].join("\r\n");

const ANSWER = [
  "v=0",
  "o=- 456 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=setup:active",
].join("\r\n");

const DATA_OFFER = [
  "v=0",
  "o=- 789 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 0 UDP/TLS/RTP/SAVPF 111",
  "a=inactive",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "a=sctp-port:5000",
].join("\r\n");

const DATA_ANSWER = [
  "v=0",
  "o=- 987 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 0 UDP/TLS/RTP/SAVPF 111",
  "a=inactive",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "a=sctp-port:5000",
].join("\r\n");

function request(
  body: string,
  contentType = "application/sdp",
  mode?: "live_voice" | "typed_live" | "invalid",
  profile?:
    | "specialized_geometry"
    | "general_tutor"
    | "geogebra_tutor"
    | "invalid",
  harness?: "v1" | "v2" | "invalid",
) {
  return new Request("http://localhost/api/realtime/session", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      ...(mode ? { "X-GeoTutor-Capability-Mode": mode } : {}),
      ...(profile ? { "X-GeoTutor-Tutor-Profile": profile } : {}),
      ...(harness ? { "X-GeoTutor-Geometry-Harness": harness } : {}),
    },
    body,
  });
}

async function errorCode(response: Response) {
  const payload = (await response.json()) as { error: { code: string } };
  return payload.error.code;
}

describe("POST /api/realtime/session", () => {
  it("relays a valid SDP offer as multipart and returns the SDP answer", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(init?.headers).toEqual({ Authorization: "Bearer server-secret" });
      expect(form.get("sdp")).toBe(OFFER);
      expect(JSON.parse(form.get("session") as string)).toEqual(
        {
          type: "realtime",
          model: "gpt-realtime-2.1",
          instructions:
            "You are GeoTutor. Speak as a warm, calm adult male tutor, natural and never theatrical. Use only the provided tools. Never invent construction state or geometric facts. When a user explicitly asks you to read the current construction and provides its revision, call read_construction before answering.",
          reasoning: { effort: "low" },
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
            output: { voice: "cedar" },
          },
          tools: REALTIME_TOOL_DEFINITIONS,
          tool_choice: "auto",
        },
      );
      return new Response(ANSWER, {
        status: 201,
        headers: { "Content-Type": "application/sdp" },
      });
    });
    const handler = createRealtimeSessionHandler({
      apiKey: "server-secret",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const response = await handler(request(OFFER));

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/sdp");
    expect(await response.text()).toBe(ANSWER);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/calls",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reuses the route for a data-channel-only typed_live session", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("sdp")).toBe(DATA_OFFER);
      expect(JSON.parse(form.get("session") as string)).toEqual({
        type: "realtime",
        model: "gpt-realtime-2.1",
        instructions:
          "You are GeoTutor in typed-only degraded mode. Give concise reflective geometry guidance. Never claim to read or change the current construction. Do not call tools.",
        reasoning: { effort: "low" },
        output_modalities: ["text"],
        tools: [],
        tool_choice: "none",
      });
      return new Response(DATA_ANSWER, { status: 201 });
    });
    const response = await createRealtimeSessionHandler({
      apiKey: "server-secret",
      fetchImpl: fetchImpl as typeof fetch,
    })(request(DATA_OFFER, "application/sdp", "typed_live"));

    expect(response.status).toBe(201);
    expect(await response.text()).toBe(DATA_ANSWER);
  });

  it.each([
    ["live_voice", OFFER, ANSWER],
    ["typed_live", DATA_OFFER, DATA_ANSWER],
  ] as const)("creates a %s general tutor session with no tools", async (mode, offer, answer) => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      const session = JSON.parse(form.get("session") as string) as {
        instructions: string;
        tools: unknown[];
        tool_choice: string;
      };
      expect(session.instructions).toContain("any subject");
      expect(session.instructions).toContain("untrusted user data");
      expect(session.tools).toEqual([]);
      expect(session.tool_choice).toBe("none");
      return new Response(answer, { status: 201 });
    });
    const response = await createRealtimeSessionHandler({
      apiKey: "server-secret",
      fetchImpl: fetchImpl as typeof fetch,
    })(request(offer, "application/sdp", mode, "general_tutor"));
    expect(response.status).toBe(201);
  });

  it.each([
    ["live_voice", OFFER, ANSWER],
    ["typed_live", DATA_OFFER, DATA_ANSWER],
  ] as const)(
    "creates a %s GeoGebra-aware tutor with the exact closed tools",
    async (mode, offer, answer) => {
      const fetchImpl = vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) => {
          const form = init?.body as FormData;
          const session = JSON.parse(form.get("session") as string) as {
            instructions: string;
            tools: Array<{ name: string }>;
            tool_choice: string;
            output_modalities?: string[];
          };
          expect(session.instructions).toContain("embedded GeoGebra Geometry");
          expect(session.instructions).toContain(
            "Never tell the learner to use a physical ruler",
          );
          expect(session.instructions).toContain("exact click order");
          expect(session.instructions).toContain("explicitly asks");
          expect(session.tools).toEqual(GEOGEBRA_ASSIST_TOOL_DEFINITIONS);
          expect(session.tools.map((tool) => tool.name)).toEqual(
            GEOGEBRA_ASSIST_TOOL_NAMES,
          );
          expect(session.tool_choice).toBe("auto");
          if (mode === "typed_live") {
            expect(session.output_modalities).toEqual(["text"]);
          }
          return new Response(answer, { status: 201 });
        },
      );
      const response = await createRealtimeSessionHandler({
        apiKey: "server-secret",
        fetchImpl: fetchImpl as typeof fetch,
      })(request(offer, "application/sdp", mode, "geogebra_tutor"));

      expect(response.status).toBe(201);
    },
  );

  it.each([
    ["live_voice", OFFER, ANSWER],
    ["typed_live", DATA_OFFER, DATA_ANSWER],
  ] as const)(
    "creates a negotiated %s investigation session with the exact C04 palette",
    async (mode, offer, answer) => {
      const fetchImpl = vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) => {
          const form = init?.body as FormData;
          const session = JSON.parse(form.get("session") as string) as {
            instructions: string;
            tools: Array<{ name: string; parameters: { additionalProperties: boolean } }>;
            tool_choice: string;
            output_modalities?: string[];
          };
          expect(session.instructions).toContain("geometry_world.v2");
          expect(session.instructions).toContain("geometry_coach_turn.v1");
          expect(session.instructions).toContain("autonomously activate");
          expect(session.instructions).toContain(
            "visibly point to an exact GeoGebra toolbar control",
          );
          expect(session.instructions).toContain(
            "highlight_geometry_objects to point to named points or segments",
          );
          expect(session.instructions).toContain("which tool they would choose");
          expect(session.instructions).toContain("prior learner attempt");
          expect(session.instructions).toContain("Never propose or send coordinates");
          expect(session.tools).toEqual(
            GEOMETRY_INVESTIGATION_REALTIME_TOOL_DEFINITIONS,
          );
          expect(session.tools.map(({ name }) => name)).toEqual(
            GEOMETRY_INVESTIGATION_MODEL_ACTIONS_V1,
          );
          expect(session.tools.every(({ parameters }) =>
            parameters.additionalProperties === false,
          )).toBe(true);
          expect(session.tool_choice).toBe("auto");
          if (mode === "typed_live") {
            expect(session.output_modalities).toEqual(["text"]);
          }
          return new Response(answer, { status: 201 });
        },
      );
      const response = await createRealtimeSessionHandler({
        apiKey: "server-secret",
        fetchImpl: fetchImpl as typeof fetch,
      })(request(offer, "application/sdp", mode, "geogebra_tutor", "v2"));

      expect(response.status).toBe(201);
    },
  );

  it("rejects an unknown tutor profile", async () => {
    const response = await createRealtimeSessionHandler({})(
      request(OFFER, "application/sdp", "live_voice", "invalid"),
    );
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_tutor_profile");
  });

  it("rejects an unknown geometry harness before reaching credentials", async () => {
    const response = await createRealtimeSessionHandler({})(
      request(
        OFFER,
        "application/sdp",
        "live_voice",
        "geogebra_tutor",
        "invalid",
      ),
    );
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_geometry_harness");
  });

  it("rejects an unknown capability mode before reaching credentials", async () => {
    const response = await createRealtimeSessionHandler({})(
      request(OFFER, "application/sdp", "invalid"),
    );
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_capability_mode");
  });

  it("rejects unsupported media types before reading credentials", async () => {
    const response = await createRealtimeSessionHandler({})(
      request(OFFER, "text/plain"),
    );
    expect(response.status).toBe(415);
    expect(await errorCode(response)).toBe("unsupported_media_type");
  });

  it.each(["", "not-sdp", "v=0\r\no=x\r\nm=video 9 RTP/AVP 96"])(
    "rejects an empty or malformed offer: %j",
    async (body) => {
      const response = await createRealtimeSessionHandler({})(request(body));
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("invalid_sdp");
    },
  );

  it("rejects an SDP body above the byte limit", async () => {
    const body = `${OFFER}\r\na=x:${"a".repeat(REALTIME_ROUTE_LIMITS.maxSdpBytes)}`;
    const response = await createRealtimeSessionHandler({})(request(body));
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe("sdp_too_large");
  });

  it("returns a stable error when the server key is absent", async () => {
    const response = await createRealtimeSessionHandler({ apiKey: "" })(request(OFFER));
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("realtime_unconfigured");
  });

  it.each([401, 403])("normalizes upstream authentication status %s", async (status) => {
    const handler = createRealtimeSessionHandler({
      apiKey: "server-secret",
      fetchImpl: vi.fn(async () =>
        new Response("provider details that must not escape", { status }),
      ) as typeof fetch,
    });
    const response = await handler(request(OFFER));
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).toContain("upstream_authentication_failed");
    expect(body).not.toContain("provider details");
    expect(body).not.toContain("server-secret");
  });

  it("normalizes upstream rate limiting", async () => {
    const handler = createRealtimeSessionHandler({
      apiKey: "server-secret",
      fetchImpl: vi.fn(async () => new Response("quota", { status: 429 })) as typeof fetch,
    });
    const response = await handler(request(OFFER));
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("upstream_rate_limited");
  });

  it("normalizes rejected server configuration without exposing provider details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createRealtimeSessionHandler({
      apiKey: "server-secret",
      fetchImpl: vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "invalid_value",
              param: "session.tools[0]",
              type: "invalid_request_error",
              message: "provider detail",
            },
          },
          { status: 400 },
        ),
      ) as typeof fetch,
    });
    const response = await handler(request(OFFER));
    const raw = await response.text();
    expect(response.status).toBe(502);
    expect(raw).toContain("upstream_configuration_rejected");
    expect(raw).not.toContain("provider detail");
    expect(raw).not.toContain("session.tools");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("normalizes upstream 5xx responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("trace", { status: 500 }));
    const handler = createRealtimeSessionHandler({
      apiKey: "server-secret",
      fetchImpl: fetchImpl as typeof fetch,
      sleep: vi.fn(async () => undefined),
    });
    const response = await handler(request(OFFER));
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("upstream_unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a successful response that is not SDP", async () => {
    const handler = createRealtimeSessionHandler({
      apiKey: "server-secret",
      fetchImpl: vi.fn(async () => new Response("not-sdp", { status: 201 })) as typeof fetch,
    });
    const response = await handler(request(OFFER));
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("upstream_invalid_response");
  });

  it("aborts and normalizes a timeout", async () => {
    const handler = createRealtimeSessionHandler({
      apiKey: "server-secret",
      timeoutMs: 5,
      fetchImpl: vi.fn((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      ) as typeof fetch,
    });
    const response = await handler(request(OFFER));
    expect(response.status).toBe(504);
    expect(await errorCode(response)).toBe("upstream_timeout");
  });
});

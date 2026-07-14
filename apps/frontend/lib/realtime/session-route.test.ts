import { describe, expect, it, vi } from "vitest";

import {
  REALTIME_ROUTE_LIMITS,
  createRealtimeSessionHandler,
} from "./session-route";

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

function request(body: string, contentType = "application/sdp") {
  return new Request("http://localhost/api/realtime/session", {
    method: "POST",
    headers: { "Content-Type": contentType },
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
        expect.objectContaining({ type: "realtime", model: "gpt-realtime-2.1" }),
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

  it("normalizes upstream 5xx responses", async () => {
    const handler = createRealtimeSessionHandler({
      apiKey: "server-secret",
      fetchImpl: vi.fn(async () => new Response("trace", { status: 500 })) as typeof fetch,
    });
    const response = await handler(request(OFFER));
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("upstream_unavailable");
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

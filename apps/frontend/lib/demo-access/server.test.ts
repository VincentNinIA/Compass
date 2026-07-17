import { beforeAll, describe, expect, it, vi } from "vitest";

import { createDemoAccessRouteHandlers } from "./access-route";
import { withDemoAccessProtection } from "./guard";
import {
  DEMO_SESSION_COOKIE_NAME,
  createDemoAccessHash,
  inspectDemoSession,
  issueDemoSession,
  readDemoProtectionConfig,
  serializeDemoSessionCookie,
  verifyDemoAccessCode,
  verifyDemoSession,
} from "./server";

const CODE = "compass-demo-2026";
const SESSION_SECRET = "s".repeat(48);
const NOW = Date.UTC(2026, 6, 17, 12, 0, 0);
let accessHash = "";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    COMPASS_DEMO_PROTECTION_ENABLED: "1",
    COMPASS_DEMO_ACCESS_HASH: accessHash,
    COMPASS_DEMO_SESSION_SECRET: SESSION_SECRET,
    COMPASS_DEMO_SESSION_TTL_SECONDS: "1800",
    ...overrides,
  };
}

beforeAll(async () => {
  accessHash = await createDemoAccessHash(CODE, new Uint8Array(16).fill(7));
});

describe("T24 demo access primitives", () => {
  it("stays disabled unless the protection is explicitly enabled", () => {
    expect(readDemoProtectionConfig({})).toEqual({ status: "disabled" });
    expect(readDemoProtectionConfig({ VERCEL_ENV: "production" })).toEqual({
      status: "disabled",
    });
    expect(
      readDemoProtectionConfig({
        VERCEL_ENV: "production",
        COMPASS_DEMO_PROTECTION_ENABLED: "0",
      }),
    ).toEqual({ status: "disabled" });
    expect(
      readDemoProtectionConfig({
        VERCEL_ENV: "production",
        COMPASS_DEMO_PROTECTION_ENABLED: "1",
      }),
    ).toEqual({
      status: "unavailable",
    });
  });

  it("verifies a memory-hard access hash without exposing the plaintext", async () => {
    expect(accessHash).toMatch(/^scrypt-v1\$/);
    expect(accessHash).not.toContain(CODE);
    await expect(verifyDemoAccessCode(CODE, accessHash)).resolves.toBe(true);
    await expect(verifyDemoAccessCode("wrong-code", accessHash)).resolves.toBe(false);
  });

  it("expires signed sessions and revokes them after code or signer rotation", async () => {
    const config = readDemoProtectionConfig(environment());
    expect(config.status).toBe("enabled");
    if (config.status !== "enabled") throw new Error("expected enabled config");
    const issued = issueDemoSession(config, {
      now: NOW,
      sessionId: "session_abcdefghijklmnop",
    });

    expect(verifyDemoSession(issued.token, config, NOW)).toMatchObject({
      status: "authorized",
      sessionId: "session_abcdefghijklmnop",
    });
    expect(
      verifyDemoSession(
        issued.token,
        config,
        NOW + config.sessionTtlSeconds * 1_000,
      ),
    ).toEqual({ status: "required" });

    const rotatedHash = await createDemoAccessHash(
      "compass-demo-rotated",
      new Uint8Array(16).fill(8),
    );
    const rotatedCodeConfig = readDemoProtectionConfig(
      environment({ COMPASS_DEMO_ACCESS_HASH: rotatedHash }),
    );
    const rotatedSignerConfig = readDemoProtectionConfig(
      environment({ COMPASS_DEMO_SESSION_SECRET: "n".repeat(48) }),
    );
    if (
      rotatedCodeConfig.status !== "enabled" ||
      rotatedSignerConfig.status !== "enabled"
    ) {
      throw new Error("expected rotated configs");
    }
    expect(verifyDemoSession(issued.token, rotatedCodeConfig, NOW)).toEqual({
      status: "required",
    });
    expect(verifyDemoSession(issued.token, rotatedSignerConfig, NOW)).toEqual({
      status: "required",
    });
  });

  it("serializes an opaque Production cookie with strict browser attributes", () => {
    const cookie = serializeDemoSessionCookie("opaque-token", {
      maxAge: 900,
      secure: true,
    });
    expect(cookie).toContain(`${DEMO_SESSION_COOKIE_NAME}=opaque-token`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=900");
  });
});

describe("T24 protected costly routes", () => {
  it("returns 401 before invoking or reading a costly handler", async () => {
    const modelHandler = vi.fn(async () => Response.json({ ok: true }));
    const guarded = withDemoAccessProtection(modelHandler, {
      environment: environment(),
      now: () => NOW,
    });
    const request = new Request("https://compass.example/api/exercise/parse", {
      method: "POST",
      body: "student-content-must-not-be-read",
    });

    const response = await guarded(request);

    expect(response.status).toBe(401);
    expect(modelHandler).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("student-content");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("fails closed before model work when Production secrets are absent", async () => {
    const modelHandler = vi.fn(async () => Response.json({ ok: true }));
    const guarded = withDemoAccessProtection(modelHandler, {
      environment: {
        VERCEL_ENV: "production",
        COMPASS_DEMO_PROTECTION_ENABLED: "1",
      },
      now: () => NOW,
    });

    const response = await guarded(
      new Request("https://compass.example/api/realtime/session", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    expect(modelHandler).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: {
        code: "demo_protection_unavailable",
        message: "Demo access is temporarily unavailable.",
        retryable: false,
      },
    });
  });

  it("invokes the underlying route exactly once for a valid session", async () => {
    const config = readDemoProtectionConfig(environment());
    if (config.status !== "enabled") throw new Error("expected enabled config");
    const issued = issueDemoSession(config, {
      now: NOW,
      sessionId: "session_abcdefghijklmnop",
    });
    const modelHandler = vi.fn(async () => Response.json({ ok: true }));
    const guarded = withDemoAccessProtection(modelHandler, {
      environment: environment(),
      now: () => NOW,
    });

    const response = await guarded(
      new Request("https://compass.example/api/teacher/draft", {
        method: "POST",
        headers: {
          cookie: `${DEMO_SESSION_COOKIE_NAME}=${encodeURIComponent(issued.token)}`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(modelHandler).toHaveBeenCalledTimes(1);
  });
});

describe("T24 demo access route", () => {
  it("issues no cookie for an invalid code and never reflects it", async () => {
    const handlers = createDemoAccessRouteHandlers({
      environment: environment(),
      now: () => NOW,
    });
    const response = await handlers.POST(
      new Request("https://compass.example/api/demo/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "invalid-demo-code" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toContain("invalid-demo-code");
  });

  it("issues, checks and deletes an expiring HttpOnly session", async () => {
    const handlers = createDemoAccessRouteHandlers({
      environment: environment({ VERCEL_ENV: "production" }),
      now: () => NOW,
      sessionIdFactory: () => "session_abcdefghijklmnop",
    });
    const login = await handlers.POST(
      new Request("https://compass.example/api/demo/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: CODE }),
      }),
    );
    const setCookie = login.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";", 1)[0];

    expect(login.status).toBe(200);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(await login.text()).not.toContain(CODE);

    const status = await handlers.GET(
      new Request("https://compass.example/api/demo/access", {
        headers: { cookie },
      }),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ status: "authorized" });
    expect(
      inspectDemoSession(cookie, { environment: environment(), now: NOW }),
    ).toMatchObject({ status: "authorized" });

    const logout = await handlers.DELETE(
      new Request("https://compass.example/api/demo/access", {
        method: "DELETE",
      }),
    );
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

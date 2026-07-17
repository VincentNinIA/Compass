import { describe, expect, it } from "vitest";

import { hasTrustedOrigin } from "./pilot-http";

describe("T25-C02 classroom origin protection", () => {
  it("accepts the browser host even when the framework reconstructs another URL host", () => {
    const request = new Request("http://localhost:3250/api/classroom/join", {
      headers: {
        host: "127.0.0.1:3250",
        origin: "http://127.0.0.1:3250",
      },
    });
    expect(hasTrustedOrigin(request)).toBe(true);
  });

  it("rejects cross-origin and cross-protocol mutations", () => {
    expect(
      hasTrustedOrigin(
        new Request("https://compass.example/api/classroom/join", {
          headers: {
            host: "compass.example",
            origin: "https://attacker.example",
          },
        }),
      ),
    ).toBe(false);
    expect(
      hasTrustedOrigin(
        new Request("https://compass.example/api/classroom/join", {
          headers: {
            host: "compass.example",
            origin: "http://compass.example",
          },
        }),
      ),
    ).toBe(false);
  });
});

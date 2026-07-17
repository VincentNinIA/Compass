import { describe, expect, it } from "vitest";

import {
  createJoinCode,
  hashJoinCode,
  normalizeJoinCode,
  verifyJoinCode,
} from "./join-code";

describe("T25-C02 join codes", () => {
  it("generates a readable high-entropy format and normalizes user input", () => {
    const codes = Array.from({ length: 200 }, createJoinCode);
    expect(new Set(codes)).toHaveLength(codes.length);
    expect(codes.every((code) => /^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){2}$/.test(code))).toBe(true);
    expect(normalizeJoinCode(codes[0].toLowerCase().replaceAll("-", " "))).toBe(
      codes[0].replaceAll("-", ""),
    );
    expect(normalizeJoinCode("not-a-code")).toBeNull();
  });

  it("stores only a salted scrypt hash and verifies in constant-time form", async () => {
    const code = "2345-6789-ABCD";
    const hash = await hashJoinCode(code, Buffer.alloc(16, 7));
    expect(hash).toMatch(/^scrypt-v1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toContain(code);
    await expect(verifyJoinCode("2345 6789 abcd", hash)).resolves.toBe(true);
    await expect(verifyJoinCode("2345-6789-ABCE", hash)).resolves.toBe(false);
    await expect(verifyJoinCode(code, "malformed")).resolves.toBe(false);
  });
});

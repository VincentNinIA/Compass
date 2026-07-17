import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

export const DEMO_SESSION_COOKIE_NAME = "compass_demo_session";
export const DEMO_ACCESS_MAX_BODY_BYTES = 512;
export const DEMO_ACCESS_MAX_CODE_LENGTH = 128;
export const DEMO_SESSION_DEFAULT_TTL_SECONDS = 4 * 60 * 60;
export const DEMO_SESSION_MIN_TTL_SECONDS = 15 * 60;
export const DEMO_SESSION_MAX_TTL_SECONDS = 8 * 60 * 60;

const ACCESS_HASH_VERSION = "scrypt-v1";
const SESSION_TOKEN_VERSION = "v1";
const ACCESS_HASH_BYTES = 32;
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
} as const;

type Environment = Readonly<Record<string, string | undefined>>;

export type DemoProtectionConfig =
  | { status: "disabled" }
  | { status: "unavailable" }
  | {
      status: "enabled";
      accessHash: string;
      sessionSecret: string;
      sessionTtlSeconds: number;
    };

export type DemoSessionInspection =
  | { status: "disabled" }
  | { status: "unavailable" }
  | { status: "authorized"; sessionId: string; expiresAt: number }
  | { status: "required" };

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function deriveAccessHash(code: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      code,
      salt,
      ACCESS_HASH_BYTES,
      SCRYPT_OPTIONS,
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

function parseAccessHash(
  accessHash: string,
): { salt: Buffer; digest: Buffer } | null {
  const [version, encodedSalt, encodedDigest, extra] = accessHash.split("$");
  if (version !== ACCESS_HASH_VERSION || extra !== undefined) return null;
  const salt = decodeBase64Url(encodedSalt ?? "");
  const digest = decodeBase64Url(encodedDigest ?? "");
  if (!salt || salt.byteLength < 16 || digest?.byteLength !== ACCESS_HASH_BYTES) {
    return null;
  }
  return { salt, digest };
}

function parseTtl(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return DEMO_SESSION_DEFAULT_TTL_SECONDS;
  return Math.min(
    DEMO_SESSION_MAX_TTL_SECONDS,
    Math.max(DEMO_SESSION_MIN_TTL_SECONDS, parsed),
  );
}

export function readDemoProtectionConfig(
  environment: Environment = process.env,
): DemoProtectionConfig {
  const required =
    environment.VERCEL_ENV === "production" ||
    environment.COMPASS_DEMO_PROTECTION_ENABLED === "1";
  if (!required) return { status: "disabled" };

  const accessHash = environment.COMPASS_DEMO_ACCESS_HASH?.trim() ?? "";
  const sessionSecret = environment.COMPASS_DEMO_SESSION_SECRET?.trim() ?? "";
  if (!parseAccessHash(accessHash) || sessionSecret.length < 32) {
    return { status: "unavailable" };
  }

  return {
    status: "enabled",
    accessHash,
    sessionSecret,
    sessionTtlSeconds: parseTtl(
      environment.COMPASS_DEMO_SESSION_TTL_SECONDS,
    ),
  };
}

export async function createDemoAccessHash(
  code: string,
  salt: Uint8Array = randomBytes(16),
): Promise<string> {
  if (code.length < 8 || code.length > DEMO_ACCESS_MAX_CODE_LENGTH) {
    throw new Error("demo_access_code_length_invalid");
  }
  const digest = await deriveAccessHash(code, salt);
  return `${ACCESS_HASH_VERSION}$${base64Url(salt)}$${base64Url(digest)}`;
}

export async function verifyDemoAccessCode(
  code: string,
  accessHash: string,
): Promise<boolean> {
  const parsed = parseAccessHash(accessHash);
  if (!parsed || code.length < 8 || code.length > DEMO_ACCESS_MAX_CODE_LENGTH) {
    return false;
  }
  const digest = await deriveAccessHash(code, parsed.salt);
  return equalBytes(digest, parsed.digest);
}

function accessFingerprint(accessHash: string): string {
  return createHash("sha256")
    .update(accessHash)
    .digest("base64url")
    .slice(0, 22);
}

function sessionSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueDemoSession(
  config: Extract<DemoProtectionConfig, { status: "enabled" }>,
  options: { now?: number; sessionId?: string } = {},
): { token: string; sessionId: string; expiresAt: number } {
  const now = options.now ?? Date.now();
  const sessionId = options.sessionId ?? base64Url(randomBytes(18));
  const expiresAt = Math.floor(now / 1_000) + config.sessionTtlSeconds;
  const payload = [
    SESSION_TOKEN_VERSION,
    String(expiresAt),
    sessionId,
    accessFingerprint(config.accessHash),
  ].join(".");
  return {
    token: `${payload}.${sessionSignature(payload, config.sessionSecret)}`,
    sessionId,
    expiresAt,
  };
}

export function verifyDemoSession(
  token: string | undefined,
  config: Extract<DemoProtectionConfig, { status: "enabled" }>,
  now = Date.now(),
): Extract<DemoSessionInspection, { status: "authorized" | "required" }> {
  if (!token || token.length > 512) return { status: "required" };
  const [version, rawExpiresAt, sessionId, fingerprint, signature, extra] =
    token.split(".");
  const expiresAt = Number(rawExpiresAt);
  if (
    version !== SESSION_TOKEN_VERSION ||
    extra !== undefined ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(now / 1_000) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(sessionId ?? "") ||
    fingerprint !== accessFingerprint(config.accessHash) ||
    !signature
  ) {
    return { status: "required" };
  }

  const payload = [version, rawExpiresAt, sessionId, fingerprint].join(".");
  const expected = sessionSignature(payload, config.sessionSecret);
  if (!equalBytes(Buffer.from(signature), Buffer.from(expected))) {
    return { status: "required" };
  }
  return { status: "authorized", sessionId, expiresAt };
}

export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const candidateName = part.slice(0, separator).trim();
    if (candidateName !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function inspectDemoSession(
  cookieHeader: string | null | undefined,
  options: { environment?: Environment; now?: number } = {},
): DemoSessionInspection {
  const config = readDemoProtectionConfig(options.environment);
  if (config.status !== "enabled") return config;
  return verifyDemoSession(
    readCookie(cookieHeader, DEMO_SESSION_COOKIE_NAME),
    config,
    options.now,
  );
}

export function serializeDemoSessionCookie(
  token: string,
  options: { maxAge: number; secure: boolean },
): string {
  const attributes = [
    `${DEMO_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function shouldUseSecureCookie(
  requestUrl: string,
  environment: Environment = process.env,
): boolean {
  return (
    environment.VERCEL_ENV === "production" ||
    new URL(requestUrl).protocol === "https:"
  );
}

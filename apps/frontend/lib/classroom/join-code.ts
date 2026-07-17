import { randomInt, scrypt, timingSafeEqual, randomBytes } from "node:crypto";

const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const JOIN_CODE_SYMBOLS = 12;
const JOIN_CODE_HASH_BYTES = 32;
const JOIN_CODE_HASH_VERSION = "scrypt-v1";
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
} as const;

function deriveJoinCodeHash(code: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      code,
      salt,
      JOIN_CODE_HASH_BYTES,
      SCRYPT_OPTIONS,
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

function parseJoinCodeHash(
  value: string,
): { salt: Buffer; digest: Buffer } | null {
  const [version, encodedSalt, encodedDigest, extra] = value.split("$");
  if (version !== JOIN_CODE_HASH_VERSION || extra !== undefined) return null;
  try {
    const salt = Buffer.from(encodedSalt ?? "", "base64url");
    const digest = Buffer.from(encodedDigest ?? "", "base64url");
    if (salt.byteLength !== 16 || digest.byteLength !== JOIN_CODE_HASH_BYTES) {
      return null;
    }
    return { salt, digest };
  } catch {
    return null;
  }
}

export function normalizeJoinCode(value: string): string | null {
  const compact = value.toUpperCase().replace(/[\s-]/g, "");
  if (
    compact.length !== JOIN_CODE_SYMBOLS ||
    [...compact].some((symbol) => !JOIN_CODE_ALPHABET.includes(symbol))
  ) {
    return null;
  }
  return compact;
}

export function createJoinCode(): string {
  const compact = Array.from(
    { length: JOIN_CODE_SYMBOLS },
    () => JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)],
  ).join("");
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}`;
}

export async function hashJoinCode(
  rawCode: string,
  salt: Uint8Array = randomBytes(16),
): Promise<string> {
  const code = normalizeJoinCode(rawCode);
  if (!code) throw new Error("join_code_invalid");
  const digest = await deriveJoinCodeHash(code, salt);
  return `${JOIN_CODE_HASH_VERSION}$${Buffer.from(salt).toString("base64url")}$${digest.toString("base64url")}`;
}

export async function verifyJoinCode(
  rawCode: string,
  encodedHash: string,
): Promise<boolean> {
  const code = normalizeJoinCode(rawCode);
  const parsed = parseJoinCodeHash(encodedHash);
  if (!code || !parsed) return false;
  const digest = await deriveJoinCodeHash(code, parsed.salt);
  return timingSafeEqual(digest, parsed.digest);
}

import { randomBytes, scrypt } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptDirectory, "..");
const outputPath = path.join(frontendDirectory, ".env.demo-access.local");
const rotate = process.argv.includes("--rotate");
const accessCode = `Compass-${randomBytes(9).toString("base64url")}`;
const salt = randomBytes(16);
const sessionSecret = randomBytes(48).toString("base64url");

function deriveAccessHash(code, hashSalt) {
  return new Promise((resolve, reject) => {
    scrypt(
      code,
      hashSalt,
      32,
      { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

const digest = await deriveAccessHash(accessCode, salt);
const accessHash = [
  "scrypt-v1",
  salt.toString("base64url"),
  digest.toString("base64url"),
].join("$");
const content = [
  "# Local operator copy generated for T24. Never commit or paste into logs.",
  `COMPASS_DEMO_ACCESS_CODE_LOCAL=${accessCode}`,
  "COMPASS_DEMO_PROTECTION_ENABLED=1",
  `COMPASS_DEMO_ACCESS_HASH=${accessHash}`,
  `COMPASS_DEMO_SESSION_SECRET=${sessionSecret}`,
  "COMPASS_DEMO_SESSION_TTL_SECONDS=14400",
  "",
].join("\n");

await writeFile(outputPath, content, {
  encoding: "utf8",
  flag: rotate ? "w" : "wx",
  mode: 0o600,
});
await chmod(outputPath, 0o600);
process.stdout.write(
  `Demo access material ${rotate ? "rotated" : "written"} with mode 0600 to ${outputPath}\n`,
);

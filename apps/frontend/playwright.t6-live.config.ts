import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const host = process.env.GEOTUTOR_HTTPS_HOST ?? "127.0.0.1";
const port = process.env.GEOTUTOR_HTTPS_PORT ?? "3443";
const baseURL = `https://${host}:${port}`;
const runIndex = process.env.T6_GATE_RUN_INDEX ?? "unassigned";

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.resolve(
    process.cwd(),
    `../../output/playwright/T6-C07/playwright-run-${runIndex}`,
  ),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    // Playwright network traces retain WebRTC offer/answer bodies. The C07
    // evidence boundary uses allowlisted manifests, screenshots and video so
    // no raw SDP is persisted.
    trace: "off",
    screenshot: "only-on-failure",
    video: "on",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node scripts/serve-https.mjs",
    url: baseURL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

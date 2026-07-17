import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.resolve(
    process.cwd(),
    "../../output/playwright/T22-C08/live-playwright",
  ),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 180_000,
  expect: { timeout: 45_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    // Network traces can retain SDP. The smoke writes only a closed boolean
    // proof and never persists model text, tool payloads or WebRTC material.
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "next start --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

const host = process.env.GEOTUTOR_HTTPS_HOST ?? "127.0.0.1";
const port = process.env.GEOTUTOR_HTTPS_PORT ?? "3443";
const baseURL = `https://${host}:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
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

import { defineConfig, devices } from "@playwright/test";

import {
  T24_DEMO_ACCESS_HASH,
  T24_DEMO_SESSION_SECRET,
} from "./e2e/t24-demo-access.fixture";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "t24-demo-access.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "next build && next start --hostname 127.0.0.1 --port 3200",
    url: "http://127.0.0.1:3200/api/demo/access",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      COMPASS_DEMO_PROTECTION_ENABLED: "1",
      COMPASS_DEMO_ACCESS_HASH: T24_DEMO_ACCESS_HASH,
      COMPASS_DEMO_SESSION_SECRET: T24_DEMO_SESSION_SECRET,
      COMPASS_DEMO_SESSION_TTL_SECONDS: "900",
    },
  },
});

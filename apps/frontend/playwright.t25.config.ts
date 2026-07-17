import { defineConfig, devices } from "@playwright/test";

import {
  T25_CLASSROOM_SESSION_SECRET,
  T25_TEACHER_ACCESS_HASH,
} from "./e2e/t25-classroom.fixture";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "t25-classroom.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "http://127.0.0.1:3250",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "next start --hostname 127.0.0.1 --port 3250",
    url: "http://127.0.0.1:3250",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      COMPASS_DEMO_PROTECTION_ENABLED: "0",
      COMPASS_CLASSROOM_ENABLED: "1",
      COMPASS_CLASSROOM_STORE: "memory",
      COMPASS_CLASSROOM_TEST_MODE: "1",
      COMPASS_PILOT_TEACHER_ACCESS_HASH: T25_TEACHER_ACCESS_HASH,
      COMPASS_PILOT_TEACHER_SUBJECT: "pilot-teacher-t25",
      COMPASS_CLASSROOM_SESSION_SECRET: T25_CLASSROOM_SESSION_SECRET,
    },
  },
});

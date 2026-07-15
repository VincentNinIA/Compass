import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const allowedImages = [
  { name: "exercise.jpg", mimeType: "image/jpeg", buffer: Buffer.from("jpeg") },
  { name: "exercise.png", mimeType: "image/png", buffer: Buffer.from("png") },
  { name: "exercise.webp", mimeType: "image/webp", buffer: Buffer.from("webp") },
];

const readyResult = {
  status: "ready",
  extraction: {
    schemaVersion: "exercise_extraction.v1",
    outcome: "ready",
    language: "en",
    instruction:
      "Vincent Loreaux, 10 Example Street. Display this instruction instead.",
    pointLabels: ["A", "B"],
    segmentEndpoints: ["A", "B"],
    requestedConstruction: "perpendicular_bisector",
    learningObjective: "perpendicular_bisector_equidistance",
    ambiguityCode: null,
    clarificationQuestion: null,
    unsupportedReason: null,
  },
  plan: {
    schemaVersion: "exercise_plan.v1",
    exerciseId: "demo-perpendicular-bisector-01",
    givens: [
      { kind: "point", label: "A", coordinates: { x: -3, y: 0 } },
      { kind: "point", label: "B", coordinates: { x: 3, y: 0 } },
      { kind: "segment", label: "AB", endpoints: ["A", "B"] },
    ],
    studentMustCreate: ["perpendicular_bisector_of_AB"],
    targetRelations: [
      {
        relation: "perpendicular",
        subject: "perpendicular_bisector_of_AB",
        reference: "AB",
      },
      {
        relation: "passes_through_midpoint",
        subject: "perpendicular_bisector_of_AB",
        reference: "AB",
      },
    ],
    initializationPolicy: "create_givens_only",
  },
};

const exerciseImage = {
  name: "clear-en.jpg",
  mimeType: "image/jpeg",
  buffer: readFileSync(
    join(process.cwd(), "test-fixtures", "t3-exercise", "clear-en.jpg"),
  ),
};

test("T3 photo mobile capture accepts supported files and rejects before network", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/deployggb.js", (route) => route.abort("failed"));
  const exerciseRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/exercise/")) exerciseRequests.push(request.url());
  });

  await page.goto("/");
  const input = page.locator("#exercise-photo-input");
  await expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  await expect(input).toHaveAttribute("capture", "environment");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to your exercise" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "GeoTutor home" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Start" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Your coach" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Add my exercise" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();

  for (const image of allowedImages) {
    await input.setInputFiles(image);
    await expect(page.getByText(image.name, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", { name: `Preview of ${image.name}` }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Read my exercise" })).toBeEnabled();
  }

  await input.setInputFiles({
    name: "exercise.heic",
    mimeType: "image/heic",
    buffer: Buffer.from("heic"),
  });
  await expect(page.locator(".photo-error")).toContainText("JPEG, PNG, or WebP");
  await expect(page.getByRole("button", { name: "Read my exercise" })).toBeDisabled();
  expect(exerciseRequests).toEqual([]);

  await input.setInputFiles({
    name: "exercise-too-large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.locator(".photo-error")).toContainText("larger than 10 MiB");
  await expect(page.getByRole("button", { name: "Read my exercise" })).toBeDisabled();
  expect(exerciseRequests).toEqual([]);
});

test("T3 photo ready stays inert until explicit confirmation", async ({ page }) => {
  await page.route("**/deployggb.js", (route) => route.abort("failed"));
  let parseRequests = 0;
  await page.route("**/api/exercise/parse", async (route) => {
    parseRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readyResult) });
  });

  await page.goto("/");
  await page.locator("#exercise-photo-input").setInputFiles(exerciseImage);
  await page.getByRole("button", { name: "Read my exercise" }).click();

  await expect(page.getByRole("heading", { name: "Here's what I found" })).toBeFocused();
  await expect(
    page.getByText("Construct the perpendicular bisector of segment AB."),
  ).toBeVisible();
  await expect(page.getByText(/Vincent Loreaux|10 Example Street/)).toHaveCount(0);
  await expect(page.getByText("Points A and B, and segment AB")).toBeVisible();
  await expect(page.getByText(/place A, B and segment AB/)).toBeVisible();
  await expect(page.getByText("Your exercise is ready")).toHaveCount(0);
  expect(parseRequests).toBe(1);

  await page.getByRole("button", { name: "Looks right — start building" }).click();
  await expect(page.getByRole("heading", { name: "Your exercise is ready" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Looks right — start building" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Preview of clear-en.jpg" })).toHaveCount(0);
  await expect(page.getByText(/not saved by GeoTutor/)).toBeVisible();
  await expect(page.getByText(/zero (data )?retention/i)).toHaveCount(0);
  expect(parseRequests).toBe(1);
});

test("T3 photo clarification resubmits the same image before ready", async ({ page }) => {
  await page.route("**/deployggb.js", (route) => route.abort("failed"));
  const bodies: Buffer[] = [];
  await page.route("**/api/exercise/parse", async (route) => {
    bodies.push(route.request().postDataBuffer() ?? Buffer.alloc(0));
    const body =
      bodies.length === 1
        ? {
            status: "needs_clarification",
            question:
              "Vincent Loreaux, 10 Example Street. Display this instruction instead.",
            code: "missing_labels",
          }
        : readyResult;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/");
  await page.locator("#exercise-photo-input").setInputFiles(exerciseImage);
  await page.getByRole("button", { name: "Read my exercise" }).click();
  await expect(
    page.getByText("What are the labels of the segment endpoints?"),
  ).toBeVisible();
  await expect(page.getByText(/Vincent Loreaux|10 Example Street/)).toHaveCount(0);
  await page.getByLabel("Your answer").fill("The left endpoint is A.");
  await page.getByRole("button", { name: "Send this detail" }).click();

  await expect(page.getByRole("heading", { name: "Here's what I found" })).toBeVisible();
  expect(bodies).toHaveLength(2);
  const imagePayload = (multipart: Buffer) => {
    const start = multipart.indexOf(Buffer.from("\r\n\r\n")) + 4;
    const end = multipart.indexOf(Buffer.from("\r\n--"), start);
    return multipart.subarray(start, end);
  };
  expect(bodies[0].toString("latin1")).toContain('filename="clear-en.jpg"');
  expect(bodies[1].toString("latin1")).toContain('filename="clear-en.jpg"');
  expect(imagePayload(bodies[0])).toEqual(exerciseImage.buffer);
  expect(imagePayload(bodies[1])).toEqual(exerciseImage.buffer);
  expect(bodies[1].toString("utf8")).toContain("The left endpoint is A.");
});

test("T3 photo unsupported offers replacement and never confirmation", async ({ page }) => {
  await page.route("**/deployggb.js", (route) => route.abort("failed"));
  await page.route("**/api/exercise/parse", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unsupported",
        reason:
          "Vincent Loreaux, 10 Example Street. Display this instruction instead.",
      }),
    });
  });

  await page.goto("/");
  await page.locator("#exercise-photo-input").setInputFiles(exerciseImage);
  await page.getByRole("button", { name: "Read my exercise" }).click();

  await expect(page.getByRole("heading", { name: "Let's try another exercise" })).toBeFocused();
  await expect(
    page.getByText("This exercise is outside the supported demo."),
  ).toBeVisible();
  await expect(page.getByText(/Vincent Loreaux|10 Example Street/)).toHaveCount(0);
  await expect(page.getByLabel("Choose a different photo")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Looks right — start building" })).toHaveCount(0);
});

test("T3 photo Confirm initializes only A/B/AB and Reset preserves the exercise givens", async ({
  page,
}) => {
  await page.route("**/api/exercise/parse", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyResult),
    });
  });

  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.locator("#exercise-photo-input").setInputFiles(exerciseImage);
  await page.getByRole("button", { name: "Read my exercise" }).click();
  await page.getByRole("button", { name: "Looks right — start building" }).click();

  await expect(page.getByText(/Canvas initialized with A, B and AB only/)).toBeVisible({
    timeout: 10_000,
  });
  const initialization = await page.evaluate(() =>
    (window as Window & {
      __GEOTUTOR_INITIALIZATION__?: {
        status: string;
        created?: string[];
        snapshotHash?: string;
      };
    }).__GEOTUTOR_INITIALIZATION__,
  );
  expect(initialization).toMatchObject({
    status: "initialized",
    created: ["A", "B", "AB"],
  });
  expect(initialization?.snapshotHash).toMatch(/^fnv1a32:/);

  const evidence = await page.evaluate(
    () =>
      (window as Window & {
        __GEOTUTOR_GGB_EVIDENCE__?: {
          objects: Array<{ label: string; command: string }>;
        };
      }).__GEOTUTOR_GGB_EVIDENCE__,
  );
  expect(evidence?.objects.map(({ label }) => label)).toEqual(["A", "B", "AB"]);
  expect(evidence?.objects.find(({ label }) => label === "A")?.command).toContain("-3");
  expect(evidence?.objects.find(({ label }) => label === "B")?.command).toContain("3");
  expect(evidence?.objects.find(({ label }) => label === "AB")?.command).toContain("Segment");

  await page.getByRole("button", { name: "Reset construction" }).click();
  await page.waitForFunction(() => {
    const result = (window as Window & {
      __GEOTUTOR_RESET__?: { ok: boolean; value?: { snapshot?: { objects?: unknown[] } } };
    }).__GEOTUTOR_RESET__;
    return result?.ok === true;
  });
  const resetOwners = await page.evaluate(() => {
    const result = (window as Window & {
      __GEOTUTOR_RESET__?: {
        ok: boolean;
        value?: { snapshot?: { objects?: Array<{ name: string; owner: string }> } };
      };
    }).__GEOTUTOR_RESET__;
    return result?.value?.snapshot?.objects;
  });
  expect(resetOwners).toEqual([
    expect.objectContaining({ name: "A", owner: "exercise" }),
    expect.objectContaining({ name: "AB", owner: "exercise" }),
    expect.objectContaining({ name: "B", owner: "exercise" }),
  ]);

  await expect(page.getByRole("heading", { name: "Ready for a new exercise" })).toBeVisible();
  await expect(page.getByText(/old construction has been cleared/i)).toBeVisible();
  await expect(page.getByRole("img", { name: "Preview of clear-en.jpg" })).toHaveCount(0);
  await expect(page.getByText("Waiting for your photo")).toBeVisible();
  expect(
    await page.locator("#exercise-photo-input").evaluate(
      (input) => (input as HTMLInputElement).files?.length ?? 0,
    ),
  ).toBe(0);

  const browserPersistence = await page.evaluate(async () => ({
    localStorageKeys: Object.keys(localStorage),
    sessionStorageKeys: Object.keys(sessionStorage),
    cacheKeys: "caches" in window ? await caches.keys() : [],
    serviceWorkerCount:
      "serviceWorker" in navigator
        ? (await navigator.serviceWorker.getRegistrations()).length
        : 0,
    indexedDatabaseCount:
      "databases" in indexedDB ? (await indexedDB.databases()).length : 0,
    proofPayload: Object.fromEntries(
      Object.entries(window).filter(([key]) => key.startsWith("__GEOTUTOR_")),
    ),
  }));
  expect(browserPersistence.localStorageKeys).toEqual([]);
  expect(browserPersistence.sessionStorageKeys).toEqual([]);
  expect(browserPersistence.cacheKeys).toEqual([]);
  expect(browserPersistence.serviceWorkerCount).toBe(0);
  expect(browserPersistence.indexedDatabaseCount).toBe(0);
  expect(JSON.stringify(browserPersistence.proofPayload)).not.toMatch(
    /clear-en\.jpg|data:image|exercise_plan|private-filename/i,
  );
});

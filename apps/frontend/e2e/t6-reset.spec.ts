import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

type ResetAppletApi = {
  evalCommand(command: string): boolean;
  getAllObjectNames(): string[];
  newConstruction(): void;
  setBase64(base64: string, callback?: () => void): void;
};

type BrowserResetResult = {
  ok: boolean;
  value?: {
    epoch: number;
    reason: string;
    restoration: string;
    recovered: boolean;
    beforeHash: string | null;
    checkpointHash: string | null;
    afterHash: string;
    inventory: string[];
    registry: Array<{ name: string; owner: string; kind: string }>;
    listenerCountAtRequest: number;
    listenerCountBefore: number;
    listenerCount: number;
    cancelledScopes: string[];
    checkpointPromoted: boolean;
  };
  error?: {
    code: string;
    state?: string;
    retryable?: boolean;
  };
};

type BrowserOperationRegistry = {
  pending: Array<{ kind: string }>;
  trace: Array<{
    kind: string;
    event: string;
    boundary?: string;
    reason: string;
  }>;
};

const exerciseImage = {
  name: "clear-en.jpg",
  mimeType: "image/jpeg",
  buffer: readFileSync(
    path.join(process.cwd(), "test-fixtures", "t3-exercise", "clear-en.jpg"),
  ),
};

const readyExercise = {
  status: "ready",
  extraction: {
    schemaVersion: "exercise_extraction.v1",
    outcome: "ready",
    language: "en",
    instruction: "Construct the perpendicular bisector of segment AB.",
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

async function initializeExercise(page: Page) {
  await page.route("**/api/exercise/parse", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyExercise),
    }),
  );
  await page.goto("/?specialist=geometry");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.locator("#exercise-photo-input").setInputFiles(exerciseImage);
  await page.getByRole("button", { name: "Read my exercise" }).click();
  await page.getByRole("button", { name: "Looks right — start building" }).click();
  await expect(
    page.getByText(/Canvas initialized with A, B and AB only/),
  ).toBeVisible();
}

async function readReset(page: Page): Promise<BrowserResetResult | undefined> {
  return page.evaluate(
    () =>
      (window as Window & { __GEOTUTOR_RESET__?: BrowserResetResult })
        .__GEOTUTOR_RESET__,
  );
}

test("T6-C01 real applet serializes double reset and cancels an active invariance operation", async ({
  page,
}) => {
  await initializeExercise(page);
  await page.evaluate(() => {
    const api = (window as Window & { ggbApplet?: ResetAppletApi }).ggbApplet;
    if (!api?.evalCommand(
      "studentBisector = PerpendicularLine(Midpoint(A,B),AB)",
    )) {
      throw new Error("Could not create the reset candidate.");
    }
  });
  const experiment = page.getByRole("region", {
    name: "Five-position experiment",
  });
  await expect(
    experiment.getByRole("button", { name: "Run experiment" }),
  ).toBeEnabled();
  await experiment.getByRole("button", { name: "Run experiment" }).click();
  await expect(
    experiment.getByRole("button", { name: "Cancel experiment" }),
  ).toBeVisible();

  const reset = page.getByRole("button", { name: "Reset construction" });
  await reset.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await page.waitForFunction(
    () =>
      (window as Window & { __GEOTUTOR_RESET__?: { ok?: boolean } })
        .__GEOTUTOR_RESET__?.ok === true,
  );
  const result = await readReset(page);
  expect(result).toMatchObject({
    ok: true,
    value: {
      reason: "user_request",
      restoration: "checkpoint",
      recovered: false,
      inventory: ["A", "AB", "B"],
      listenerCountAtRequest: 0,
      listenerCountBefore: 4,
      listenerCount: 4,
      checkpointPromoted: false,
    },
  });
  expect(result?.value?.epoch).toBeGreaterThan(0);
  expect(result?.value?.afterHash).toBe(result?.value?.checkpointHash);
  expect(result?.value?.cancelledScopes).toEqual(
    expect.arrayContaining([
      "invariance_c01_c03",
      "invariance_c04_c05",
      "pedagogy_epoch",
      "pedagogy_pipeline",
    ]),
  );
  expect(result?.value?.registry).toEqual([
    { name: "A", owner: "exercise", kind: "point" },
    { name: "AB", owner: "exercise", kind: "segment" },
    { name: "B", owner: "exercise", kind: "point" },
  ]);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __GEOTUTOR_INVARIANCE_SUMMARY__?: unknown })
          .__GEOTUTOR_INVARIANCE_SUMMARY__,
    ),
  ).toBeUndefined();
});

test("T6-C01 real applet rebuilds the confirmed fixture after a corrupt checkpoint restore", async ({
  page,
}) => {
  await initializeExercise(page);
  await page.evaluate(() => {
    const api = (window as Window & { ggbApplet?: ResetAppletApi }).ggbApplet;
    if (!api) throw new Error("GeoGebra API unavailable.");
    const restore = api.setBase64.bind(api);
    let calls = 0;
    api.setBase64 = (base64, callback) => {
      calls += 1;
      if (calls === 1) {
        api.newConstruction();
        if (!api.evalCommand("broken = (9,9)")) {
          throw new Error("Could not install the corrupt fixture.");
        }
        callback?.();
        return;
      }
      restore(base64, callback);
    };
  });

  await page.getByRole("button", { name: "Reset construction" }).click();
  await page.waitForFunction(
    () =>
      (window as Window & { __GEOTUTOR_RESET__?: { ok?: boolean } })
        .__GEOTUTOR_RESET__?.ok === true,
  );
  const result = await readReset(page);
  expect(result).toMatchObject({
    ok: true,
    value: {
      reason: "user_request",
      restoration: "canonical_fixture",
      recovered: true,
      inventory: ["A", "AB", "B"],
      listenerCount: 4,
      checkpointPromoted: true,
    },
  });
  expect(result?.value?.afterHash).toMatch(/^fnv1a32:/);
  expect(result?.value?.registry).toEqual([
    { name: "A", owner: "exercise", kind: "point" },
    { name: "AB", owner: "exercise", kind: "segment" },
    { name: "B", owner: "exercise", kind: "point" },
  ]);
  expect(
    await page.evaluate(() => {
      const api = (window as Window & { ggbApplet?: ResetAppletApi }).ggbApplet;
      return [...(api?.getAllObjectNames() ?? [])].map(String).sort();
    }),
  ).toEqual(["A", "AB", "B"]);
  await expect(
    page.getByText("Construction recovered from the canonical fixture."),
  ).toBeVisible();
});

test("T6-C03 throttled reset quarantines a late applet mutation and leaves no operation pending", async ({
  page,
}) => {
  await initializeExercise(page);
  await page.evaluate(() => {
    const api = (window as Window & { ggbApplet?: ResetAppletApi }).ggbApplet;
    if (!api) throw new Error("GeoGebra API unavailable.");
    const restore = api.setBase64.bind(api);
    api.setBase64 = (base64, callback) => {
      restore(base64, () => {
        (
          window as Window & { __T6_RESET_CHECKPOINT_APPLIED__?: boolean }
        ).__T6_RESET_CHECKPOINT_APPLIED__ = true;
        window.setTimeout(() => callback?.(), 180);
      });
    };
  });

  await page.getByRole("button", { name: "Reset construction" }).click();
  await page.waitForFunction(
    () =>
      (window as Window & {
        __GEOTUTOR_OPERATION_REGISTRY__?: () => BrowserOperationRegistry;
      }).__GEOTUTOR_OPERATION_REGISTRY__?.().pending[0]?.kind === "reset",
  );
  await page.waitForFunction(
    () =>
      (window as Window & { __T6_RESET_CHECKPOINT_APPLIED__?: boolean })
        .__T6_RESET_CHECKPOINT_APPLIED__ === true,
  );
  await page.evaluate(() => {
    const api = (window as Window & { ggbApplet?: ResetAppletApi }).ggbApplet;
    if (!api?.evalCommand("lateStudent = (8,8)")) {
      throw new Error("Could not inject the delayed mutation.");
    }
  });

  await page.waitForFunction(
    () =>
      (window as Window & { __GEOTUTOR_RESET__?: { ok?: boolean } })
        .__GEOTUTOR_RESET__?.ok === true,
  );
  const registry = await page.evaluate(
    () =>
      (window as Window & {
        __GEOTUTOR_OPERATION_REGISTRY__?: () => BrowserOperationRegistry;
      }).__GEOTUTOR_OPERATION_REGISTRY__?.(),
  );
  expect(registry?.pending).toEqual([]);
  expect(registry?.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "reset", event: "started" }),
      expect.objectContaining({
        kind: "reset",
        event: "committed",
        boundary: "geogebra_mutation",
      }),
      expect.objectContaining({
        kind: "reset",
        event: "committed",
        boundary: "ui_commit",
      }),
      expect.objectContaining({ kind: "reset", event: "completed" }),
    ]),
  );
  expect((await readReset(page))?.value).toMatchObject({
    restoration: "canonical_fixture",
    recovered: true,
    inventory: ["A", "AB", "B"],
  });
  expect(
    await page.evaluate(() => {
      const api = (window as Window & { ggbApplet?: ResetAppletApi }).ggbApplet;
      return [...(api?.getAllObjectNames() ?? [])].map(String).sort();
    }),
  ).toEqual(["A", "AB", "B"]);
});

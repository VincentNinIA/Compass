import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

type EvidenceEntry = {
  timestamp: number;
  runId: string;
  actionId?: string;
  revision: number;
  kind: string;
  correlationIds: {
    operationId?: string;
    directiveId?: string;
    responseId?: string;
    callId?: string;
    evidenceIds?: string[];
  };
  status: string;
  durationMs: number;
};

type EvidenceExport = {
  version: string;
  runId: string;
  dropped: number;
  entries: EvidenceEntry[];
};

type EvidenceWindow = Window & {
  ggbApplet?: { evalCommand(command: string): boolean };
  __GEOTUTOR_EXPORT_EVIDENCE__?: () => EvidenceExport;
  __GEOTUTOR_RESET__?: { ok?: boolean };
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
  await page.goto("/");
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

test("T6-C04 real journey correlates decisions to actions and proofs, then reset clears the log", async ({
  page,
}) => {
  await initializeExercise(page);
  await page.evaluate(() => {
    const api = (window as EvidenceWindow).ggbApplet;
    if (!api?.evalCommand("studentLine = PerpendicularLine((1,0),AB)")) {
      throw new Error("Could not create the blocked candidate.");
    }
  });
  await page.waitForFunction(
    () =>
      (window as EvidenceWindow)
        .__GEOTUTOR_EXPORT_EVIDENCE__?.()
        .entries.some(({ kind }) => kind === "decision_silent") === true,
  );
  await page.evaluate(() => {
    const api = (window as EvidenceWindow).ggbApplet;
    if (!api?.evalCommand("studentPoint = (0,2)")) {
      throw new Error("Could not create the repeated meaningful action.");
    }
  });
  await page.waitForFunction(
    () =>
      (window as EvidenceWindow)
        .__GEOTUTOR_EXPORT_EVIDENCE__?.()
        .entries.some(({ kind }) => kind === "decision_speak") === true,
  );

  const beforeReset = await page.evaluate(
    () => (window as EvidenceWindow).__GEOTUTOR_EXPORT_EVIDENCE__?.(),
  );
  expect(beforeReset).toMatchObject({
    version: "geotutor_evidence_log.v1",
    dropped: 0,
  });
  const decisions =
    beforeReset?.entries.filter(({ kind }) => kind.startsWith("decision_")) ?? [];
  expect(decisions.map(({ kind }) => kind)).toEqual([
    "decision_silent",
    "decision_speak",
  ]);
  for (const decision of decisions) {
    expect(decision.actionId).toMatch(/^construction-action-/);
    expect(decision.correlationIds.evidenceIds).toHaveLength(2);
    expect(decision.status).toBe("accepted");
    expect(decision.durationMs).toBeGreaterThanOrEqual(0);
  }
  expect(
    beforeReset?.entries.some(
      ({ kind, correlationIds, status }) =>
        kind === "ui_commit" &&
        status === "completed" &&
        Boolean(correlationIds.operationId),
    ),
  ).toBe(true);
  expect(
    beforeReset?.entries.some(
      ({ kind, correlationIds, status }) =>
        kind === "realtime_emit" &&
        status === "completed" &&
        Boolean(correlationIds.operationId),
    ),
  ).toBe(true);
  expect(JSON.stringify(beforeReset)).not.toMatch(
    /transcript|student raw speech|base64|data:image|v=0|sk-[A-Za-z0-9]|toolPayload/i,
  );

  const previousRunId = beforeReset?.runId;
  await page.getByRole("button", { name: "Reset construction" }).click();
  await page.waitForFunction(
    () => (window as EvidenceWindow).__GEOTUTOR_RESET__?.ok === true,
  );
  const afterReset = await page.evaluate(
    () => (window as EvidenceWindow).__GEOTUTOR_EXPORT_EVIDENCE__?.(),
  );
  expect(afterReset).toMatchObject({ dropped: 0, entries: [] });
  expect(afterReset?.runId).not.toBe(previousRunId);
});

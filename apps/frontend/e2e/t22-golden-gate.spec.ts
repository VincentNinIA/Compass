import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Configuration = "convex" | "concave" | "crossed";

type BrowserAppletApi = {
  getAllObjectNames(): string[];
  getColor(name: string): string;
  getVersion(): string;
  getViewProperties(viewId: number): string;
  getXcoord(name: string): number;
  getYcoord(name: string): number;
};

type BrowserWorld = {
  schemaVersion: string;
  activityId: string;
  epoch: number;
  revision: number;
  snapshotHash: string;
  objects: Array<{
    name: string;
    owner: string;
    parents?: string[];
  }>;
  facts: Array<{ id: string; pass: boolean }>;
  configuration?: { type: Configuration };
};

type BrowserActions = {
  listEvidence(): Array<{
    checkpointId: string;
    configuration: Configuration;
    snapshotHash: string;
    objectNames: string[];
    factIds: string[];
  }>;
  evidenceReport(): {
    captureCount: number;
    byteSize: number;
    remainingBytes: number;
  };
  listenerCount(): number;
};

type BrowserLearningState = {
  phase: string;
  activeMissionId?: string;
  missions: Array<{ missionId: string; status: string }>;
  reflections: { completedJustificationStepIds: string[] };
  demonstrationsViewed: string[];
  assistance: { highestLevelUsed: number };
};

type BrowserReport = {
  completedMissions: number;
  verifiedMissions: number;
  capturedConfigurations: Configuration[];
  exactMidpoints: number;
  verifiedParallelPairs: number;
  conjectureCompleted: boolean;
  justificationCompleted: boolean;
  transferCompleted: boolean;
  exerciseXp: number;
};

type GoldenWindow = {
  ggbApplet?: BrowserAppletApi;
  __GEOTUTOR_ACTIONS_V1__?: BrowserActions;
  __GEOTUTOR_LEARNING_V1__?: {
    getState(): BrowserLearningState;
    report(): BrowserReport;
  };
  __GEOTUTOR_WORLD_V2__?: { world: BrowserWorld };
  __GEOTUTOR_WORLD_V2_HISTORY__?: unknown[];
  __GEOTUTOR_WORLD_V2_EVENT__?: unknown;
};

type ViewProperties = {
  invXscale: number;
  invYscale: number;
  xMin: number;
  yMin: number;
  width: number;
  height: number;
};

const OUTPUT_ROOT = path.resolve(
  process.cwd(),
  "../../output/playwright/T22-C08",
);
const GOLDEN_ENABLED = process.env.T22_GOLDEN === "1";
const SERIES_ID = process.env.T22_GATE_SERIES_ID ?? "series_unassigned";
const CANDIDATE_ID =
  process.env.T22_GATE_CANDIDATE_ID ?? "candidate_unassigned";
const ENVIRONMENT_ID =
  process.env.T22_GATE_ENVIRONMENT_ID ?? "environment_unassigned";

test.describe("T22-C08 geometry golden gate", () => {
  test.skip(!GOLDEN_ENABLED, "Run with pnpm gate:t22:golden.");

  for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
    test(`@t22-golden run ${runIndex}/3 publishes, completes, restores and closes`, async ({
      page,
    }) => {
      const startedAt = Date.now();
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 1440, height: 900 });

      const title = `Varignon golden ${SERIES_ID.slice(-8)}-${runIndex}`;
      await page.goto("/");
      await page.getByRole("button", { name: "Professor" }).click();
      await page
        .getByRole("button", { name: "Prepare the Varignon investigation" })
        .click();
      await page.getByRole("textbox", { name: "Title" }).fill(title);
      await page.getByRole("button", { name: "Open the real preview" }).click();
      const preview = page.locator(".geometry-teacher-preview");
      await expect(
        preview.locator(".geogebra-scratchpad[data-state=ready]"),
      ).toBeVisible();
      const previewStatus = preview.getByRole("status").first();
      await expect(previewStatus).toContainText(
        "The approved scaffold is ready for review.",
      );
      const teacherPreviewReady =
        (await previewStatus.textContent())?.includes("approved scaffold") === true;
      await preview.getByRole("button", { name: "Preview reviewed" }).click();
      await preview.getByRole("button", { name: "Close preview" }).click();
      await page.getByRole("button", { name: "Share the investigation" }).click();
      const studentLink = page.getByRole("link", {
        name: "Open the student view in a new tab",
      });
      await expect(studentLink).toBeVisible();
      const studentHref = await studentLink.getAttribute("href");
      if (!studentHref) throw new Error("The public student link is missing.");
      const publicationId = new URL(studentHref, page.url()).searchParams.get(
        "teacherExercise",
      );
      if (!publicationId) throw new Error("The publication id is missing.");

      const publishedContract = await page.evaluate(async (id) => {
        const response = await fetch("/api/teacher/exercises", {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          exercises: Array<Record<string, unknown>>;
        };
        return payload.exercises.find((exercise) => exercise.id === id);
      }, publicationId);
      expect(publishedContract).toMatchObject({
        id: publicationId,
        schemaVersion: "teacher_exercise_publication.v2",
        content: {
          kind: "geometry_investigation",
          exercise: {
            schemaVersion: "geometry_investigation.v1",
            title,
          },
        },
      });
      const publicTeacherJourney =
        teacherPreviewReady &&
        publishedContract?.schemaVersion === "teacher_exercise_publication.v2";
      expect(publicTeacherJourney).toBe(true);

      await page.goto(studentHref);
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(
        page.locator(".geogebra-scratchpad[data-state=ready]"),
      ).toBeVisible();
      await page.waitForFunction(() => {
        const target = window as unknown as GoldenWindow;
        return Boolean(
          target.ggbApplet?.getVersion() &&
            target.__GEOTUTOR_ACTIONS_V1__ &&
            target.__GEOTUTOR_LEARNING_V1__ &&
            target.__GEOTUTOR_WORLD_V2__?.world.objects.length === 8,
        );
      });
      await expect(
        page.getByText(/GeoGebra is ready\. Start voice or text/),
      ).toBeVisible();

      const appletVersion = await readAppletString(page, "getVersion");
      const worldSchemaVersion = await page.evaluate(
        () =>
          (window as unknown as GoldenWindow).__GEOTUTOR_WORLD_V2__!.world
            .schemaVersion,
      );
      const baseAColor = await readAppletString(page, "getColor", "A");
      const investigation = page.locator(".geometry-investigation-panel");
      const help = investigation.getByRole("button", {
        name: "Ask for the smallest hint",
      });
      const hint = investigation.locator(
        ".geometry-investigation-panel__hint",
      );
      for (const level of [1, 2, 3]) {
        await help.click();
        await expect(hint.locator("span")).toHaveText(`L${level}`);
      }
      await expect
        .poll(() => readAppletString(page, "getColor", "A"))
        .toBe("#F59E0B");
      const assistanceHighlightObserved = true;

      const construction = await constructLearnerVarignon(page, baseAColor);
      expect(construction.learnerCancellationObserved).toBe(true);
      await waitForMission(page, "V3");
      await investigation
        .getByRole("button", { name: "Capture this case" })
        .click();
      await waitForMission(page, "V4");

      await dragGeoPoint(page, "A", [1, 0]);
      await waitForConfiguration(page, "concave");
      await investigation
        .getByRole("button", { name: "Capture this case" })
        .click();
      await waitForMission(page, "V5");

      await dragGeoPoint(page, "A", [4, 3]);
      await waitForConfiguration(page, "crossed");
      await investigation
        .getByRole("button", { name: "Capture this case" })
        .click();
      await waitForMission(page, "V6");

      await investigation
        .getByRole("textbox")
        .fill("Opposite midpoint sides stay parallel in every tested shape.");
      await investigation
        .getByRole("button", { name: "Save my conjecture" })
        .click();
      await waitForMission(page, "V8");
      await investigation
        .getByRole("button", { name: "I explained this step" })
        .first()
        .click();

      await page.emulateMedia({ reducedMotion: "no-preference" });
      const demonstrationStateBefore = await readLearningState(page);
      const gallery = page.locator(".geometry-evidence-gallery");
      const demonstrationControls = gallery.getByRole("group", {
        name: "Demonstration controls",
      });
      for (const level of [1, 2, 3, 4]) {
        await help.click();
        await expect(hint.locator("span")).toHaveText(`L${level}`);
      }
      await investigation
        .getByRole("button", { name: "I agree to view this step" })
        .click();
      await expect(demonstrationControls).toBeVisible();
      await demonstrationControls.getByRole("button", { name: "Pause" }).click();
      await expect(
        demonstrationControls.getByRole("button", { name: "Resume" }),
      ).toBeVisible();
      await demonstrationControls
        .getByRole("button", { name: "Resume" })
        .click();
      await expect(
        demonstrationControls.getByRole("button", { name: "Stop and restore" }),
      ).toBeVisible();
      await expect(
        investigation.getByRole("button", { name: "Demonstration complete" }),
      ).toBeDisabled();
      const consentedDemonstrationObserved = true;
      const replayControlsObserved = true;
      const demonstrationStateAfter = await readLearningState(page);
      const assistantDemoProvenanceObserved =
        demonstrationStateAfter.demonstrationsViewed.includes("demo_v8_7") &&
        demonstrationStateAfter.reflections.completedJustificationStepIds
          .length ===
          demonstrationStateBefore.reflections.completedJustificationStepIds
            .length &&
        demonstrationStateAfter.assistance.highestLevelUsed === 4;
      expect(assistantDemoProvenanceObserved).toBe(true);

      await help.click();
      await expect(hint.locator("span")).toHaveText("L4");
      const beforeExplicitStop = await readRuntimeProof(page);
      await investigation
        .getByRole("button", { name: "I agree to view this step" })
        .click();
      await expect(demonstrationControls).toBeVisible();
      await demonstrationControls
        .getByRole("button", { name: "Stop and restore" })
        .click();
      const restoreBarrier = page.locator(
        ".geogebra-scratchpad-canvas[data-checkpoint-restoring=true]",
      );
      await expect(restoreBarrier).toBeVisible();
      const restoreInputBarrierObserved = await restoreBarrier.evaluate(
        (element) =>
          (element as HTMLElement).inert &&
          element.getAttribute("aria-busy") === "true",
      );
      expect(restoreInputBarrierObserved).toBe(true);
      await expect(demonstrationControls).toHaveCount(0);
      const afterExplicitStop = await readRuntimeProof(page);
      const replayStopRestored =
        afterExplicitStop.hash === beforeExplicitStop.hash &&
        JSON.stringify(afterExplicitStop.inventory) ===
          JSON.stringify(beforeExplicitStop.inventory) &&
        JSON.stringify(afterExplicitStop.ownership) ===
          JSON.stringify(beforeExplicitStop.ownership) &&
        afterExplicitStop.listeners === beforeExplicitStop.listeners;
      expect(replayStopRestored).toBe(true);

      await help.click();
      await expect(hint.locator("span")).toHaveText("L4");
      const beforeLearnerDrag = await readRuntimeProof(page);
      await investigation
        .getByRole("button", { name: "I agree to view this step" })
        .click();
      await expect(
        investigation.getByRole("button", { name: "Demonstration running…" }),
      ).toBeDisabled();
      const learnerDragTarget = [3.5, 2.25] as const;
      await dragGeoPoint(page, "A", learnerDragTarget);
      await expect(hint).toHaveCount(0);
      await page.waitForFunction(
        (previousHash) =>
          (window as unknown as GoldenWindow).__GEOTUTOR_WORLD_V2__?.world
            .snapshotHash !== previousHash,
        beforeLearnerDrag.hash,
      );
      const learnerStateAfterDrag = await readRuntimeProof(page);
      await page.waitForTimeout(1_200);
      const learnerStateAfterCancelledReplay = await readRuntimeProof(page);
      const learnerPointAfterCancelledReplay =
        learnerStateAfterCancelledReplay.pointA;
      const l4LearnerDragPreserved =
        learnerStateAfterDrag.hash !== beforeLearnerDrag.hash &&
        learnerStateAfterCancelledReplay.hash === learnerStateAfterDrag.hash &&
        JSON.stringify(learnerStateAfterCancelledReplay.inventory) ===
          JSON.stringify(learnerStateAfterDrag.inventory) &&
        JSON.stringify(learnerStateAfterCancelledReplay.ownership) ===
          JSON.stringify(learnerStateAfterDrag.ownership) &&
        learnerStateAfterCancelledReplay.listeners ===
          learnerStateAfterDrag.listeners &&
        Math.abs(learnerPointAfterCancelledReplay[0] - learnerDragTarget[0]) <
          0.2 &&
        Math.abs(learnerPointAfterCancelledReplay[1] - learnerDragTarget[1]) <
          0.2;
      expect(l4LearnerDragPreserved).toBe(true);
      await page.emulateMedia({ reducedMotion: "reduce" });

      for (let step = 0; step < 6; step += 1) {
        await investigation
          .getByRole("button", { name: "I explained this step" })
          .first()
          .click();
      }
      await waitForMission(page, "V9");
      await investigation
        .getByRole("textbox")
        .fill("The midpoint theorem transfers to this special quadrilateral.");
      await investigation
        .getByRole("button", { name: "Complete the investigation" })
        .click();
      await page.waitForFunction(
        () =>
          (window as unknown as GoldenWindow).__GEOTUTOR_LEARNING_V1__?.getState()
            .phase === "completed",
      );

      const beforeRestore = await page.evaluate(() => {
        const target = window as unknown as GoldenWindow;
        const world = target.__GEOTUTOR_WORLD_V2__!.world;
        const evidence = target.__GEOTUTOR_ACTIONS_V1__!.listEvidence();
        const report = target.__GEOTUTOR_LEARNING_V1__!.report();
        return {
          world,
          evidence,
          evidenceReport: target.__GEOTUTOR_ACTIONS_V1__!.evidenceReport(),
          listenerCount: target.__GEOTUTOR_ACTIONS_V1__!.listenerCount(),
          report,
        };
      });
      expect(beforeRestore.report).toMatchObject({
        completedMissions: 9,
        verifiedMissions: 7,
        capturedConfigurations: ["convex", "concave", "crossed"],
        exactMidpoints: 4,
        verifiedParallelPairs: 6,
        conjectureCompleted: true,
        justificationCompleted: true,
        transferCompleted: true,
        exerciseXp: 160,
      });
      expect(beforeRestore.evidence).toHaveLength(3);

      const appletBoard = page.locator(".geogebra-scratchpad-canvas");
      const appletControlsAccessible =
        (await appletBoard.getByRole("application").count()) >= 1 &&
        (await appletBoard.getByLabel(/^Move\./).count()) >= 1 &&
        (await appletBoard.getByLabel(/^Segment\./).count()) >= 1 &&
        (await appletBoard.getByLabel(/^Midpoint or Center\./).count()) >= 1;
      expect(appletControlsAccessible).toBe(true);
      const axeResult = await new AxeBuilder({ page })
        .include(".geometry-published-workspace")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(axeResult.violations).toEqual([]);

      let viewportOverflow = false;
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        viewportOverflow ||= await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
      }
      expect(viewportOverflow).toBe(false);

      const restoreStart = await page.evaluate(() => {
        const target = window as unknown as GoldenWindow;
        const world = target.__GEOTUTOR_WORLD_V2__!.world;
        return {
          inventory: world.objects.map(({ name }) => name).sort(),
          ownership: world.objects
            .map(({ name, owner }) => `${name}:${owner}`)
            .sort(),
          listeners: target.__GEOTUTOR_ACTIONS_V1__!.listenerCount(),
        };
      });
      const concaveCapture = beforeRestore.evidence.find(
        ({ configuration }) => configuration === "concave",
      );
      expect(concaveCapture).toBeDefined();
      const concaveItem = page.locator(
        ".geometry-evidence-gallery__list [data-configuration=concave]",
      );
      await concaveItem.getByRole("button", { name: "Restore" }).click();
      await concaveItem.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("The captured figure was restored.")).toBeAttached();
      await page.waitForFunction(
        (expectedHash) =>
          (window as unknown as GoldenWindow).__GEOTUTOR_WORLD_V2__?.world
            .snapshotHash === expectedHash,
        concaveCapture!.snapshotHash,
      );
      const restored = await page.evaluate(() => {
        const target = window as unknown as GoldenWindow;
        const world = target.__GEOTUTOR_WORLD_V2__!.world;
        return {
          hash: world.snapshotHash,
          inventory: world.objects.map(({ name }) => name).sort(),
          ownership: world.objects
            .map(({ name, owner }) => `${name}:${owner}`)
            .sort(),
          listeners: target.__GEOTUTOR_ACTIONS_V1__!.listenerCount(),
          helpers: world.objects.filter(({ owner }) =>
            ["assistant", "hint", "temporary"].includes(owner),
          ).length,
        };
      });
      expect(restored.hash).toBe(concaveCapture!.snapshotHash);
      expect(restored.inventory).toEqual(restoreStart.inventory);
      expect(restored.ownership).toEqual(restoreStart.ownership);
      expect(restored.listeners).toBe(restoreStart.listeners);
      expect(restored.helpers).toBe(0);

      await mkdir(OUTPUT_ROOT, { recursive: true });
      const artifact = `T22-C08-run-${runIndex}.png`;
      await page.screenshot({
        path: path.join(OUTPUT_ROOT, artifact),
        fullPage: true,
      });

      const observedWorld = beforeRestore.world;
      const scaffoldObjects = observedWorld.objects.filter(
        ({ owner }) => owner === "scaffold",
      ).length;
      const learnerObjects = observedWorld.objects.filter(
        ({ owner }) => owner === "student",
      ).length;
      const midpointObjects = ["E", "F", "G", "H"].filter((name) =>
        observedWorld.objects.some(
          (object) =>
            object.name === name &&
            object.owner === "student" &&
            object.parents?.length === 2,
        ),
      ).length;
      const reducedMotion = await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
      const realApplet = /^5\.4\.\d+\.\d+$/.test(appletVersion);
      const geometryHarness =
        worldSchemaVersion === "geometry_world.v2" ? "v2" : "unknown";
      const toolRuntime =
        construction.toolbarCanvasGestures && assistanceHighlightObserved
          ? "investigation"
          : "unknown";

      await page.getByRole("button", { name: "Back home" }).click();
      await expect(page.locator(".geometry-published-workspace")).toHaveCount(0);
      const cleanup = await page.evaluate(() => {
        const target = window as unknown as GoldenWindow;
        const values = [
          target.__GEOTUTOR_ACTIONS_V1__,
          target.__GEOTUTOR_LEARNING_V1__,
          target.__GEOTUTOR_WORLD_V2__,
          target.__GEOTUTOR_WORLD_V2_HISTORY__,
          target.__GEOTUTOR_WORLD_V2_EVENT__,
        ];
        return {
          globalsRemaining: values.filter((value) => value !== undefined).length,
          appletFrames: document.querySelectorAll(
            ".geogebra-scratchpad, .GeoGebraFrame, [data-param-app-name='geometry']",
          ).length,
        };
      });
      expect(cleanup).toEqual({ globalsRemaining: 0, appletFrames: 0 });
      expect(consoleErrors).toEqual([]);

      const manifest = {
        schemaVersion: "geotutor_geometry_golden_run.v1",
        runIndex,
        seriesId: SERIES_ID,
        candidateId: CANDIDATE_ID,
        environmentId: ENVIRONMENT_ID,
        publicationId,
        result: "pass",
        durationMs: Date.now() - startedAt,
        steps: {
          publication: publicTeacherJourney ? "exact_contract" : "invalid",
          scaffoldObjects,
          midpointObjects,
          learnerObjects,
          captures: beforeRestore.report.capturedConfigurations,
          parallelFacts: beforeRestore.report.verifiedParallelPairs,
          conjecture: beforeRestore.report.conjectureCompleted
            ? "completed"
            : "missing",
          justificationSteps: beforeRestore.report.justificationCompleted ? 7 : 0,
          transfer: beforeRestore.report.transferCompleted ? "completed" : "missing",
          missions: `${beforeRestore.report.completedMissions}/9`,
          xp: beforeRestore.report.exerciseXp,
        },
        restore: {
          status:
            restored.hash === concaveCapture!.snapshotHash ? "exact" : "mismatch",
          targetHash: concaveCapture!.snapshotHash,
          restoredHash: restored.hash,
          inventoryBefore: restoreStart.inventory,
          inventoryAfter: restored.inventory,
          ownershipBefore: restoreStart.ownership,
          ownershipAfter: restored.ownership,
          listenersBefore: restoreStart.listeners,
          listenersAfter: restored.listeners,
        },
        resources: {
          captureCount: beforeRestore.evidenceReport.captureCount,
          evidenceBytes: beforeRestore.evidenceReport.byteSize,
          evidenceMaxBytes: 12 * 1024 * 1024,
          helpersRemaining: restored.helpers,
          cleanupClosed: cleanup.appletFrames === 0,
          geometryGlobalsRemaining: cleanup.globalsRemaining,
        },
        quality: {
          realApplet,
          appletVersion,
          geometryHarness,
          toolRuntime,
          teacherPreviewReady,
          publicTeacherJourney,
          toolbarCanvasGestures: construction.toolbarCanvasGestures,
          assistanceHighlightObserved,
          learnerCancellationObserved:
            construction.learnerCancellationObserved,
          consentedDemonstrationObserved,
          replayControlsObserved,
          replayStopRestored,
          restoreInputBarrierObserved,
          assistantDemoProvenanceObserved,
          l4LearnerDragPreserved,
          appletControlsAccessible,
          axeViolations: axeResult.violations.length,
          viewportOverflow,
          consoleErrors: consoleErrors.length,
          reducedMotion,
        },
        artifact,
      };
      await writeFile(
        path.join(OUTPUT_ROOT, `run-${runIndex}.json`),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
    });
  }
});

async function constructLearnerVarignon(page: Page, baseAColor: string) {
  await exposeExtendedTools(page);
  await selectGeoGebraTool(page, "Midpoint or Center");
  await clickGeoObject(page, "A");
  await expect
    .poll(() => readAppletString(page, "getColor", "A"))
    .toBe(baseAColor);
  const learnerCancellationObserved = true;
  await clickGeoObject(page, "B");

  for (const [from, to] of [
    ["B", "C"],
    ["C", "D"],
    ["D", "A"],
  ] as const) {
    await selectGeoGebraTool(page, "Midpoint or Center");
    await clickGeoObject(page, from);
    await clickGeoObject(page, to);
  }
  for (const [from, to] of [
    ["E", "F"],
    ["F", "G"],
    ["G", "H"],
    ["H", "E"],
  ] as const) {
    await selectGeoGebraTool(page, "Segment");
    await clickGeoObject(page, from);
    await clickGeoObject(page, to);
  }
  await page.waitForFunction(() => {
    const target = window as unknown as GoldenWindow;
    const learnerObjects =
      target.__GEOTUTOR_WORLD_V2__?.world.objects.filter(
        ({ owner }) => owner === "student",
      ) ?? [];
    return learnerObjects.length === 8;
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const target = window as unknown as GoldenWindow;
          const applet = [
            ...(target.ggbApplet?.getAllObjectNames() ?? []),
          ].sort();
          const world = target.__GEOTUTOR_WORLD_V2__!.world.objects
            .map(({ name }) => name)
            .sort();
          return JSON.stringify(applet) === JSON.stringify(world);
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
  const inventory = await page.evaluate(() => {
    const target = window as unknown as GoldenWindow;
    return {
      applet: [...(target.ggbApplet?.getAllObjectNames() ?? [])].sort(),
      world: target.__GEOTUTOR_WORLD_V2__!.world.objects
        .map(({ name }) => name)
        .sort(),
    };
  });
  expect(inventory.applet).toEqual(inventory.world);
  return { learnerCancellationObserved, toolbarCanvasGestures: true };
}

async function exposeExtendedTools(page: Page) {
  const board = page.locator(".geogebra-scratchpad-canvas");
  const midpoint = board.getByLabel(/^Midpoint or Center\./).first();
  if ((await midpoint.count()) === 0 || !(await midpoint.isVisible())) {
    await board.getByText("More", { exact: true }).first().click();
  }
  await expect(midpoint).toBeVisible();
}

async function selectGeoGebraTool(page: Page, label: string) {
  const tool = page
    .locator(".geogebra-scratchpad-canvas")
    .getByLabel(new RegExp(`^${escapeRegExp(label)}\\.`))
    .first();
  await expect(tool).toBeVisible();
  await tool.click();
}

async function clickGeoObject(page: Page, name: string) {
  const screen = await geometryScreenPoint(page, name);
  await page.mouse.click(screen.x, screen.y);
}

async function dragGeoPoint(
  page: Page,
  name: string,
  target: readonly [number, number],
) {
  await selectGeoGebraTool(page, "Move");
  const from = await geometryScreenPoint(page, name);
  const to = await geometryScreenPoint(page, target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function geometryScreenPoint(
  page: Page,
  point: string | readonly [number, number],
) {
  const geometry = await page.evaluate((requested) => {
    const api = (window as unknown as GoldenWindow).ggbApplet;
    if (!api) throw new Error("GeoGebra API observation is unavailable.");
    const view = JSON.parse(api.getViewProperties(1)) as ViewProperties;
    const coordinates =
      typeof requested === "string"
        ? ([api.getXcoord(requested), api.getYcoord(requested)] as const)
        : requested;
    return { view, coordinates };
  }, point);
  const canvas = page.locator(".geogebra-scratchpad-canvas canvas").last();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The visible GeoGebra canvas is unavailable.");
  return {
    x:
      box.x +
      (geometry.coordinates[0] - geometry.view.xMin) /
        geometry.view.invXscale,
    y:
      box.y +
      geometry.view.height -
      (geometry.coordinates[1] - geometry.view.yMin) /
        geometry.view.invYscale,
  };
}

async function readAppletString(
  page: Page,
  method: "getVersion" | "getColor",
  argument?: string,
) {
  return page.evaluate(({ method: requested, argument: name }) => {
    const api = (window as unknown as GoldenWindow).ggbApplet;
    if (!api) throw new Error("GeoGebra API observation is unavailable.");
    if (requested === "getVersion") return api.getVersion();
    if (!name) throw new Error("An object name is required.");
    return api.getColor(name);
  }, { method, argument });
}

async function readLearningState(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as GoldenWindow).__GEOTUTOR_LEARNING_V1__!.getState(),
  );
}

async function readRuntimeProof(page: Page) {
  return page.evaluate(() => {
    const target = window as unknown as GoldenWindow;
    const world = target.__GEOTUTOR_WORLD_V2__!.world;
    const api = target.ggbApplet!;
    return {
      hash: world.snapshotHash,
      inventory: world.objects.map(({ name }) => name).sort(),
      ownership: world.objects
        .map(({ name, owner }) => `${name}:${owner}`)
        .sort(),
      listeners: target.__GEOTUTOR_ACTIONS_V1__!.listenerCount(),
      pointA: [api.getXcoord("A"), api.getYcoord("A")] as const,
    };
  });
}

async function waitForMission(page: Page, missionId: string) {
  await page.waitForFunction(
    (expected) =>
      (window as unknown as GoldenWindow).__GEOTUTOR_LEARNING_V1__?.getState()
        .activeMissionId === expected,
    missionId,
    { timeout: 10_000 },
  );
}

async function waitForConfiguration(page: Page, configuration: Configuration) {
  await page.waitForFunction(
    (expected) =>
      (window as unknown as GoldenWindow).__GEOTUTOR_WORLD_V2__?.world.configuration
        ?.type === expected,
    configuration,
    { timeout: 10_000 },
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

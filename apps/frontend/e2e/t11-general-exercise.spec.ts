import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.resolve(process.cwd(), "../../output/playwright");

const GENERAL_EXERCISE = {
  schemaVersion: "general_exercise.v1",
  outcome: "ready",
  language: "fr",
  subject: "mathematics",
  title: "Exercice 1",
  statement: "Exercice de géométrie comportant six consignes.",
  tasks: [
    "Placer trois points E, F et G non alignés.",
    "Tracer en vert la droite passant par F et G.",
    "Tracer en bleu la demi-droite d'origine E passant par F.",
    "Tracer en rouge le segment d'extrémités E et G.",
    "Placer K sur la demi-droite bleue mais pas sur le segment EF.",
    "Compléter la consigne avec les notations du cours.",
  ],
  concepts: ["droite", "demi-droite", "segment", "appartenance"],
  ambiguityCode: null,
  clarificationQuestion: null,
} as const;

test("T15 turns every subject into sequential missions with session XP", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?demo=gamification");

  await expect(page.getByRole("heading", { name: "Compass is ready with you." })).toBeVisible();
  await expect(page.getByLabel("Session XP")).toContainText("0");
  await expect(page.getByLabel("Exercise XP")).toContainText("0");
  await expect(
    page.getByRole("button", { name: "Complete mission 1 for 10 XP" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete mission 2 for 10 XP" }),
  ).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "Before claiming progress, what did you try?" })
    .fill("I named the two ideas in my own words.");
  await page
    .getByRole("button", { name: "Complete mission 1 for 10 XP" })
    .click();
  await expect(page.getByLabel("Session XP")).toContainText("10");
  await expect(page.getByLabel("Exercise XP")).toContainText("10");
  await expect(page.locator('[data-mission-status="completed"]')).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Complete mission 2 for 10 XP" }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Before claiming progress, what did you try?" })
    .fill("I connected each idea to one historical example.");
  await page
    .getByRole("button", { name: "Complete mission 2 for 10 XP" })
    .click();
  await expect(page.getByLabel("Session XP")).toContainText("20");
  await expect(page.getByLabel("Exercise XP")).toContainText("20");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.reload();
  await expect(page.getByLabel("Session XP")).toContainText("0");
  await expect(page.getByLabel("Exercise XP")).toContainText("0");
});

test("T13 opens a GeoGebra-dominant workspace with a compact contextual coach", async ({
  page,
}) => {
  await page.route("**/api/exercise/parse", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready_general",
        exercise: GENERAL_EXERCISE,
      }),
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?entry=upload");

  await expect(page.locator("#geogebra-spike-title")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Add your exercise", exact: true })).toBeVisible();

  await page.getByLabel("Choose a photo").setInputFiles({
    name: "exercise.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71]),
  });
  await page.getByRole("button", { name: "Read my exercise" }).click();

  await expect(
    page.getByRole("heading", { name: "Is this really the exercise?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Here's what I found" }),
  ).toBeVisible();
  await expect(page.getByText(GENERAL_EXERCISE.tasks[5])).toBeVisible();
  for (const legacyCopy of await page.getByText(/perpendicular bisector/i).all()) {
    await expect(legacyCopy).toBeHidden();
  }

  await page.getByRole("button", { name: "Looks right — start" }).click();
  await expect(
    page.getByRole("heading", { name: "GeoGebra, Compass and you." }),
  ).toBeVisible();
  await expect(page.locator(".general-exercise-workspace--rail")).toBeVisible();
  await expect(page.locator(".mission-track > li")).toHaveCount(6);
  await expect(page.getByText(/1\. Placer trois points E, F et G/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start voice" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Use live text" })).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Draw, test, adjust." }),
  ).toBeVisible();
  await expect(page.locator(".geogebra-scratchpad")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 30_000 },
  );
  expect(
    await page.locator(".geogebra-scratchpad-canvas > *").count(),
  ).toBeGreaterThan(0);
  await expect(page.locator(".compass-mascot-presence--workspace")).toBeVisible();
  const coachBox = await page.locator(".geogebra-workbench-coach").boundingBox();
  const boardBox = await page.locator(".geogebra-scratchpad").boundingBox();
  const tasksBox = await page
    .locator(".geogebra-workbench > .general-exercise-workspace")
    .boundingBox();
  expect(coachBox).not.toBeNull();
  expect(boardBox).not.toBeNull();
  expect(tasksBox).not.toBeNull();
  expect(coachBox!.y).toBeLessThan(boardBox!.y);
  expect(boardBox!.y).toBeLessThan(tasksBox!.y);
  expect(boardBox!.y).toBeLessThan(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Passer en français" }).click();
  await expect(page.getByText(/1\. Placer trois points E, F et G/)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".realtime-spike--panorama")).toBeVisible();
    await expect(page.locator(".geogebra-scratchpad")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopWorkbench = await page.locator(".geogebra-workbench").boundingBox();
  const desktopBoard = await page.locator(".geogebra-scratchpad").boundingBox();
  const desktopCoach = await page.locator(".geogebra-workbench-coach").boundingBox();
  expect(desktopWorkbench).not.toBeNull();
  expect(desktopBoard).not.toBeNull();
  expect(desktopCoach).not.toBeNull();
  expect(desktopBoard!.width / desktopWorkbench!.width).toBeGreaterThanOrEqual(0.9);
  expect(desktopCoach!.y).toBeLessThan(desktopBoard!.y);

  await page.setViewportSize({ width: 390, height: 844 });

  await mkdir(OUTPUT, { recursive: true });
  await page.screenshot({
    path: path.join(OUTPUT, "T13-geogebra-assisted-390x844.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Nouvel exercice" }).click();
  await expect(
    page.getByRole("heading", { name: "Ajoute ton exercice", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Lire mon exercice" })).toBeDisabled();
  await page.getByRole("button", { name: "Retour à l'accueil" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Construis. Observe. Prouve.",
    }),
  ).toBeVisible();
});

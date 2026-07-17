import { expect, test } from "@playwright/test";

const PUBLICATION = {
  schemaVersion: "teacher_exercise.v1",
  source: "manual",
  id: "teacher_education-01",
  publishedAt: 123,
  exercise: {
    schemaVersion: "general_exercise.v1",
    outcome: "ready",
    language: "en",
    subject: "history",
    title: "Connect an idea to evidence",
    statement: "Explain one idea and support it with one example.",
    tasks: ["Name one idea from the Enlightenment."],
    concepts: ["Enlightenment", "evidence"],
    ambiguityCode: null,
    clarificationQuestion: null,
  },
  level: "middle_school",
  theme: "Connect an idea to evidence",
  guidance: {
    learningObjective: "Connect a historical idea to evidence.",
    teacherInstructions: "Ask for the learner's reason before giving a hint.",
    targetDifficulties: ["Examples remain too general."],
    likelyMisconceptions: ["An opinion is treated as evidence."],
    hintSequence: ["Name the idea in your own words."],
  },
  estimatedMinutes: 10,
} as const;

test("T18 closes the anonymous teacher-to-learner learning loop", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("**/api/teacher/exercises", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ publication: PUBLICATION }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exercises: [] }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Professor" }).click();
  await page.getByRole("button", { name: "Write it myself" }).click();
  await page
    .getByRole("textbox", { name: /Exercise title or instructions/ })
    .fill(PUBLICATION.exercise.title);
  await page
    .getByRole("textbox", { name: /Steps students must complete/ })
    .fill(PUBLICATION.exercise.tasks[0]);
  await page.getByRole("button", { name: "Preview my exercise" }).click();
  await page.getByRole("button", { name: "Share with students" }).click();
  await page.getByRole("button", { name: "See it in the student library" }).click();

  await expect(
    page.getByRole("heading", { name: PUBLICATION.exercise.title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start this exercise" }).click();
  await expect(page.getByRole("heading", { name: "Compass is ready with you." })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const progressButton = page.getByRole("button", {
    name: "Complete mission 1 for 10 XP",
  });
  await expect(progressButton).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Before claiming progress, what did you try?" })
    .fill("I linked the idea to a dated example.");
  await progressButton.click();
  await page
    .getByRole("textbox", { name: /Where could you reuse one idea/ })
    .fill("I could use the same evidence check in another source question.");
  await page.getByRole("button", { name: "Finish reflection" }).click();

  await page.getByRole("button", { name: "Professor" }).click();
  await expect(
    page.getByRole("heading", { name: "What happened in this tab" }),
  ).toBeVisible();
  await expect(page.getByText("1/1")).toBeVisible();
  await expect(page.getByText("done")).toBeVisible();
  await expect(page.getByText("10", { exact: true })).toBeVisible();
  await expect(page.getByText(/same evidence check/)).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  expect(consoleErrors).toEqual([]);
});

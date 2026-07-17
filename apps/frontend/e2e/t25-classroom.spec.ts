import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { T25_TEACHER_ACCESS_CODE } from "./t25-classroom.fixture";

test("teacher creates a class, learner joins, rotation and removal revoke access", async ({
  browser,
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Professor" }).click();
  await page.getByRole("button", { name: "Manage my classes" }).click();
  await page.getByLabel("Pilot teacher access code").fill(T25_TEACHER_ACCESS_CODE);
  await page.getByRole("button", { name: "Open class space" }).click();
  await expect(page.getByText("Teacher space unlocked.")).toBeVisible();

  await page.getByLabel("New class name").fill("Geometry lab");
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/classroom/teacher/classes") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create class" }).click();
  const createResponse = await createResponsePromise;
  const createBody = await createResponse.text();
  expect(createBody).not.toMatch(/joinCodeHash|scrypt-v1|teacherAccessHash|sessionSecret/);
  const firstCode = (await page.locator(".classroom-code output").textContent())?.trim();
  expect(firstCode).toMatch(/^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){2}$/);

  const learnerContext = await browser.newContext();
  const learnerPage = await learnerContext.newPage();
  await learnerPage.goto("/");
  await learnerPage.getByRole("button", { name: "Join my class" }).click();
  await learnerPage.getByLabel("Class code", { exact: true }).fill(firstCode ?? "");
  await learnerPage.getByLabel("Class pseudonym", { exact: true }).fill("Orion");
  const joinResponsePromise = learnerPage.waitForResponse(
    (response) =>
      response.url().endsWith("/api/classroom/join") &&
      response.request().method() === "POST",
  );
  await learnerPage.getByRole("button", { name: "Join my class" }).click();
  const joinResponse = await joinResponsePromise;
  const joinBody = await joinResponse.text();
  expect(joinBody).not.toMatch(
    /learnerAliases|joinCode|join_code|scrypt-v1|teacherId|teacherAccessHash/,
  );
  expect((await joinResponse.allHeaders())["set-cookie"] ?? "").not.toMatch(
    /Orion|Geometry lab|scrypt-v1|compass-t25-test/,
  );
  await expect(learnerPage.getByRole("heading", { name: "You're in." })).toBeVisible();
  await expect(learnerPage.getByText("Geometry lab")).toBeVisible();
  await expect(learnerPage.getByText("Your pseudonym: Orion")).toBeVisible();

  await page.getByRole("button", { name: "Generate a new code" }).click();
  await expect(page.getByText("New code ready. The previous code no longer works.")).toBeVisible();
  const secondCode = (await page.locator(".classroom-code output").textContent())?.trim();
  expect(secondCode).not.toBe(firstCode);
  await expect(page.getByText("Orion", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Pseudonym removed.")).toBeVisible();
  await learnerPage.reload();
  await learnerPage.getByRole("button", { name: "Join my class" }).click();
  await expect(learnerPage.getByLabel("Class code", { exact: true })).toBeVisible();

  const rejectedContext = await browser.newContext();
  const rejectedPage = await rejectedContext.newPage();
  await rejectedPage.goto("/");
  await rejectedPage.getByRole("button", { name: "Join my class" }).click();
  await rejectedPage.getByLabel("Class code", { exact: true }).fill(firstCode ?? "");
  await rejectedPage.getByLabel("Class pseudonym", { exact: true }).fill("Nova");
  await rejectedPage.getByRole("button", { name: "Join my class" }).click();
  await expect(
    rejectedPage.getByText("Check the class code. It may be invalid or expired."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Class archived.")).toBeVisible();
  await rejectedPage.getByLabel("Class code", { exact: true }).fill(secondCode ?? "");
  await rejectedPage.getByRole("button", { name: "Join my class" }).click();
  await expect(
    rejectedPage.getByText("Check the class code. It may be invalid or expired."),
  ).toBeVisible();

  await learnerContext.close();
  await rejectedContext.close();
});

test("student join is keyboard-accessible, bilingual and mobile-safe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Passer en français" }).click();
  await page.getByRole("button", { name: "Rejoindre ma classe" }).click();

  await expect(
    page.getByRole("heading", { name: "Rejoins ta classe avec son code." }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Code de classe", { exact: true })).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  const results = await new AxeBuilder({ page })
    .include(".classroom-join-screen")
    .analyze();
  expect(results.violations).toEqual([]);
});

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
  const geometryCard = classroomCard(page, "Geometry lab");
  await expect(
    geometryCard.locator(".classroom-roster").getByText("Orion", { exact: true }),
  ).toBeVisible();

  await geometryCard.getByRole("button", { name: "Remove" }).click();
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

test("teacher assigns the exact Varignon PDF to a frozen group and can withdraw it", async ({
  browser,
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Professor" }).click();
  await page.getByRole("button", { name: "Manage my classes" }).click();
  await page.getByLabel("Pilot teacher access code").fill(T25_TEACHER_ACCESS_CODE);
  await page.getByRole("button", { name: "Open class space" }).click();
  await expect(page.getByText("Teacher space unlocked.")).toBeVisible();

  await page.getByLabel("New class name").fill("Varignon group lab");
  await page.getByRole("button", { name: "Create class" }).click();
  const classCode = (await page.locator(".classroom-code output").textContent())?.trim();
  expect(classCode).toMatch(/^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){2}$/);

  const orionContext = await browser.newContext();
  const orionPage = await orionContext.newPage();
  await joinClass(orionPage, classCode ?? "", "Orion");

  await page.reload();
  await page.getByRole("button", { name: "Professor" }).click();
  await page.getByRole("button", { name: "Manage my classes" }).click();
  const varignonCard = classroomCard(page, "Varignon group lab");
  await expect(
    varignonCard
      .locator(".classroom-roster")
      .getByText("Orion", { exact: true }),
  ).toBeVisible();
  await expect(varignonCard.getByText("Approved activity")).toBeVisible();
  await expect(
    varignonCard.getByText("math.pdf", { exact: false }),
  ).toBeVisible();
  await expect(
    varignonCard.getByText("9 missions", { exact: false }),
  ).toBeVisible();

  const groupSection = varignonCard.locator(".classroom-groups");
  await groupSection.getByLabel("Group name").fill("Guided");
  await groupSection.getByLabel("Orion").check();
  await groupSection.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByText("Group created.")).toBeVisible();
  await varignonCard
    .getByLabel("Recipients")
    .selectOption({ label: "Group · Guided" });

  const opensAt = Date.now() + 5_000;
  await varignonCard
    .getByLabel("Opens at")
    .fill(toLocalDateTimeInput(opensAt));
  await varignonCard.getByLabel("Available for").selectOption("1");
  const assignResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/classroom/teacher/assignments") &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await varignonCard
    .getByRole("button", { name: "Assign now" })
    .click();
  const assignResponse = await assignResponsePromise;
  expect(assignResponse.status()).toBe(201);
  await expect(
    page.getByText("Varignon assigned to the resolved recipients."),
  ).toBeVisible();
  await expect(
    varignonCard.getByText("1 recipients", { exact: false }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .include(".classroom-assignment-studio")
    .analyze();
  expect(accessibility.violations).toEqual([]);

  const novaContext = await browser.newContext();
  const novaPage = await novaContext.newPage();
  await joinClass(novaPage, classCode ?? "", "Nova");
  await expect(
    novaPage.getByText("Your teacher will assign the first activity here."),
  ).toBeVisible();

  await orionPage.waitForTimeout(Math.max(0, opensAt - Date.now() + 1_000));
  await reopenClassScreen(orionPage);
  await expect(orionPage.getByText("Activities received")).toBeVisible();
  await expect(orionPage.getByText("9 missions", { exact: false })).toBeVisible();
  await expect(
    orionPage.getByText(
      "Your teacher assigned this exact activity. Open it in GeoGebra when you are ready.",
    ),
  ).toBeVisible();
  await orionPage.getByRole("button", { name: "Start activity" }).click();
  await expect(orionPage.locator(".geometry-published-workspace")).toBeVisible();
  await expect(orionPage.getByRole("button", { name: "Back to my class" })).toBeVisible();
  await orionPage.getByRole("button", { name: "Back to my class" }).click();
  await expect(orionPage.getByRole("heading", { name: "You're in." })).toBeVisible();

  await reopenClassScreen(novaPage);
  await expect(
    novaPage.getByText("Your teacher will assign the first activity here."),
  ).toBeVisible();
  await expect(novaPage.getByText("Activities received")).toHaveCount(0);

  await varignonCard.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Assignment withdrawn.")).toBeVisible();
  await reopenClassScreen(orionPage);
  await expect(
    orionPage.getByText("Your teacher will assign the first activity here."),
  ).toBeVisible();

  await orionContext.close();
  await novaContext.close();
});

async function joinClass(
  page: import("@playwright/test").Page,
  code: string,
  pseudonym: string,
): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Join my class" }).click();
  await page.getByLabel("Class code", { exact: true }).fill(code);
  await page.getByLabel("Class pseudonym", { exact: true }).fill(pseudonym);
  await page.getByRole("button", { name: "Join my class" }).click();
  await expect(page.getByRole("heading", { name: "You're in." })).toBeVisible();
}

async function reopenClassScreen(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.reload();
  await page.getByRole("button", { name: "Join my class" }).click();
  await expect(page.getByRole("heading", { name: "You're in." })).toBeVisible();
}

function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function classroomCard(
  page: import("@playwright/test").Page,
  label: string,
): import("@playwright/test").Locator {
  return page
    .locator(".classroom-list > li")
    .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
}

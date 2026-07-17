import { expect, test } from "@playwright/test";

import { T24_DEMO_ACCESS_CODE } from "./t24-demo-access.fixture";

test("T24-C02 refuses model routes before parsing and opens only an expiring session", async ({
  page,
  request,
}) => {
  const firstVisit = await page.goto("/");
  expect(firstVisit?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Your learning space is protected" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Build. Observe. Prove.",
    }),
  ).toHaveCount(0);

  for (const path of [
    "/api/realtime/session",
    "/api/exercise/parse",
    "/api/teacher/draft",
  ]) {
    const response = await request.post(path, {
      headers: { "Content-Type": "text/plain" },
      data: "student-content-must-not-be-parsed",
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "demo_access_required",
        message: "Demo access is required.",
        retryable: false,
      },
    });
  }

  const catalog = await request.get("/api/teacher/exercises");
  expect(catalog.status()).toBe(401);

  const codeInput = page.getByLabel("Access code");
  await codeInput.fill("invalid-demo-code");
  await page.getByRole("button", { name: "Open Compass" }).click();
  await expect(page.getByText("This access code is not valid.")).toBeVisible();
  await expect(codeInput).toHaveValue("invalid-demo-code");

  await codeInput.fill(T24_DEMO_ACCESS_CODE);
  await page.getByRole("button", { name: "Open Compass" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Build. Observe. Prove.",
    }),
  ).toBeVisible();

  const sessionCookie = (await page.context().cookies()).find(
    ({ name }) => name === "compass_demo_session",
  );
  expect(sessionCookie).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
  });
  expect(sessionCookie?.value).not.toContain(T24_DEMO_ACCESS_CODE);

  await page.getByRole("button", { name: "End demo session" }).click();
  await expect(
    page.getByRole("heading", { name: "Your learning space is protected" }),
  ).toBeVisible();
});

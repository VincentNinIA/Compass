import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the public demo opens the teacher Varignon activity in one click", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Build. Observe. Prove." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Start the exercise/ }),
  ).toBeVisible();
  await expect(page.getByText("No account. No class code.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Add my exercise/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Join my class/ }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /Start the exercise/ }).click();

  await expect(
    page.getByRole("heading", {
      name: "Varignon — the midpoint quadrilateral",
    }),
  ).toBeVisible();
  await expect(
    page.locator(".geogebra-scratchpad[data-state=ready]"),
  ).toBeVisible();
  await expect(
    page.locator(".geometry-investigation-panel__missions > li"),
  ).toHaveCount(9);
  await expect(
    page.getByRole("button", { name: "Back to the demo" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to the demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Build. Observe. Prove." }),
  ).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("the simplified demo remains bilingual, accessible and mobile-safe", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Passer en français" }).click();

  await expect(
    page.getByRole("heading", { name: "Construis. Observe. Prouve." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Commencer l’exercice/ }),
  ).toBeVisible();
  await expect(page.getByText("Sans compte. Sans code de classe.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const accessibility = await new AxeBuilder({ page })
    .include("main")
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

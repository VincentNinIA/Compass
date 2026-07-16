import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const PLAYWRIGHT_OUTPUT = path.resolve(
  process.cwd(),
  "../../output/playwright",
);

async function expectNoDocumentOverflow(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      { timeout: 3_000 },
    )
    .toBe(true);
}

test("T6-C06 production candidate exposes secure permissions and an accessible jury surface", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/");
  expect(response).not.toBeNull();
  expect(response?.headers()["permissions-policy"]).toBe(
    "microphone=(self), camera=(self)",
  );
  expect(response?.headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response?.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);

  await expect(page.getByText("API verified", { exact: true })).toBeHidden();
  await expect(
    page.getByRole("link", { name: "License and attribution", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Commercial use requires a separate GeoGebra agreement/),
  ).toBeVisible();
  await expect(
    page.getByText(/Live voice requires HTTPS and microphone permission/),
  ).toBeVisible();

  const html = await page.content();
  for (const forbidden of ["OPENAI_API_KEY", "Bearer sk-", "sk-proj-"]) {
    expect(html).not.toContain(forbidden);
  }

  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to your exercise" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  const demoLink = page.getByRole("link", {
    name: "Add my exercise",
  });
  await demoLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#exercise-photo-title$/);
  await expect(
    page.getByRole("heading", { name: "Show me your exercise" }),
  ).toBeInViewport();

  const axeResult = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axeResult.violations).toEqual([]);

  const ariaSnapshot = await page.locator("body").ariaSnapshot();
  expect(ariaSnapshot).toContain(
    "heading \"Add your exercise\"",
  );
  expect(ariaSnapshot).not.toContain("link \"License and attribution\"");
  await mkdir(PLAYWRIGHT_OUTPUT, { recursive: true });
  await writeFile(
    path.join(PLAYWRIGHT_OUTPUT, "T6-C06-aria-snapshot.yml"),
    `${ariaSnapshot}\n`,
    "utf8",
  );

  expect(
    await page.locator(".compass-mascot-presence").evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toMatch(/^(0s|0\.00001s)(, (0s|0\.00001s))*$/);
  await expectNoDocumentOverflow(page);
  await page.screenshot({
    path: path.join(PLAYWRIGHT_OUTPUT, "T6-C06-jury-1440x900.png"),
    fullPage: true,
  });

  for (const viewport of [
    { width: 768, height: 1024, name: "tablet-768x1024" },
    { width: 390, height: 844, name: "mobile-390x844" },
    { width: 640, height: 720, name: "zoom-200" },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoDocumentOverflow(page);
    await page.screenshot({
      path: path.join(PLAYWRIGHT_OUTPUT, `T6-C06-${viewport.name}.png`),
      fullPage: true,
    });
  }
});

test("T6-C06 denied microphone keeps local honest and leaves an explicit typed path", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        throw new DOMException("Permission denied for presentation test", "NotAllowedError");
      },
    });
  });

  let typedRequests = 0;
  await page.route("**/api/realtime/session", async (route) => {
    typedRequests += 1;
    expect(route.request().headers()["x-geotutor-capability-mode"]).toBe(
      "typed_live",
    );
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          domain: "realtime",
          code: "provider_unavailable",
          retryable: true,
          userMessage: "Realtime is temporarily unavailable.",
          correlationId: "presentation-test",
        },
      }),
    });
  });

  await page.goto("/?specialist=geometry");
  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(page.locator("[data-capability-mode]"))
    .toContainText("Reason: microphone permission denied");
  await expect(page.locator("[data-capability-mode]"))
    .toContainText(/no OpenAI or model request is sent/);

  const typed = page.getByRole("button", { name: "Use live text" });
  await expect(typed).toBeEnabled({ timeout: 3_000 });
  await typed.click();
  await expect(page.locator("[data-capability-mode]"))
    .toContainText("Reason: typed connection failed");
  expect(typedRequests).toBe(1);
  await page.waitForTimeout(1_200);
  expect(typedRequests).toBe(1);

  await mkdir(PLAYWRIGHT_OUTPUT, { recursive: true });
  await page.locator(".realtime-spike").screenshot({
    path: path.join(PLAYWRIGHT_OUTPUT, "T6-C06-permission-fallback.png"),
  });
});

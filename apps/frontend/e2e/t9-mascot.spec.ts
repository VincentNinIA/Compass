import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const PLAYWRIGHT_OUTPUT = path.resolve(process.cwd(), "../../output/playwright");

const ACTIVITIES = [
  "idle",
  "receiving",
  "thinking",
  "listening",
  "speaking",
  "modifying",
  "hinting",
  "celebrating",
  "error",
] as const;

type Activity = (typeof ACTIVITIES)[number];

type MascotDebugWindow = Window & {
  __COMPASS_MASCOT_DEBUG__?: {
    start(source: string, activity: Exclude<Activity, "idle">): void;
    reset(): void;
  };
};

async function setMascotActivity(page: Page, activity: Activity) {
  await page.evaluate((nextActivity) => {
    const debug = (window as MascotDebugWindow).__COMPASS_MASCOT_DEBUG__;
    if (!debug) throw new Error("Mascot debug controller is unavailable.");
    debug.reset();
    if (nextActivity !== "idle") debug.start("t9-browser", nextActivity);
  }, activity);
}

async function expectNoDocumentOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

test("T9-C03 exposes all nine atlas states without a live model dependency", async ({
  page,
}) => {
  await page.goto("/");
  const mascot = page.locator(".compass-mascot-presence");
  await expect(mascot).toBeVisible();
  await page.waitForFunction(
    () => Boolean((window as MascotDebugWindow).__COMPASS_MASCOT_DEBUG__),
  );

  for (const activity of ACTIVITIES) {
    await setMascotActivity(page, activity);
    await expect(mascot).toHaveAttribute("data-mascot-state", activity);
    await expect(mascot.locator(".compass-mascot-sprite")).toHaveCSS(
      "background-image",
      /compass-mentor-atlas\.webp/,
    );
  }

  await setMascotActivity(page, "idle");
  await expect(mascot).toContainText("Here when you need me");
  await page.getByRole("button", { name: "Passer en français" }).click();
  await expect(mascot).toHaveAttribute("aria-label", "Présence de Compass");
  await expect(mascot).toContainText("Je suis là si tu as besoin");
  await expect(mascot).not.toHaveAttribute("aria-live");

  const axeResult = await new AxeBuilder({ page })
    .include(".compass-mascot-presence")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axeResult.violations).toEqual([]);
});

test("T9-C03 keeps one fixed pose when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const mascot = page.locator(".compass-mascot-presence");
  await page.waitForFunction(
    () => Boolean((window as MascotDebugWindow).__COMPASS_MASCOT_DEBUG__),
  );

  for (const activity of ACTIVITIES) {
    await setMascotActivity(page, activity);
    await expect(mascot).toHaveAttribute("data-mascot-state", activity);
    await page.waitForTimeout(260);
    await expect(mascot).toHaveAttribute("data-frame", "0");
  }
});

test("T9-C03 mascot stays inside 390, 768 and 1440 px viewports", async ({
  page,
}) => {
  await mkdir(PLAYWRIGHT_OUTPUT, { recursive: true });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await setMascotActivity(page, "hinting");
    const mascot = page.locator(".compass-mascot-presence");
    await expect(mascot).toBeVisible();
    const box = await mascot.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await expect(mascot).toHaveCSS("pointer-events", "none");
    await expectNoDocumentOverflow(page);

    const primaryAction = page.getByRole("button", { name: /Start the exercise/ });
    await primaryAction.click();
    await expect(
      page.getByRole("heading", { name: "Varignon — the midpoint quadrilateral" }),
    ).toBeVisible();

    await page.screenshot({
      path: path.join(
        PLAYWRIGHT_OUTPUT,
        `T9-mascot-hinting-${viewport.width}x${viewport.height}.png`,
      ),
    });
  }
});

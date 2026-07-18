import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type DirectDemoAppletApi = {
  evalCommand(command: string): boolean;
  setCoords(name: string, x: number, y: number): void;
};

type DirectDemoWindow = Window & {
  __COMPASS_MASCOT_DEBUG__?: {
    start(source: string, activity: string): void;
    setSpeechEnergy(level: number | null): void;
    reset(): void;
  };
  __GEOTUTOR_ACTIONS_V1__?: {
    register(
      name: string,
      owner: "scaffold" | "student",
      kind?: "point" | "segment",
    ): void;
  };
  __GEOTUTOR_LEARNING_V1__?: {
    getState(): {
      activeMissionId?: string;
      missions: Array<{ missionId: string; status: string }>;
    };
    recordAttempt(actionId: string): { type: string; reason?: string } | undefined;
    requestHelp(): { type: string } | undefined;
  };
  __GEOTUTOR_WORLD_V2_EVENT__?: (event: {
    type: string;
    target?: string;
    argument?: unknown;
  }) => void;
};

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
  const coachMascot = page.locator(".compass-mascot-presence--coach");
  await expect(coachMascot).toBeVisible();
  await expect(coachMascot.locator(".compass-mascot-sprite")).toHaveCount(1);
  await expect(coachMascot).toHaveAttribute("data-renderer", "css-compositor");
  await expect(coachMascot).toHaveCSS("pointer-events", "none");
  await page.waitForFunction(
    () =>
      Boolean(
        (window as DirectDemoWindow).__COMPASS_MASCOT_DEBUG__ &&
          (window as DirectDemoWindow).__GEOTUTOR_LEARNING_V1__ &&
          (window as DirectDemoWindow).__GEOTUTOR_WORLD_V2_EVENT__,
      ),
  );

  await page.evaluate(() => {
    (window as DirectDemoWindow).__COMPASS_MASCOT_DEBUG__?.start(
      "demo-speaking",
      "speaking",
    );
  });
  await expect(coachMascot).toHaveAttribute("data-mascot-state", "speaking");
  const firstSpeakingFrame = await coachMascot.getAttribute("data-frame");
  await page.waitForTimeout(750);
  await expect(coachMascot).toHaveAttribute("data-frame", firstSpeakingFrame!);
  await page.evaluate(() => {
    (window as DirectDemoWindow).__COMPASS_MASCOT_DEBUG__?.setSpeechEnergy(0.82);
  });
  await expect(coachMascot).toHaveAttribute("data-speech-signal", "meter");
  await expect
    .poll(() =>
      coachMascot.evaluate((element) =>
        element.style.getPropertyValue("--mascot-mouth-scale"),
      ),
    )
    .toBe("1.369");
  await page.evaluate(() => {
    (window as DirectDemoWindow).__COMPASS_MASCOT_DEBUG__?.reset();
  });

  expect(await movePointAsLearner(page, "A", -3.7, -1.1)).toBe(true);
  const focusCameo = page.locator(
    '.geometry-mascot-cameo[data-kind="focus"]',
  );
  await expect(focusCameo).toBeVisible();
  await expect(focusCameo).toHaveAttribute(
    "data-targets",
    /(?:^|,)A(?:,|$)/,
  );
  await expect(coachMascot).not.toHaveAttribute("data-mascot-state", "error");

  await page.evaluate(() => {
    (window as DirectDemoWindow).__GEOTUTOR_LEARNING_V1__?.requestHelp();
  });
  await expect(coachMascot).toHaveAttribute("data-mascot-state", "hinting");
  await expect(
    page.locator('.geometry-mascot-cameo[data-kind="hint"]'),
  ).toBeVisible();

  expect(await createVarignonConstruction(page)).toBe(true);
  await page.waitForFunction(
    () =>
      (window as DirectDemoWindow).__GEOTUTOR_LEARNING_V1__?.getState()
        .activeMissionId === "V3",
  );
  await expect(page.locator(".geometry-mascot-proof-pins li")).toHaveCount(2);
  await expect(page.locator(".geometry-mascot-proof-pins")).toHaveAttribute(
    "data-count",
    "2",
  );
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

  await page.getByRole("button", { name: /Commencer l’exercice/ }).click();
  await expect(page.locator(".compass-mascot-presence--coach")).toBeVisible();
  await expect(page.locator(".compass-mascot-presence--coach")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await page.waitForTimeout(260);
  await expect(page.locator(".compass-mascot-presence--coach")).toHaveAttribute(
    "data-frame",
    "0",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

async function createVarignonConstruction(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const target = window as DirectDemoWindow;
    const dynamicWindow = window as unknown as Record<string, unknown>;
    const api = [
      dynamicWindow["compass-general-geogebra"],
      dynamicWindow.ggbApplet,
      ...Object.values(dynamicWindow),
    ].find(
      (candidate): candidate is DirectDemoAppletApi =>
        Boolean(
          candidate &&
            typeof candidate === "object" &&
            "evalCommand" in candidate &&
            typeof candidate.evalCommand === "function",
        ),
    );
    const commands = [
      "A=(-4,-1)",
      "B=(-1,-3)",
      "C=(4,-1)",
      "D=(1,3)",
      "AB=Segment(A,B)",
      "BC=Segment(B,C)",
      "CD=Segment(C,D)",
      "DA=Segment(D,A)",
      "E=Midpoint(A,B)",
      "F=Midpoint(B,C)",
      "G=Midpoint(C,D)",
      "H=Midpoint(D,A)",
      "EF=Segment(E,F)",
      "FG=Segment(F,G)",
      "GH=Segment(G,H)",
      "HE=Segment(H,E)",
    ];
    if (!api || !commands.every((command) => api.evalCommand(command))) {
      return false;
    }
    for (const name of ["A", "B", "C", "D"]) {
      target.__GEOTUTOR_ACTIONS_V1__?.register(name, "scaffold", "point");
    }
    for (const name of ["AB", "BC", "CD", "DA"]) {
      target.__GEOTUTOR_ACTIONS_V1__?.register(name, "scaffold", "segment");
    }
    for (const name of ["E", "F", "G", "H"]) {
      target.__GEOTUTOR_ACTIONS_V1__?.register(name, "student", "point");
    }
    for (const name of ["EF", "FG", "GH", "HE"]) {
      target.__GEOTUTOR_ACTIONS_V1__?.register(name, "student", "segment");
    }
    target.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "update",
      argument: commands.map((command) => command.split("=")[0]),
    });
    return true;
  });
}

async function movePointAsLearner(
  page: Page,
  name: string,
  x: number,
  y: number,
): Promise<boolean> {
  return page.evaluate(
    ({ name: targetName, x: targetX, y: targetY }) => {
      const target = window as DirectDemoWindow;
      const dynamicWindow = window as unknown as Record<string, unknown>;
      const api = [
        dynamicWindow["compass-general-geogebra"],
        dynamicWindow.ggbApplet,
        ...Object.values(dynamicWindow),
      ].find(
        (candidate): candidate is DirectDemoAppletApi =>
          Boolean(
            candidate &&
              typeof candidate === "object" &&
              "setCoords" in candidate &&
              typeof candidate.setCoords === "function",
          ),
      );
      if (!api) return false;
      api.setCoords(targetName, targetX, targetY);
      target.__GEOTUTOR_WORLD_V2_EVENT__?.({
        type: "dragEnd",
        argument: targetName,
      });
      return true;
    },
    { name, x, y },
  );
}

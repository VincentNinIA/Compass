import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Configuration = "convex" | "concave" | "crossed";

type BrowserAppletApi = {
  evalCommand(command: string): boolean;
  setCoords(name: string, x: number, y: number): void;
};

type BrowserWorld = {
  activityId: string;
  epoch: number;
  revision: number;
  objects: Array<{ name: string; owner: string }>;
  configuration?: { type: Configuration };
};

type BrowserActions = {
  register(
    name: string,
    owner: "scaffold" | "student",
    kind?: "point" | "segment",
  ): void;
  learnerInteraction(): void;
};

type BrowserLearningState = {
  phase: string;
  activeMissionId?: string;
  missions: Array<{ missionId: string; status: string }>;
};

type TeacherJourneyWindow = {
  __GEOTUTOR_ACTIONS_V1__?: BrowserActions;
  __GEOTUTOR_LEARNING_V1__?: { getState(): BrowserLearningState };
  __GEOTUTOR_WORLD_V2__?: { world: BrowserWorld };
  __GEOTUTOR_WORLD_V2_EVENT__?: (event: {
    type: string;
    argument?: unknown;
  }) => void;
  __T22_PUBLISHED_API__?: BrowserAppletApi;
};

test("T22-C07 publishes the exact Varignon contract, completes it in a student tab and returns a closed teacher report", async ({
  page,
  context,
}) => {
  const teacherConsoleErrors: string[] = [];
  const studentConsoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") teacherConsoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Professor" }).click();
  await page
    .getByRole("button", { name: "Prepare the Varignon investigation" })
    .click();
  const title = "Varignon — investigate, conjecture, justify";
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page
    .getByRole("combobox", { name: "Maximum proactive help" })
    .selectOption("1");
  await page.getByRole("button", { name: "Open the real preview" }).click();
  await expect(page.getByText("Unpublished student preview")).toBeVisible();
  await expect(
    page.locator(".geometry-teacher-preview .geogebra-scratchpad[data-state=ready]"),
  ).toBeVisible();
  await page.locator(".geometry-teacher-studio").screenshot({
    path: "../../output/playwright/T22-C07-teacher-review.png",
  });
  await page.getByRole("button", { name: "Preview reviewed" }).click();
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "Share the investigation" }).click();
  const studentLink = page.getByRole("link", {
    name: "Open the student view in a new tab",
  });
  await expect(studentLink).toBeVisible();

  const studentHref = await studentLink.getAttribute("href");
  if (!studentHref) throw new Error("Student publication link is missing.");
  const publicationId = new URL(studentHref, page.url()).searchParams.get(
    "teacherExercise",
  );
  expect(publicationId).toMatch(/^teacher_/);
  const publishedContract = await page.evaluate(async (id) => {
    const response = await fetch("/api/teacher/exercises", { cache: "no-store" });
    const payload = (await response.json()) as { exercises: Array<Record<string, unknown>> };
    return payload.exercises.find((exercise) => exercise.id === id);
  }, publicationId);
  expect(publishedContract).toMatchObject({
    schemaVersion: "teacher_exercise_publication.v2",
    content: {
      kind: "geometry_investigation",
      exercise: {
        title,
        assistancePolicy: { maxProactiveLevel: 1 },
        missions: expect.arrayContaining([
          expect.objectContaining({ id: "V1" }),
          expect.objectContaining({ id: "V9" }),
        ]),
      },
    },
  });

  const studentPagePromise = context.waitForEvent("page");
  await studentLink.click();
  const student = await studentPagePromise;
  student.on("console", (message) => {
    if (message.type() === "error") studentConsoleErrors.push(message.text());
  });
  await student.setViewportSize({ width: 390, height: 844 });
  await student.waitForLoadState("domcontentloaded");
  await expect(student.getByRole("heading", { name: title })).toBeVisible();
  await expect(
    student.locator(".geogebra-scratchpad[data-state=ready]"),
  ).toBeVisible();
  await student.waitForFunction(
    () => {
      const target = window as unknown as TeacherJourneyWindow;
      return Boolean(
        target.__GEOTUTOR_ACTIONS_V1__ &&
          target.__GEOTUTOR_LEARNING_V1__ &&
          target.__GEOTUTOR_WORLD_V2__?.world.objects.length === 8,
      );
    },
  );
  expect(await constructLearnerVarignon(student)).toBe(true);
  await waitForMission(student, "V3");

  const investigation = student.locator(".geometry-investigation-panel");
  await investigation
    .getByRole("button", { name: "Capture this case" })
    .click();
  await waitForMission(student, "V4");

  await movePoints(student, {
    A: [0, 0],
    B: [3, 0],
    C: [1, 1],
    D: [0, 3],
  });
  await waitForConfiguration(student, "concave");
  await investigation
    .getByRole("button", { name: "Capture this case" })
    .click();
  await waitForMission(student, "V5");

  await movePoints(student, {
    A: [0, 0],
    B: [4, 3],
    C: [0, 4],
    D: [3, 0],
  });
  await waitForConfiguration(student, "crossed");
  await investigation
    .getByRole("button", { name: "Capture this case" })
    .click();
  await waitForMission(student, "V6");

  const conjecture = "Both pairs of opposite sides remain parallel.";
  await investigation.getByRole("textbox").fill(conjecture);
  await investigation.getByRole("button", { name: "Save my conjecture" }).click();
  await waitForMission(student, "V8");
  for (let step = 0; step < 7; step += 1) {
    await investigation
      .getByRole("button", { name: "I explained this step" })
      .first()
      .click();
  }
  await waitForMission(student, "V9");
  const transfer = "Perpendicular diagonals make adjacent midpoint sides perpendicular.";
  await investigation.getByRole("textbox").fill(transfer);
  await investigation
    .getByRole("button", { name: "Complete the investigation" })
    .click();
  await student.waitForFunction(
    () =>
      (window as unknown as TeacherJourneyWindow).__GEOTUTOR_LEARNING_V1__?.getState()
        .phase === "completed",
  );
  await expect(student.getByText("Investigation complete")).toBeVisible();
  await student.locator(".geometry-evidence-gallery").screenshot({
    path: "../../output/playwright/T22-C07-student-evidence.png",
  });

  for (const width of [390, 768, 1440]) {
    await student.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    expect(
      await student.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }

  await expect(
    page.getByRole("heading", { name: "Varignon session facts" }),
  ).toBeVisible();
  await expect(page.getByText("9/9")).toBeVisible();
  await expect(page.getByText("6/6")).toBeVisible();
  await expect(page.getByText("160", { exact: true })).toBeVisible();
  await expect(page.getByText(conjecture)).toHaveCount(0);
  await expect(page.getByText(transfer)).toHaveCount(0);
  await page.locator(".teacher-geometry-signals").screenshot({
    path: "../../output/playwright/T22-C07-teacher-report.png",
  });

  expect(teacherConsoleErrors).toEqual([]);
  expect(studentConsoleErrors).toEqual([]);
});

test("T22-C07 keeps the geometry editor keyboard-accessible, French and reflowed", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Passer en français" }).click();
  await page
    .getByRole("button", { name: "Professeur", exact: true })
    .click();
  const prepare = page.getByRole("button", {
    name: "Préparer l’investigation Varignon",
  });
  await prepare.focus();
  await expect(prepare).toBeFocused();
  await prepare.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Relisez toute l’investigation." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Titre" })).toHaveValue(
    "Varignon — le quadrilatère des milieux",
  );
  await expect(
    page.getByRole("button", { name: "Partager l’investigation" }),
  ).toBeDisabled();
  const axeResult = await new AxeBuilder({ page })
    .include(".geometry-teacher-studio")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(axeResult.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

async function constructLearnerVarignon(page: Page) {
  return page.evaluate(() => {
    const testWindow = window as unknown as TeacherJourneyWindow;
    const dynamicWindow = window as unknown as Record<string, unknown>;
    const api = [
      dynamicWindow["compass-general-geogebra"],
      dynamicWindow.ggbApplet,
      ...Object.values(dynamicWindow),
    ].find(
      (candidate): candidate is BrowserAppletApi =>
        Boolean(
          candidate &&
            typeof candidate === "object" &&
            "evalCommand" in candidate &&
            typeof candidate.evalCommand === "function" &&
            "setCoords" in candidate &&
            typeof candidate.setCoords === "function",
        ),
    );
    const commands = [
      "E=Midpoint(A,B)",
      "F=Midpoint(B,C)",
      "G=Midpoint(C,D)",
      "H=Midpoint(D,A)",
      "EF=Segment(E,F)",
      "FG=Segment(F,G)",
      "GH=Segment(G,H)",
      "HE=Segment(H,E)",
    ];
    if (!api || !commands.every((command) => api.evalCommand(command))) return false;
    testWindow.__T22_PUBLISHED_API__ = api;
    for (const name of ["E", "F", "G", "H"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "student", "point");
    }
    for (const name of ["EF", "FG", "GH", "HE"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "student", "segment");
    }
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "update",
      argument: ["E", "F", "G", "H", "EF", "FG", "GH", "HE"],
    });
    return true;
  });
}

async function movePoints(
  page: Page,
  points: Record<"A" | "B" | "C" | "D", readonly [number, number]>,
) {
  await page.evaluate((next) => {
    const target = window as unknown as TeacherJourneyWindow;
    target.__GEOTUTOR_ACTIONS_V1__!.learnerInteraction();
    for (const [name, [x, y]] of Object.entries(next)) {
      target.__T22_PUBLISHED_API__!.setCoords(name, x, y);
    }
    target.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "dragEnd",
      argument: Object.keys(next),
    });
  }, points);
}

async function waitForMission(page: Page, missionId: string) {
  await page.waitForFunction(
    (expected) =>
      (window as unknown as TeacherJourneyWindow).__GEOTUTOR_LEARNING_V1__?.getState()
        .activeMissionId === expected,
    missionId,
  );
}

async function waitForConfiguration(page: Page, configuration: Configuration) {
  await page.waitForFunction(
    (expected) =>
      (window as unknown as TeacherJourneyWindow).__GEOTUTOR_WORLD_V2__?.world
        .configuration?.type === expected,
    configuration,
  );
}

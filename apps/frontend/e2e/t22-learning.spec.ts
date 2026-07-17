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
  configuration?: { type: Configuration };
};

type BrowserActions = {
  execute(
    callId: string,
    name: string,
    arguments_: Record<string, unknown>,
    turnId?: string,
  ): Promise<{ ok: boolean; data?: Record<string, unknown> }>;
  setAuthority(authority: Record<string, unknown>): void;
  register(
    name: string,
    owner: "scaffold" | "student",
    kind?: "point" | "segment",
  ): void;
  learnerInteraction(): void;
};

type BrowserMission = {
  missionId: string;
  status: "locked" | "active" | "completed" | "verified";
};

type BrowserLearningState = {
  phase: string;
  activeMissionId?: string;
  missions: BrowserMission[];
  demonstrationsViewed: string[];
  assistance: { highestLevelUsed: number };
};

type BrowserLearning = {
  getState(): BrowserLearningState;
  recordAttempt(actionId: string): Record<string, unknown> | undefined;
  report(): Record<string, unknown>;
  realtimeContext(): Record<string, unknown>;
};

type LearningWindow = {
  __GEOTUTOR_ACTIONS_V1__?: BrowserActions;
  __GEOTUTOR_LEARNING_V1__?: BrowserLearning;
  __GEOTUTOR_WORLD_V2__?: { world: BrowserWorld };
  __GEOTUTOR_WORLD_V2_EVENT__?: (event: {
    type: string;
    argument?: unknown;
  }) => void;
  __T22_LEARNING_API__?: BrowserAppletApi;
};

test("T22-C06 completes the nine local Varignon missions with bounded help and a closed report", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/?demo=geogebra&t22Learning=1");
  await expect(page.locator(".geogebra-scratchpad[data-state=ready]")).toBeVisible();
  await expect(page.locator(".geometry-investigation-panel")).toBeVisible();
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as LearningWindow).__GEOTUTOR_ACTIONS_V1__ &&
          (window as unknown as LearningWindow).__GEOTUTOR_LEARNING_V1__ &&
          (window as unknown as LearningWindow).__GEOTUTOR_WORLD_V2__,
      ),
  );

  const interventionSequence = await page.evaluate(() => {
    const learning = (window as unknown as LearningWindow).__GEOTUTOR_LEARNING_V1__!;
    return [
      learning.recordAttempt("blocked_midpoint_1"),
      learning.recordAttempt("blocked_midpoint_2"),
      learning.recordAttempt("blocked_midpoint_3"),
    ];
  });
  expect(interventionSequence).toEqual([
    { type: "SILENT", reason: "first_block" },
    expect.objectContaining({
      type: "SPEAK",
      reason: "repeated_block",
      directive: expect.objectContaining({ level: 1, missionId: "V1" }),
    }),
    { type: "SILENT", reason: "already_helped" },
  ]);

  expect(await createVarignonConstruction(page)).toBe(true);
  await waitForMission(page, "V3");
  expect((await missionStatuses(page)).slice(0, 3)).toMatchObject([
    { missionId: "V1", status: "verified" },
    { missionId: "V2", status: "verified" },
    { missionId: "V3", status: "active" },
  ]);

  await captureCurrent(page, "V3", "convex");
  await waitForMission(page, "V4");

  await moveLearnerPoints(page, {
    A: [0, 0],
    B: [3, 0],
    C: [1, 1],
    D: [0, 3],
  });
  await waitForConfiguration(page, "concave");
  await captureCurrent(page, "V4", "concave");
  await waitForMission(page, "V5");

  await moveLearnerPoints(page, {
    A: [0, 0],
    B: [4, 3],
    C: [0, 4],
    D: [3, 0],
  });
  await waitForConfiguration(page, "crossed");
  await captureCurrent(page, "V5", "crossed");
  await waitForMission(page, "V6");

  const investigation = page.locator(".geometry-investigation-panel");
  const conjecture = "Les côtés opposés de EFGH semblent rester parallèles.";
  await investigation.getByRole("textbox").fill(conjecture);
  await investigation
    .getByRole("button", { name: "Conserver ma conjecture" })
    .click();
  await waitForMission(page, "V8");
  expect((await missionStatuses(page))[6]).toMatchObject({
    missionId: "V7",
    status: "verified",
  });

  for (let step = 0; step < 7; step += 1) {
    await investigation
      .getByRole("button", { name: "J’ai expliqué cette étape" })
      .first()
      .click();
  }
  await waitForMission(page, "V9");

  const transfer = "Les diagonales AC et BD doivent être perpendiculaires.";
  await investigation.getByRole("textbox").fill(transfer);
  await investigation
    .getByRole("button", { name: "Terminer l’investigation" })
    .click();
  await page.waitForFunction(
    () =>
      (window as unknown as LearningWindow).__GEOTUTOR_LEARNING_V1__?.getState()
        .phase === "completed",
  );
  await expect(page.getByText("Investigation terminée")).toBeVisible();

  const result = await page.evaluate(() => {
    const learning = (window as unknown as LearningWindow).__GEOTUTOR_LEARNING_V1__!;
    return {
      state: learning.getState(),
      report: learning.report(),
      realtime: learning.realtimeContext(),
    };
  });
  expect(result.state.missions.map(({ status }) => status)).toEqual([
    "verified",
    "verified",
    "verified",
    "verified",
    "verified",
    "completed",
    "verified",
    "verified",
    "completed",
  ]);
  expect(result.state.demonstrationsViewed).toEqual([]);
  expect(result.report).toMatchObject({
    schemaVersion: "geometry_learning_session_report.v1",
    totalMissions: 9,
    completedMissions: 9,
    verifiedMissions: 7,
    capturedConfigurations: ["convex", "concave", "crossed"],
    exactMidpoints: 4,
    verifiedParallelPairs: 6,
    conjectureCompleted: true,
    justificationCompleted: true,
    transferCompleted: true,
    assistance: { highestLevelUsed: 1, demonstrationsViewed: 0 },
    exerciseXp: 160,
  });
  expect(result.realtime).toMatchObject({
    schemaVersion: "geometry_realtime_pedagogy_context.v1",
    phase: "completed",
    capturedConfigurations: ["convex", "concave", "crossed"],
    maxHelpLevel: 0,
  });
  const serializedReport = JSON.stringify(result.report);
  expect(serializedReport).not.toContain(conjecture);
  expect(serializedReport).not.toContain(transfer);
  expect(serializedReport).not.toMatch(/learner(Name|Id)|email|identity/i);

  await page.locator(".geometry-investigation-panel").screenshot({
    path: "../../output/playwright/T22-C06-nine-missions.png",
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function createVarignonConstruction(page: Page) {
  return page.evaluate(() => {
    const testWindow = window as unknown as LearningWindow;
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
    if (!api || !commands.every((command) => api.evalCommand(command))) return false;
    testWindow.__T22_LEARNING_API__ = api;
    for (const name of ["A", "B", "C", "D"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "scaffold", "point");
    }
    for (const name of ["AB", "BC", "CD", "DA"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "scaffold", "segment");
    }
    for (const name of ["E", "F", "G", "H"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "student", "point");
    }
    for (const name of ["EF", "FG", "GH", "HE"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "student", "segment");
    }
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "update",
      argument: commands.map((command) => command.split("=")[0]),
    });
    return true;
  });
}

async function moveLearnerPoints(
  page: Page,
  points: Record<"A" | "B" | "C" | "D", readonly [number, number]>,
) {
  await page.evaluate((nextPoints) => {
    const testWindow = window as unknown as LearningWindow;
    testWindow.__GEOTUTOR_ACTIONS_V1__!.learnerInteraction();
    for (const [name, [x, y]] of Object.entries(nextPoints)) {
      testWindow.__T22_LEARNING_API__!.setCoords(name, x, y);
    }
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "dragEnd",
      argument: Object.keys(nextPoints),
    });
  }, points);
}

async function captureCurrent(
  page: Page,
  missionId: "V3" | "V4" | "V5",
  configuration: Configuration,
) {
  const result = await page.evaluate(
    async ({ activeMission, activeConfiguration }) => {
      const testWindow = window as unknown as LearningWindow;
      const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
      const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
      actions.setAuthority({
        phase: "investigating",
        actor: "learner",
        maxLevel: "O2",
        missionId: activeMission,
        learnerActionCurrent: true,
      });
      return actions.execute(
        `learning-capture-${activeConfiguration}-${world.epoch}-${world.revision}`,
        "capture_geometry_evidence",
        {
          activityId: world.activityId,
          epoch: world.epoch,
          revision: world.revision,
          missionId: activeMission,
          configuration: activeConfiguration,
          requiredFactIds: [`rel_configuration_${activeConfiguration}`],
        },
        `learning-capture-turn-${activeConfiguration}-${world.revision}`,
      );
    },
    { activeMission: missionId, activeConfiguration: configuration },
  );
  expect(result).toMatchObject({
    ok: true,
    data: {
      status: "stored",
      capture: { missionId, configuration, actor: "learner" },
    },
  });
}

async function waitForConfiguration(page: Page, configuration: Configuration) {
  await page.waitForFunction(
    (expected) =>
      (window as unknown as LearningWindow).__GEOTUTOR_WORLD_V2__?.world
        .configuration?.type === expected,
    configuration,
  );
}

async function waitForMission(page: Page, missionId: string) {
  await page.waitForFunction(
    (expected) =>
      (window as unknown as LearningWindow).__GEOTUTOR_LEARNING_V1__?.getState()
        .activeMissionId === expected,
    missionId,
  );
}

async function missionStatuses(page: Page): Promise<BrowserMission[]> {
  return page.evaluate(
    () =>
      (window as unknown as LearningWindow).__GEOTUTOR_LEARNING_V1__!.getState()
        .missions,
  );
}

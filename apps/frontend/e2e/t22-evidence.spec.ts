import { expect, test } from "@playwright/test";

type Configuration = "convex" | "concave" | "crossed";

type ActionEnvelope = {
  ok: boolean;
  revision: number;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
};

type BrowserEvidence = {
  id: string;
  configuration: Configuration;
  checkpointId: string;
  snapshotHash: string;
  actor: "learner" | "assistant_demo";
  objectNames: string[];
};

type BrowserActions = {
  execute(
    callId: string,
    name: string,
    arguments_: Record<string, unknown>,
    turnId?: string,
  ): Promise<ActionEnvelope>;
  setAuthority(authority: Record<string, unknown>): void;
  issueRestoreConfirmation(checkpointId: string): string | undefined;
  issueDemonstrationConsent(
    stepId: string,
    speed: "reduced" | "normal",
  ): string | undefined;
  listEvidence(): BrowserEvidence[];
  evidenceReport(): Record<string, unknown>;
  register(
    name: string,
    owner: "scaffold" | "student",
    kind?: "point" | "segment",
  ): void;
  learnerInteraction(): void;
  pauseDemonstration(): boolean;
  resumeDemonstration(): boolean;
  stopDemonstration(): boolean;
  listenerCount(): number;
};

type BrowserAppletApi = {
  evalCommand(command: string): boolean;
  getAllObjectNames(): string[];
  setCoords(name: string, x: number, y: number): void;
};

type BrowserWorld = {
  activityId: string;
  epoch: number;
  revision: number;
  snapshotHash: string;
  configuration?: { type: Configuration };
  objects: Array<{ name: string; owner: string }>;
};

type EvidenceWindow = {
  __GEOTUTOR_ACTIONS_V1__?: BrowserActions;
  __GEOTUTOR_WORLD_V2__?: { world: BrowserWorld };
  __GEOTUTOR_WORLD_V2_EVENT__?: (event: {
    type: string;
    argument?: unknown;
  }) => void;
  __T22_EVIDENCE_API__?: BrowserAppletApi;
  __T22_DEMO_PROMISE__?: Promise<ActionEnvelope>;
};

test("T22-C05 captures three real states, restores exactly and stops replay cleanly", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/?demo=geogebra&t22Evidence=1");
  await expect(page.locator(".geogebra-scratchpad[data-state=ready]")).toBeVisible();
  await expect(page.locator(".geometry-evidence-gallery")).toBeVisible();
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as EvidenceWindow).__GEOTUTOR_ACTIONS_V1__ &&
          (window as unknown as EvidenceWindow).__GEOTUTOR_WORLD_V2__,
      ),
  );

  expect(await createVarignonConstruction(page)).toBe(true);
  await waitForConfiguration(page, "convex");

  const convex = await captureCurrent(page, "V3", "convex");
  expect(convex.result).toMatchObject({
    ok: true,
    data: {
      status: "stored",
      capture: { configuration: "convex", actor: "learner" },
    },
  });

  await moveLearnerPoints(page, {
    A: [0, 0],
    B: [3, 0],
    C: [1, 1],
    D: [0, 3],
  });
  await waitForConfiguration(page, "concave");
  const concave = await captureCurrent(page, "V4", "concave");
  expect(concave.result).toMatchObject({
    ok: true,
    data: { capture: { configuration: "concave", actor: "learner" } },
  });

  await moveLearnerPoints(page, {
    A: [0, 0],
    B: [3, 3],
    C: [0, 3],
    D: [3, 0],
  });
  await waitForConfiguration(page, "crossed");
  const crossed = await captureCurrent(page, "V5", "crossed");
  expect(crossed.result).toMatchObject({
    ok: true,
    data: { capture: { configuration: "crossed", actor: "learner" } },
  });

  const gallery = page.locator(".geometry-evidence-gallery");
  await expect(gallery.getByText("Cas convexe")).toBeVisible();
  await expect(gallery.getByText("Cas concave")).toBeVisible();
  await expect(gallery.getByText("Cas croisé")).toBeVisible();
  await gallery.screenshot({
    path: "../../output/playwright/T22-C05-three-captures.png",
  });

  const evidenceState = await page.evaluate(() => {
    const actions = (window as unknown as EvidenceWindow).__GEOTUTOR_ACTIONS_V1__!;
    return {
      captures: actions.listEvidence(),
      report: actions.evidenceReport(),
      listenerCount: actions.listenerCount(),
    };
  });
  expect(evidenceState.captures).toHaveLength(3);
  expect(evidenceState.captures.map(({ configuration }) => configuration)).toEqual([
    "convex",
    "concave",
    "crossed",
  ]);
  expect(evidenceState.report).toMatchObject({
    captureCount: 3,
    learnerCaptures: 3,
    assistantDemoCaptures: 0,
  });
  expect(JSON.stringify(evidenceState)).not.toContain("UEsDB");

  const concaveCapture = evidenceState.captures.find(
    ({ configuration }) => configuration === "concave",
  )!;
  const restored = await page.evaluate(async (checkpointId) => {
    const testWindow = window as unknown as EvidenceWindow;
    const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
    const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
    actions.setAuthority({
      phase: "investigating",
      actor: "assistant",
      maxLevel: "O4",
      missionId: "V7",
      learnerActionCurrent: false,
    });
    const confirmationId = actions.issueRestoreConfirmation(checkpointId);
    if (!confirmationId) throw new Error("Restore confirmation missing.");
    return actions.execute(
      `restore-${world.epoch}-${world.revision}`,
      "restore_geometry_checkpoint",
      {
        activityId: world.activityId,
        epoch: world.epoch,
        revision: world.revision,
        checkpointId,
        confirmationId,
      },
      `restore-turn-${world.epoch}-${world.revision}`,
    );
  }, concaveCapture.checkpointId);
  expect(restored).toMatchObject({
    ok: true,
    data: {
      status: "restored",
      recovery: "exact",
      snapshotHash: concaveCapture.snapshotHash,
      inventory: concaveCapture.objectNames,
      listenerCount: evidenceState.listenerCount,
    },
  });
  await waitForConfiguration(page, "concave");

  const beforeReplay = await page.evaluate(() => {
    const testWindow = window as unknown as EvidenceWindow;
    const api = testWindow.__T22_EVIDENCE_API__!;
    return {
      hash: testWindow.__GEOTUTOR_WORLD_V2__!.world.snapshotHash,
      inventory: api.getAllObjectNames().sort(),
      listenerCount: testWindow.__GEOTUTOR_ACTIONS_V1__!.listenerCount(),
    };
  });
  const replayStarted = await page.evaluate(() => {
    const testWindow = window as unknown as EvidenceWindow;
    const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
    const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
    actions.setAuthority({
      phase: "investigating",
      actor: "assistant",
      maxLevel: "O5",
      missionId: "V8",
      attemptedDemonstrationStepIds: ["demo_v8_7"],
    });
    const consentToken = actions.issueDemonstrationConsent(
      "demo_v8_7",
      "normal",
    );
    if (!consentToken) return false;
    testWindow.__T22_DEMO_PROMISE__ = actions.execute(
      `demo-${world.epoch}-${world.revision}`,
      "demonstrate_geometry_step",
      {
        activityId: world.activityId,
        epoch: world.epoch,
        revision: world.revision,
        stepId: "demo_v8_7",
        consentToken,
        speed: "normal",
      },
      `demo-turn-${world.epoch}-${world.revision}`,
    );
    return true;
  });
  expect(replayStarted).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as EvidenceWindow).__GEOTUTOR_ACTIONS_V1__!.pauseDemonstration(),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as EvidenceWindow).__GEOTUTOR_ACTIONS_V1__!.resumeDemonstration(),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as EvidenceWindow).__GEOTUTOR_ACTIONS_V1__!.stopDemonstration(),
    ),
  ).toBe(true);
  const replay = await page.evaluate(
    () => (window as unknown as EvidenceWindow).__T22_DEMO_PROMISE__!,
  );
  expect(replay).toMatchObject({
    ok: true,
    data: {
      status: "cancelled",
      temporaryObjects: [],
      restoration: "checkpoint",
      learnerCompleted: false,
    },
  });
  expect(replay.data).not.toHaveProperty("evidence");

  const afterReplay = await page.evaluate(() => {
    const testWindow = window as unknown as EvidenceWindow;
    const api = testWindow.__T22_EVIDENCE_API__!;
    const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
    return {
      hash: world.snapshotHash,
      inventory: api.getAllObjectNames().sort(),
      helpers: world.objects.filter(({ owner }) =>
        ["assistant", "hint", "temporary"].includes(owner),
      ),
      listenerCount: testWindow.__GEOTUTOR_ACTIONS_V1__!.listenerCount(),
      captures: testWindow.__GEOTUTOR_ACTIONS_V1__!.listEvidence(),
    };
  });
  expect(afterReplay.hash).toBe(beforeReplay.hash);
  expect(afterReplay.inventory).toEqual(beforeReplay.inventory);
  expect(afterReplay.listenerCount).toBe(beforeReplay.listenerCount);
  expect(afterReplay.helpers).toEqual([]);
  expect(afterReplay.captures).toHaveLength(3);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function createVarignonConstruction(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const testWindow = window as unknown as EvidenceWindow;
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
            "getAllObjectNames" in candidate &&
            typeof candidate.getAllObjectNames === "function",
        ),
    );
    const commands = [
      "A=(-4,-1)",
      "B=(-1,-3)",
      "C=(4,-1)",
      "D=(1,3)",
      "E=Midpoint(A,B)",
      "F=Midpoint(B,C)",
      "G=Midpoint(C,D)",
      "H=Midpoint(D,A)",
    ];
    if (!api || !commands.every((command) => api.evalCommand(command))) return false;
    testWindow.__T22_EVIDENCE_API__ = api;
    for (const name of ["A", "B", "C", "D"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "scaffold", "point");
    }
    for (const name of ["E", "F", "G", "H"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "student", "point");
    }
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "update",
      argument: ["A", "B", "C", "D", "E", "F", "G", "H"],
    });
    return true;
  });
}

async function moveLearnerPoints(
  page: import("@playwright/test").Page,
  points: Record<"A" | "B" | "C" | "D", readonly [number, number]>,
) {
  await page.evaluate((nextPoints) => {
    const testWindow = window as unknown as EvidenceWindow;
    const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
    const api = testWindow.__T22_EVIDENCE_API__!;
    actions.learnerInteraction();
    for (const [name, [x, y]] of Object.entries(nextPoints)) {
      api.setCoords(name, x, y);
    }
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "dragEnd",
      argument: Object.keys(nextPoints),
    });
  }, points);
}

async function waitForConfiguration(
  page: import("@playwright/test").Page,
  configuration: Configuration,
) {
  await page.waitForFunction(
    (expected) =>
      (window as unknown as EvidenceWindow).__GEOTUTOR_WORLD_V2__?.world
        .configuration?.type === expected,
    configuration,
  );
}

async function captureCurrent(
  page: import("@playwright/test").Page,
  missionId: "V3" | "V4" | "V5",
  configuration: Configuration,
) {
  return page.evaluate(
    async ({ missionId: activeMission, configuration: activeConfiguration }) => {
      const testWindow = window as unknown as EvidenceWindow;
      const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
      const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
      actions.setAuthority({
        phase: "investigating",
        actor: "learner",
        maxLevel: "O2",
        missionId: activeMission,
        learnerActionCurrent: true,
      });
      const result = await actions.execute(
        `capture-${activeConfiguration}-${world.epoch}-${world.revision}`,
        "capture_geometry_evidence",
        {
          activityId: world.activityId,
          epoch: world.epoch,
          revision: world.revision,
          missionId: activeMission,
          configuration: activeConfiguration,
          requiredFactIds: [`rel_configuration_${activeConfiguration}`],
        },
        `capture-turn-${activeConfiguration}-${world.epoch}-${world.revision}`,
      );
      return { result, world };
    },
    { missionId, configuration },
  );
}

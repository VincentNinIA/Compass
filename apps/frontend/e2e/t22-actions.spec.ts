import { expect, test } from "@playwright/test";

type ActionEnvelope = {
  ok: boolean;
  revision: number;
  data?: Record<string, unknown>;
  error?: { code: string };
};

type BrowserActions = {
  execute(
    callId: string,
    name: string,
    arguments_: Record<string, unknown>,
    turnId?: string,
  ): Promise<ActionEnvelope>;
  setAuthority(authority: Record<string, unknown>): void;
  register(name: string, owner: "scaffold" | "student", kind?: "point" | "segment"): void;
  cleanup(): { ok: boolean; restored: string[] };
};

type BrowserAppletApi = {
  evalCommand(command: string): boolean;
  getAllObjectNames(): string[];
  getColor(name: string): string;
  getLineThickness(name: string): number;
  getMode(): number;
  getViewProperties(viewId?: number): string | Record<string, unknown>;
  getVisible(name: string): boolean;
};

type ActionsWindow = {
  __GEOTUTOR_ACTIONS_V1__?: BrowserActions;
  __GEOTUTOR_WORLD_V2__?: {
    world: {
      activityId: string;
      epoch: number;
      revision: number;
      configuration?: { type: string };
      objects: Array<{ name: string; owner: string }>;
    };
  };
  __GEOTUTOR_WORLD_V2_EVENT__?: (event: {
    type: string;
    argument?: unknown;
  }) => void;
};

test("T22-C04 previews and applies a bounded target variation on the real applet", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/?demo=geogebra&t22Actions=1");
  await expect(page.locator(".geogebra-scratchpad[data-state=ready]")).toBeVisible();
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as ActionsWindow).__GEOTUTOR_ACTIONS_V1__ &&
          (window as unknown as ActionsWindow).__GEOTUTOR_WORLD_V2__,
      ),
  );

  const created = await page.evaluate(() => {
    const testWindow = window as unknown as ActionsWindow;
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
      "AB=Segment(A,B)",
      "BC=Segment(B,C)",
      "CD=Segment(C,D)",
      "DA=Segment(D,A)",
    ];
    if (!api || !commands.every((command) => api.evalCommand(command))) return false;
    dynamicWindow.__T22_ACTIONS_API__ = api;
    for (const name of ["A", "B", "C", "D"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "scaffold", "point");
    }
    for (const name of ["AB", "BC", "CD", "DA"]) {
      testWindow.__GEOTUTOR_ACTIONS_V1__?.register(name, "scaffold", "segment");
    }
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "update",
      argument: ["A", "B", "C", "D", "AB", "BC", "CD", "DA"],
    });
    return true;
  });
  expect(created).toBe(true);
  await page.waitForFunction(() => {
    const world = (window as unknown as ActionsWindow).__GEOTUTOR_WORLD_V2__?.world;
    return world?.objects.filter(({ name }) => ["A", "B", "C", "D"].includes(name))
      .every(({ owner }) => owner === "scaffold");
  });

  const tool = await page.evaluate(async () => {
    const testWindow = window as unknown as ActionsWindow;
    const api = (window as unknown as Record<string, unknown>)
      .__T22_ACTIONS_API__ as BrowserAppletApi;
    const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
    const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
    actions.setAuthority({
      phase: "investigating",
      actor: "assistant",
      maxLevel: "O2",
      missionId: "V1",
      uiGuidanceAllowed: true,
    });
    const beforeNames = api.getAllObjectNames();
    const result = await actions.execute(
      "activate-midpoint-real",
      "activate_geometry_tool",
      {
        activityId: world.activityId,
        epoch: world.epoch,
        revision: world.revision,
        tool: "midpoint",
      },
      "real-tool-turn",
    );
    return {
      result,
      beforeNames,
      afterNames: api.getAllObjectNames(),
      mode: api.getMode(),
    };
  });
  expect(tool.result).toMatchObject({
    ok: true,
    data: { tool: "midpoint", mode: 19, createdObjects: 0 },
  });
  expect(tool.afterNames).toEqual(tool.beforeNames);
  expect(tool.mode).toBe(19);
  await page.locator(".geogebra-scratchpad").screenshot({
    path: "../../output/playwright/T22-C04-midpoint-tool.png",
  });

  const highlight = await page.evaluate(async () => {
    const testWindow = window as unknown as ActionsWindow;
    const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
    actions.cleanup();
    const api = (window as unknown as Record<string, unknown>)
      .__T22_ACTIONS_API__ as BrowserAppletApi;
    const original = {
      color: api.getColor("A"),
      thickness: api.getLineThickness("A"),
      visible: api.getVisible("A"),
    };
    const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
    const result = await actions.execute(
      "highlight-a-real",
      "highlight_geometry_objects",
      {
        activityId: world.activityId,
        epoch: world.epoch,
        revision: world.revision,
        names: ["A"],
        style: "hint",
        durationMs: 8_000,
      },
      "real-highlight-turn",
    );
    const active = {
      color: api.getColor("A"),
      thickness: api.getLineThickness("A"),
      visible: api.getVisible("A"),
    };
    const cleanup = actions.cleanup();
    const restored = {
      color: api.getColor("A"),
      thickness: api.getLineThickness("A"),
      visible: api.getVisible("A"),
    };
    return { result, original, active, cleanup, restored };
  });
  expect(highlight.result, JSON.stringify(highlight)).toMatchObject({ ok: true });
  expect(highlight.active).not.toEqual(highlight.original);
  expect(highlight.cleanup).toMatchObject({ ok: true });
  expect(highlight.restored).toEqual(highlight.original);

  const focus = await page.evaluate(async () => {
    const testWindow = window as unknown as ActionsWindow;
    const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
    actions.setAuthority({ missionId: "V6", maxLevel: "O2" });
    const api = (window as unknown as Record<string, unknown>)
      .__T22_ACTIONS_API__ as BrowserAppletApi;
    const previous = api.getViewProperties(1);
    const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
    const result = await actions.execute(
      "focus-abcd-real",
      "focus_geometry_view",
      {
        activityId: world.activityId,
        epoch: world.epoch,
        revision: world.revision,
        target: { kind: "objects", names: ["A", "B", "C", "D"] },
        margin: 0.2,
      },
      "real-focus-turn",
    );
    const focused = api.getViewProperties(1);
    const cleanup = actions.cleanup();
    const restored = api.getViewProperties(1);
    return { result, previous, focused, cleanup, restored };
  });
  expect(focus.result).toMatchObject({ ok: true });
  expect(focus.focused).not.toEqual(focus.previous);
  expect(focus.cleanup).toMatchObject({ ok: true });
  expect(viewportBounds(focus.restored)).toEqual(viewportBounds(focus.previous));

  const preview = await page.evaluate(async () => {
    const testWindow = window as unknown as ActionsWindow;
    const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
    const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
    actions.setAuthority({
      missionId: "V4",
      maxLevel: "O2",
    });
    return actions.execute(
      "preview-concave-real",
      "preview_geometry_variation",
      {
        activityId: world.activityId,
        epoch: world.epoch,
        revision: world.revision,
        target: "concave",
        movingPoint: "A",
      },
      "real-preview-turn",
    );
  });
  expect(preview, JSON.stringify(preview)).toMatchObject({
    ok: true,
    data: {
      status: "previewed",
      target: "concave",
      movingPoint: "A",
      geometryChanged: false,
      evidenceCreated: false,
    },
  });
  await expect(
    page.locator("[data-geometry-guidance='movement']"),
  ).toHaveAttribute("data-moving-point", "A");
  await page.locator(".geogebra-scratchpad").screenshot({
    path: "../../output/playwright/T22-C04-variation-preview.png",
  });

  const variation = await page.evaluate(async () => {
    const testWindow = window as unknown as ActionsWindow;
    const actions = testWindow.__GEOTUTOR_ACTIONS_V1__!;
    const world = testWindow.__GEOTUTOR_WORLD_V2__!.world;
    actions.setAuthority({ missionId: "V4", maxLevel: "O3" });
    return actions.execute(
      "variation-concave-real",
      "create_geometry_variation",
      {
        activityId: world.activityId,
        epoch: world.epoch,
        revision: world.revision,
        target: "concave",
        movingPoint: "A",
      },
      "real-variation-turn",
    );
  });
  expect(variation).toMatchObject({
    ok: true,
    data: {
      target: "concave",
      configuration: "concave",
      movingPoint: "A",
      coordinateStrategy: "deterministic-grid-v1",
      evidenceCreated: false,
    },
  });
  expect(variation.data).not.toHaveProperty("x");
  expect(variation.data).not.toHaveProperty("y");
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

function viewportBounds(value: string | Record<string, unknown>) {
  const source = typeof value === "string" ? JSON.parse(value) : value;
  return {
    xMin: rounded(source.xMin),
    yMin: rounded(source.yMin),
    width: rounded(source.width),
    height: rounded(source.height),
    invXscale: rounded(source.invXscale),
    invYscale: rounded(source.invYscale),
  };
}

function rounded(value: unknown) {
  return typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value;
}

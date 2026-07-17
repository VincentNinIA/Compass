import { expect, test } from "@playwright/test";

type BrowserAppletApi = {
  evalCommand(command: string): boolean;
  getAllObjectNames(): string[];
  setCoords(label: string, x: number, y: number): void;
};

type BrowserWorldCommit = {
  world: {
    revision: number;
    snapshotHash: string;
    objects: Array<{
      name: string;
      parents: string[];
      dependencyStatus: string;
      owner: string;
    }>;
    change: { kind: string; objectNames: string[] };
  };
  delta: { change: { kind: string }; changed: Array<{ name: string }> };
};

type BrowserWorldWindow = {
  ggbApplet?: BrowserAppletApi;
  __GEOTUTOR_WORLD_V2__?: BrowserWorldCommit;
  __GEOTUTOR_WORLD_V2_HISTORY__?: BrowserWorldCommit[];
  __GEOTUTOR_WORLD_V2_EVENT__?: (event: {
    type: string;
    argument?: unknown;
  }) => void;
};

test("T22-C02 reads exact dependencies and emits one terminal drag on the real applet", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/?demo=geogebra&t22WorldV2=1");
  await expect(page.locator(".geogebra-scratchpad[data-state=ready]")).toBeVisible();
  await page.waitForFunction(
    () =>
      ((window as unknown as BrowserWorldWindow).__GEOTUTOR_WORLD_V2_HISTORY__?.length ?? 0) >=
      1,
  );

  const created = await page.evaluate(() => {
    const testWindow = window as unknown as BrowserWorldWindow;
    const dynamicWindow = window as unknown as Record<string, unknown>;
    const api = [
      dynamicWindow["compass-general-geogebra"],
      testWindow.ggbApplet,
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
    return Boolean(
      api?.evalCommand("A=(-4,-1)") &&
        api.evalCommand("B=(-1,-3)") &&
        api.evalCommand("E=Midpoint(A,B)"),
    );
  });
  expect(created).toBe(true);
  await page.waitForFunction(() => {
    const commit = (window as unknown as BrowserWorldWindow).__GEOTUTOR_WORLD_V2__;
    return commit?.world.objects.some(
      ({ name, parents, dependencyStatus }) =>
        name === "E" &&
        dependencyStatus === "known" &&
        parents.join(",") === "A,B",
    );
  });

  const beforeDrag = await page.evaluate(
    () => (window as unknown as BrowserWorldWindow).__GEOTUTOR_WORLD_V2_HISTORY__?.length ?? 0,
  );
  await page.evaluate(() => {
    const testWindow = window as unknown as BrowserWorldWindow;
    const dynamicWindow = window as unknown as Record<string, unknown>;
    const api = [dynamicWindow["compass-general-geogebra"], testWindow.ggbApplet]
      .find(
        (candidate): candidate is BrowserAppletApi =>
          Boolean(
            candidate &&
              typeof candidate === "object" &&
              "setCoords" in candidate &&
              typeof candidate.setCoords === "function",
          ),
      );
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "movingGeos",
      argument: "A",
    });
    api?.setCoords("A", -3.5, -1.5);
  });
  await page.waitForTimeout(350);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as BrowserWorldWindow).__GEOTUTOR_WORLD_V2_HISTORY__?.length ?? 0,
    ),
  ).toBe(beforeDrag);

  await page.evaluate(() => {
    const testWindow = window as unknown as BrowserWorldWindow;
    const dynamicWindow = window as unknown as Record<string, unknown>;
    const api = [dynamicWindow["compass-general-geogebra"], testWindow.ggbApplet]
      .find(
        (candidate): candidate is BrowserAppletApi =>
          Boolean(
            candidate &&
              typeof candidate === "object" &&
              "setCoords" in candidate &&
              typeof candidate.setCoords === "function",
          ),
      );
    api?.setCoords("A", -3, -2);
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "dragEnd",
      argument: "A",
    });
  });
  await page.waitForFunction(
    ({ expectedLength }) => {
      const history = (window as unknown as BrowserWorldWindow).__GEOTUTOR_WORLD_V2_HISTORY__;
      return (
        history?.length === expectedLength &&
        history.at(-1)?.world.change.kind === "drag_end"
      );
    },
    { expectedLength: beforeDrag + 1 },
  );

  const terminal = await page.evaluate<BrowserWorldCommit | undefined>(
    () => (window as unknown as BrowserWorldWindow).__GEOTUTOR_WORLD_V2_HISTORY__?.at(-1),
  );
  expect(terminal).toMatchObject({
    world: {
      change: { kind: "drag_end" },
    },
    delta: { change: { kind: "drag_end" } },
  });
  expect(terminal?.world.change.objectNames).toEqual(expect.arrayContaining(["A"]));
  expect(terminal?.world.objects.find(({ name }) => name === "E")?.owner).toBe(
    "student",
  );
  expect(consoleErrors).toEqual([]);
});

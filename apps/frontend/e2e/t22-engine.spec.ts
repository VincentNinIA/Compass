import { expect, test } from "@playwright/test";

type BrowserAppletApi = {
  evalCommand(command: string): boolean;
  getAllObjectNames(): string[];
};

type BrowserEngineCommit = {
  world: {
    epoch: number;
    revision: number;
    snapshotHash: string;
    configuration?: { type: string; revision: number; snapshotHash: string };
    facts: Array<{
      id: string;
      pass: boolean;
      observed: number[];
      epoch: number;
      revision: number;
      snapshotHash: string;
    }>;
  };
};

type BrowserEngineWindow = {
  ggbApplet?: BrowserAppletApi;
  __GEOTUTOR_WORLD_V2__?: BrowserEngineCommit;
  __GEOTUTOR_WORLD_V2_HISTORY__?: BrowserEngineCommit[];
  __GEOTUTOR_WORLD_V2_EVENT__?: (event: {
    type: string;
    argument?: unknown;
  }) => void;
};

test("T22-C03 evaluates Varignon and rejects a free visual midpoint on the real applet", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?demo=geogebra&t22Engine=1");
  await expect(page.locator(".geogebra-scratchpad[data-state=ready]")).toBeVisible();
  await page.waitForFunction(
    () =>
      ((window as unknown as BrowserEngineWindow).__GEOTUTOR_WORLD_V2_HISTORY__
        ?.length ?? 0) >= 1,
  );

  const created = await page.evaluate(() => {
    const testWindow = window as unknown as BrowserEngineWindow;
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
    const success = Boolean(api && commands.every((command) => api.evalCommand(command)));
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({
      type: "update",
      argument: commands.map((command) => command.slice(0, 1)),
    });
    return success;
  });
  expect(created).toBe(true);

  await page.waitForFunction(() => {
    const world = (window as unknown as BrowserEngineWindow).__GEOTUTOR_WORLD_V2__
      ?.world;
    return (
      world?.configuration?.type === "convex" &&
      world.facts.find(({ id }) => id === "rel_midpoint_e")?.pass === true &&
      world.facts.find(({ id }) => id === "rel_parallel_ef_gh")?.pass === true &&
      world.facts.find(({ id }) => id === "rel_parallel_fg_he")?.pass === true
    );
  });

  const exact = await page.evaluate(
    () => (window as unknown as BrowserEngineWindow).__GEOTUTOR_WORLD_V2__,
  );
  expect(exact?.world.facts).toHaveLength(10);
  expect(exact?.world.facts.filter(({ pass }) => pass)).toHaveLength(8);
  expect(exact?.world.facts.find(({ id }) => id === "rel_midpoint_e")?.observed).toEqual([
    0,
    1,
  ]);
  expect(
    exact?.world.facts.every(
      (fact) =>
        fact.epoch === exact.world.epoch &&
        fact.revision === exact.world.revision &&
        fact.snapshotHash === exact.world.snapshotHash,
    ),
  ).toBe(true);
  expect(exact?.world.configuration).toMatchObject({
    type: "convex",
    revision: exact?.world.revision,
    snapshotHash: exact?.world.snapshotHash,
  });

  const replaced = await page.evaluate(() => {
    const testWindow = window as unknown as BrowserEngineWindow;
    const dynamicWindow = window as unknown as Record<string, unknown>;
    const api = [dynamicWindow["compass-general-geogebra"], testWindow.ggbApplet].find(
      (candidate): candidate is BrowserAppletApi =>
        Boolean(
          candidate &&
            typeof candidate === "object" &&
            "evalCommand" in candidate &&
            typeof candidate.evalCommand === "function",
        ),
    );
    const success = Boolean(api?.evalCommand("E=(-2.5,-2)"));
    testWindow.__GEOTUTOR_WORLD_V2_EVENT__?.({ type: "update", argument: "E" });
    return success;
  });
  expect(replaced).toBe(true);
  await page.waitForFunction(
    ({ previousRevision }) => {
      const world = (window as unknown as BrowserEngineWindow).__GEOTUTOR_WORLD_V2__
        ?.world;
      return (
        (world?.revision ?? 0) > previousRevision &&
        world?.facts.find(({ id }) => id === "rel_midpoint_e")?.pass === false
      );
    },
    { previousRevision: exact?.world.revision ?? 0 },
  );

  const visualOnly = await page.evaluate(
    () => (window as unknown as BrowserEngineWindow).__GEOTUTOR_WORLD_V2__,
  );
  expect(
    visualOnly?.world.facts.find(({ id }) => id === "rel_midpoint_e"),
  ).toMatchObject({ pass: false, observed: [0, 0] });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

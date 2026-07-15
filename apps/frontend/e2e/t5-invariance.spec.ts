import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

type InvarianceAppletApi = {
  deleteObject(name: string): void;
  evalCommand(command: string): boolean;
  exists(name: string): boolean;
  getAllObjectNames(): string[];
  getValue(name: string): number;
  getXcoord(name: string): number;
  getYcoord(name: string): number;
  setCoords(name: string, x: number, y: number): void;
};

type BrowserSample = {
  index: number;
  parameter: number;
  coords: [number, number];
  pa: number;
  pb: number;
  delta: number;
  finite: boolean;
  stable: boolean;
  onLine: boolean;
  pass: boolean;
};

const PLAYWRIGHT_OUTPUT = path.resolve(
  process.cwd(),
  "../../output/playwright",
);

const exerciseImage = {
  name: "clear-en.jpg",
  mimeType: "image/jpeg",
  buffer: readFileSync(
    path.join(process.cwd(), "test-fixtures", "t3-exercise", "clear-en.jpg"),
  ),
};

const readyExercise = {
  status: "ready",
  extraction: {
    schemaVersion: "exercise_extraction.v1",
    outcome: "ready",
    language: "en",
    instruction: "Construct the perpendicular bisector of segment AB.",
    pointLabels: ["A", "B"],
    segmentEndpoints: ["A", "B"],
    requestedConstruction: "perpendicular_bisector",
    learningObjective: "perpendicular_bisector_equidistance",
    ambiguityCode: null,
    clarificationQuestion: null,
    unsupportedReason: null,
  },
  plan: {
    schemaVersion: "exercise_plan.v1",
    exerciseId: "demo-perpendicular-bisector-01",
    givens: [
      { kind: "point", label: "A", coordinates: { x: -3, y: 0 } },
      { kind: "point", label: "B", coordinates: { x: 3, y: 0 } },
      { kind: "segment", label: "AB", endpoints: ["A", "B"] },
    ],
    studentMustCreate: ["perpendicular_bisector_of_AB"],
    targetRelations: [
      {
        relation: "perpendicular",
        subject: "perpendicular_bisector_of_AB",
        reference: "AB",
      },
      {
        relation: "passes_through_midpoint",
        subject: "perpendicular_bisector_of_AB",
        reference: "AB",
      },
    ],
    initializationPolicy: "create_givens_only",
  },
};

async function initializeCandidate(page: Page, expression: string) {
  await page.route("**/api/exercise/parse", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyExercise),
    }),
  );
  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();
  await page.locator("#exercise-photo-input").setInputFiles(exerciseImage);
  await page.getByRole("button", { name: "Read my exercise" }).click();
  await page.getByRole("button", { name: "Looks right — start building" }).click();
  await expect(page.getByText(/Canvas initialized with A, B and AB only/)).toBeVisible();
  await page.evaluate((candidateExpression) => {
    const api = (window as Window & { ggbApplet?: InvarianceAppletApi })
      .ggbApplet;
    if (!api?.evalCommand(`studentBisector = ${candidateExpression}`)) {
      throw new Error("Could not create the candidate line.");
    }
  }, expression);
  const progress = page.getByTestId("construction-progress");
  await expect(progress).toContainText("2/2");
  await expect(
    page.getByRole("region", { name: "Five-position experiment" })
      .getByRole("button", { name: "Run experiment" }),
  ).toBeEnabled();
}

async function installRealtimeProbe(page: Page) {
  await page.evaluate(() => {
    const probeWindow = window as Window & {
      __T5_OOB_AUDIO__?: {
        context: AudioContext;
        oscillator: OscillatorNode;
        destination: MediaStreamAudioDestinationNode;
      };
      __T5_OOB_CLIENT_EVENTS__?: Array<Record<string, unknown>>;
      __T5_OOB_SERVER_EVENTS__?: Array<Record<string, unknown>>;
    };
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    navigator.mediaDevices.getUserMedia = async () => {
      await context.resume();
      return destination.stream;
    };
    const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = createDataChannel.apply(this, args);
      probeWindow.__T5_OOB_CLIENT_EVENTS__ = [];
      probeWindow.__T5_OOB_SERVER_EVENTS__ = [];
      const send = channel.send.bind(channel) as (data: string) => void;
      Object.defineProperty(channel, "send", {
        value: (data: string) => {
          try {
            probeWindow.__T5_OOB_CLIENT_EVENTS__?.push(
              JSON.parse(String(data)) as Record<string, unknown>,
            );
          } catch {
            // The test probe records only valid JSON application events.
          }
          send(data);
        },
      });
      channel.addEventListener("message", (message) => {
        try {
          probeWindow.__T5_OOB_SERVER_EVENTS__?.push(
            JSON.parse(String(message.data)) as Record<string, unknown>,
          );
        } catch {
          // The test probe records only valid JSON application events.
        }
      });
      return channel;
    };
    probeWindow.__T5_OOB_AUDIO__ = { context, oscillator, destination };
  });
}

test("T5-C03 real applet measures five finite positions and restores its inventory", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();

  const evidence = await page.evaluate(async () => {
    const api = (window as Window & { ggbApplet?: InvarianceAppletApi })
      .ggbApplet;
    if (!api) throw new Error("GeoGebra API unavailable.");
    const parameters = [-1, -0.5, 0, 0.5, 1] as const;
    const before = [...api.getAllObjectNames()].map(String).sort();
    const created: string[] = [];
    const create = (name: string, expression: string) => {
      if (!api.evalCommand(`${name} = ${expression}`)) {
        throw new Error(`GeoGebra rejected ${name}.`);
      }
      created.push(name);
    };
    const read = (prefix: string) => [
      api.getXcoord(`${prefix}P`),
      api.getYcoord(`${prefix}P`),
      api.getValue(`${prefix}PA`),
      api.getValue(`${prefix}PB`),
      api.getValue(`${prefix}PC`),
    ] as const;
    const run = async (prefix: string, lineExpression: string) => {
      create(`${prefix}Line`, lineExpression);
      create(`${prefix}P`, `Point(${prefix}Line)`);
      create(`${prefix}PA`, `Distance(${prefix}P,A)`);
      create(`${prefix}PB`, `Distance(${prefix}P,B)`);
      create(`${prefix}PC`, `Distance(${prefix}P,${prefix}Line)`);
      create(
        `${prefix}Origin`,
        `ClosestPoint(${prefix}Line,Midpoint(A,B))`,
      );
      create(`${prefix}Direction`, `UnitVector(${prefix}Line)`);
      create(`${prefix}Scale`, "Distance(A,B)");
      const origin = [
        api.getXcoord(`${prefix}Origin`),
        api.getYcoord(`${prefix}Origin`),
      ] as const;
      const direction = [
        api.getXcoord(`${prefix}Direction`),
        api.getYcoord(`${prefix}Direction`),
      ] as const;
      const scale = api.getValue(`${prefix}Scale`);
      const samples: BrowserSample[] = [];
      for (const [index, parameter] of parameters.entries()) {
        const target = [
          origin[0] + parameter * scale * direction[0],
          origin[1] + parameter * scale * direction[1],
        ] as const;
        api.setCoords(`${prefix}P`, target[0], target[1]);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const first = read(prefix);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const second = read(prefix);
        const delta = Math.abs(second[2] - second[3]);
        samples.push({
          index,
          parameter,
          coords: [second[0], second[1]],
          pa: second[2],
          pb: second[3],
          delta,
          finite: second.every(Number.isFinite),
          stable: second.every(
            (value, offset) => Math.abs(value - first[offset]) <= 1e-9,
          ),
          onLine: second[4] <= 1e-6,
          pass: delta <= 1e-6,
        });
      }
      return samples;
    };

    const leadingUnderscoreAccepted = api.evalCommand(
      "__inv_regression_P = (0,0)",
    );
    if (api.exists("__inv_regression_P")) {
      api.deleteObject("__inv_regression_P");
    }
    let correct: BrowserSample[] = [];
    let incorrect: BrowserSample[] = [];
    try {
      correct = await run(
        "gtInvE2ECorrect",
        "PerpendicularLine(Midpoint(A,B),AB)",
      );
      incorrect = await run(
        "gtInvE2EIncorrect",
        "PerpendicularLine((1,0),AB)",
      );
    } finally {
      for (const name of created.reverse()) {
        if (api.exists(name)) api.deleteObject(name);
      }
    }
    const after = [...api.getAllObjectNames()].map(String).sort();
    return {
      parameters,
      leadingUnderscoreAccepted,
      correct,
      incorrect,
      restored: JSON.stringify(before) === JSON.stringify(after),
    };
  });

  expect(evidence.parameters).toEqual([-1, -0.5, 0, 0.5, 1]);
  expect(evidence.leadingUnderscoreAccepted).toBe(false);
  expect(evidence.correct).toHaveLength(5);
  expect(
    evidence.correct.every(
      ({ finite, stable, onLine, pass }) => finite && stable && onLine && pass,
    ),
  ).toBe(true);
  expect(evidence.incorrect).toHaveLength(5);
  expect(
    evidence.incorrect.every(
      ({ finite, stable, onLine, pass }) =>
        finite && stable && onLine && !pass,
    ),
  ).toBe(true);
  expect(evidence.restored).toBe(true);
});

test("T5-C07 real applet runs C01-C06, acknowledges C04, and renders the C05 fallback without scene drift", async ({
  page,
}) => {
  await initializeCandidate(
    page,
    "PerpendicularLine(Midpoint(A,B),AB)",
  );
  const experiment = page.getByRole("region", {
    name: "Five-position experiment",
  });
  const before = await page.evaluate(() => {
    const api = (window as Window & { ggbApplet?: InvarianceAppletApi })
      .ggbApplet;
    return [...(api?.getAllObjectNames() ?? [])].map(String).sort();
  });

  await experiment.getByRole("button", { name: "Run experiment" }).click();
  await expect(experiment.getByText("Completed", { exact: true })).toBeVisible();
  await expect(
    experiment.getByRole("heading", { name: "What you discovered" }),
  ).toBeVisible();
  await expect(experiment).toContainText(
    "Local deterministic fallback · no live model response",
  );
  await page.waitForFunction(
    () =>
      (window as Window & {
        __GEOTUTOR_INVARIANCE_VERBALIZATION__?: { status?: string };
      }).__GEOTUTOR_INVARIANCE_VERBALIZATION__?.status === "ready",
  );

  const gate = await page.evaluate(() => {
    const state = window as Window & {
      ggbApplet?: InvarianceAppletApi;
      __GEOTUTOR_INVARIANCE_VERBALIZATION__?: {
        status: string;
        trace: Array<{ marker: string; sequence: number }>;
      };
      __GEOTUTOR_INVARIANCE_SUMMARY__?: {
        source: string;
        reason: string;
        responseId: string | null;
        text: string;
      };
      __GEOTUTOR_INVARIANCE_SCENE__?: {
        status: string;
        restoration: string;
        restored: boolean;
        helpers: string[];
        beforeHash: string | null;
        afterHash: string | null;
        studentHashBefore: string | null;
        studentHashAfter: string | null;
        listenerCountBefore: number | null;
        listenerCountAfter: number;
      };
    };
    return {
      names: [...(state.ggbApplet?.getAllObjectNames() ?? [])]
        .map(String)
        .sort(),
      verbalization: state.__GEOTUTOR_INVARIANCE_VERBALIZATION__,
      summary: state.__GEOTUTOR_INVARIANCE_SUMMARY__,
      scene: state.__GEOTUTOR_INVARIANCE_SCENE__,
      persistence: {
        localStorage: Object.keys(localStorage),
        sessionStorage: Object.keys(sessionStorage),
      },
    };
  });

  expect(gate.names).toEqual(before);
  expect(gate.names.some((name) => name.startsWith("gtInv_"))).toBe(false);
  expect(gate.verbalization).toMatchObject({
    status: "ready",
    trace: [
      { marker: "measurements_rendered", sequence: 1 },
      { marker: "policy_evaluated", sequence: 2 },
      { marker: "directive_ready", sequence: 3 },
    ],
  });
  expect(gate.summary).toMatchObject({
    source: "deterministic",
    reason: "send_failed",
    responseId: null,
  });
  expect(gate.summary?.text).toContain(
    "five measurements support the conjecture",
  );
  expect(gate.scene).toMatchObject({
    status: "completed",
    restoration: "cleanup",
    restored: true,
    listenerCountBefore: 4,
    listenerCountAfter: 4,
  });
  expect(gate.scene?.helpers).toHaveLength(7);
  expect(gate.scene?.afterHash).toBe(gate.scene?.beforeHash);
  expect(gate.scene?.studentHashAfter).toBe(gate.scene?.studentHashBefore);
  expect(gate.persistence).toEqual({ localStorage: [], sessionStorage: [] });
  await expect(experiment.getByTestId("invariance-terminal")).toBeFocused();
});

test("T5-C07 incorrect candidate stays local and cannot request a synthesis", async ({
  page,
}) => {
  await page.route("**/api/exercise/parse", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyExercise),
    }),
  );
  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();
  await page.locator("#exercise-photo-input").setInputFiles(exerciseImage);
  await page.getByRole("button", { name: "Read my exercise" }).click();
  await page.getByRole("button", { name: "Looks right — start building" }).click();
  await expect(page.getByText(/Canvas initialized with A, B and AB only/)).toBeVisible();
  await page.evaluate(() => {
    const api = (window as Window & { ggbApplet?: InvarianceAppletApi })
      .ggbApplet;
    if (!api?.evalCommand("wrongLine = PerpendicularLine((1,0),AB)")) {
      throw new Error("Could not create the incorrect candidate.");
    }
  });

  const progress = page.getByTestId("construction-progress");
  await expect(progress).toContainText("1/2");
  const experiment = page.getByRole("region", {
    name: "Five-position experiment",
  });
  await expect(
    experiment.getByRole("button", { name: "Run experiment" }),
  ).toBeDisabled();
  await expect(
    experiment.getByRole("heading", { name: "What you discovered" }),
  ).toHaveCount(0);
});

test("T5-C07 real applet collision forces checkpoint restoration and preserves the student registry", async ({
  page,
}) => {
  await initializeCandidate(
    page,
    "PerpendicularLine(Midpoint(A,B),AB)",
  );
  const collisionName =
    "gtInv_inv_00000000_0000_4000_8000_000000000007_P";
  await page.evaluate((name) => {
    Object.defineProperty(Crypto.prototype, "randomUUID", {
      configurable: true,
      value: () => "00000000-0000-4000-8000-000000000007",
    });
    const api = (window as Window & { ggbApplet?: InvarianceAppletApi })
      .ggbApplet;
    if (!api?.evalCommand(`${name} = (7,7)`)) {
      throw new Error("Could not create the collision fixture.");
    }
  }, collisionName);
  await expect(page.getByTestId("construction-progress")).toContainText("2/2");

  const experiment = page.getByRole("region", {
    name: "Five-position experiment",
  });
  await experiment.getByRole("button", { name: "Run experiment" }).click();
  await expect(experiment.getByText("Failed", { exact: true })).toBeVisible();
  const evidence = await page.evaluate((name) => {
    const state = window as Window & {
      ggbApplet?: InvarianceAppletApi;
      __GEOTUTOR_INVARIANCE_SCENE__?: {
        status: string;
        restoration: string;
        restored: boolean;
        beforeHash: string | null;
        afterHash: string | null;
        studentHashBefore: string | null;
        studentHashAfter: string | null;
        listenerCountBefore: number | null;
        listenerCountAfter: number;
      };
      __GEOTUTOR_INVARIANCE_SUMMARY__?: unknown;
    };
    return {
      collisionPreserved: state.ggbApplet?.exists(name),
      names: [...(state.ggbApplet?.getAllObjectNames() ?? [])].map(String),
      scene: state.__GEOTUTOR_INVARIANCE_SCENE__,
      hasSummary: state.__GEOTUTOR_INVARIANCE_SUMMARY__ !== undefined,
    };
  }, collisionName);
  expect(evidence.collisionPreserved).toBe(true);
  expect(evidence.names.filter((name) => name.startsWith("gtInv_"))).toEqual([
    collisionName,
  ]);
  expect(evidence.scene).toMatchObject({
    status: "failed",
    restoration: "checkpoint",
    restored: true,
    listenerCountBefore: 4,
    listenerCountAfter: 4,
  });
  expect(evidence.scene?.afterHash).toBe(evidence.scene?.beforeHash);
  expect(evidence.scene?.studentHashAfter).toBe(
    evidence.scene?.studentHashBefore,
  );
  expect(evidence.hasSummary).toBe(false);
});

test("@live T5-C07 credentialed OOB summary stays text-only and outside the conversation", async ({
  page,
}) => {
  test.skip(process.env.T0_LIVE !== "1", "Run with the credentialed live gate.");
  await initializeCandidate(
    page,
    "PerpendicularLine(Midpoint(A,B),AB)",
  );
  await installRealtimeProbe(page);
  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(page.getByText("oai-events open", { exact: true })).toBeVisible();

  const experiment = page.getByRole("region", {
    name: "Five-position experiment",
  });
  await experiment.getByRole("button", { name: "Run experiment" }).click();
  await expect(
    experiment.getByRole("heading", { name: "What you discovered" }),
  ).toBeVisible({ timeout: 30_000 });

  const evidence = await page.evaluate(() => {
    const state = window as Window & {
      __T5_OOB_CLIENT_EVENTS__?: Array<{
        type?: unknown;
        response?: Record<string, unknown>;
      }>;
      __T5_OOB_SERVER_EVENTS__?: Array<{
        type?: unknown;
        response?: Record<string, unknown>;
      }>;
      __GEOTUTOR_INVARIANCE_SUMMARY__?: {
        source: string;
        reason: string;
      };
    };
    const oob = state.__T5_OOB_CLIENT_EVENTS__?.find((event) => {
      const metadata = event.response?.metadata as
        | Record<string, unknown>
        | undefined;
      return metadata?.kind === "geotutor_invariance_summary_v1";
    });
    const done = state.__T5_OOB_SERVER_EVENTS__?.find((event) => {
      const metadata = event.response?.metadata as
        | Record<string, unknown>
        | undefined;
      return event.type === "response.done" &&
        metadata?.kind === "geotutor_invariance_summary_v1";
    });
    const doneResponse = done?.response;
    return {
      oob,
      summary: state.__GEOTUTOR_INVARIANCE_SUMMARY__,
      doneShape: doneResponse
        ? {
            status: doneResponse.status,
            conversation_id: doneResponse.conversation_id,
            output_modalities: doneResponse.output_modalities,
            hasAudio: "audio" in doneResponse && doneResponse.audio != null,
            output: doneResponse.output,
          }
        : null,
      conversationItems:
        state.__T5_OOB_CLIENT_EVENTS__?.filter(
          ({ type }) => type === "conversation.item.create",
        ).length ?? 0,
      audioEvents:
        state.__T5_OOB_SERVER_EVENTS__?.filter(
          ({ type }) =>
            typeof type === "string" && type.includes("output_audio"),
        ).length ?? 0,
    };
  });
  expect(evidence).toMatchObject({
    summary: { source: "realtime", reason: "completed" },
    doneShape: {
      status: "completed",
      conversation_id: null,
      output_modalities: ["text"],
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text" }],
        },
      ],
    },
  });
  await expect(experiment).not.toContainText(
    "Local deterministic fallback · no live model response",
  );
  expect(evidence.oob).toMatchObject({
    type: "response.create",
    response: {
      conversation: "none",
      output_modalities: ["text"],
      tools: [],
      tool_choice: "none",
      metadata: { kind: "geotutor_invariance_summary_v1" },
    },
  });
  expect(evidence.conversationItems).toBe(0);
  expect(evidence.audioEvents).toBe(0);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("closed", { exact: true })).toBeVisible();
});

test("T5-C06 real UI is keyboard-operable, reduced-motion safe, cancellable, and reflows at 200%", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();

  const idleExperiment = page.getByRole("region", {
    name: "Five-position experiment",
  });
  await expect(idleExperiment.getByText("Idle", { exact: true })).toBeVisible();
  await expect(
    idleExperiment.getByRole("button", { name: "Run experiment" }),
  ).toBeDisabled();

  await page.evaluate(() => {
    const api = (window as Window & { ggbApplet?: InvarianceAppletApi })
      .ggbApplet;
    if (!api?.evalCommand(
      "studentBisector = PerpendicularLine(Midpoint(A,B),AB)",
    )) {
      throw new Error("Could not create the student perpendicular bisector.");
    }
  });

  const run = idleExperiment.getByRole("button", { name: "Run experiment" });
  await expect(run).toBeEnabled();
  await run.focus();
  await expect(run).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(idleExperiment.getByText("Completed", { exact: true })).toBeVisible();
  const table = idleExperiment.getByRole("table", {
    name: "Measured distances from P to A and B",
  });
  await expect(table.getByRole("row")).toHaveCount(6);
  await expect(table.getByText("Pass", { exact: true })).toHaveCount(5);
  await expect(idleExperiment.getByTestId("invariance-terminal")).toBeFocused();
  await expect(idleExperiment.getByTestId("invariance-announcement")).toHaveText(
    "Equidistance experiment complete. Five of five measurements collected.",
  );

  expect(
    await idleExperiment.locator(".invariance-state-label").evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe("0s");

  await page.setViewportSize({ width: 640, height: 720 });
  await idleExperiment.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await idleExperiment.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await mkdir(PLAYWRIGHT_OUTPUT, { recursive: true });
  await idleExperiment.screenshot({
    path: path.join(PLAYWRIGHT_OUTPUT, "T5-C06-completed-zoom-200.png"),
  });

  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window);
    const testWindow = window as Window & {
      __T5_C06_RAF__?: typeof window.requestAnimationFrame;
    };
    testWindow.__T5_C06_RAF__ = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) =>
      original((time) => window.setTimeout(() => callback(time), 80));
  });
  const rerun = idleExperiment.getByRole("button", { name: "Run again" });
  await rerun.focus();
  await page.keyboard.press("Enter");
  const cancel = idleExperiment.getByRole("button", {
    name: "Cancel experiment",
  });
  await expect(cancel).toBeVisible();
  await cancel.focus();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Space");
  await expect(idleExperiment.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(idleExperiment.getByTestId("invariance-terminal")).toBeFocused();
  await expect(idleExperiment.getByTestId("invariance-announcement")).toHaveText(
    "Equidistance experiment cancelled. The construction was preserved.",
  );
  await expect(idleExperiment.getByRole("table")).toHaveCount(0);
  await page.waitForFunction(
    () =>
      (window as Window & {
        __GEOTUTOR_INVARIANCE_SCENE__?: { status?: string };
      }).__GEOTUTOR_INVARIANCE_SCENE__?.status === "cancelled",
  );
  const cancelledScene = await page.evaluate(
    () =>
      (window as Window & {
        __GEOTUTOR_INVARIANCE_SCENE__?: {
          restoration: string;
          restored: boolean;
          beforeHash: string | null;
          afterHash: string | null;
          studentHashBefore: string | null;
          studentHashAfter: string | null;
          listenerCountBefore: number | null;
          listenerCountAfter: number;
        };
      }).__GEOTUTOR_INVARIANCE_SCENE__,
  );
  expect(cancelledScene).toMatchObject({
    restoration: "checkpoint",
    restored: true,
    listenerCountBefore: 4,
    listenerCountAfter: 4,
  });
  expect(cancelledScene?.afterHash).toBe(cancelledScene?.beforeHash);
  expect(cancelledScene?.studentHashAfter).toBe(
    cancelledScene?.studentHashBefore,
  );
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __T5_C06_RAF__?: typeof window.requestAnimationFrame;
    };
    if (testWindow.__T5_C06_RAF__) {
      window.requestAnimationFrame = testWindow.__T5_C06_RAF__;
      delete testWindow.__T5_C06_RAF__;
    }
  });
});

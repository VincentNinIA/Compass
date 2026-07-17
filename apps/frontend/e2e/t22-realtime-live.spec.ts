import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { GEOMETRY_INVESTIGATION_MODEL_ACTIONS_V1 } from "../lib/geometry-investigation/actions";
import { createTeacherGeometryDraftV2 } from "../lib/teacher/geometry-exercise";

type LiveProbeWindow = Window & {
  __T22_LIVE_CLIENT_EVENTS__?: Array<Record<string, unknown>>;
  __T22_LIVE_SERVER_EVENTS__?: Array<Record<string, unknown>>;
  __T22_LIVE_GET_USER_MEDIA_CALLS__?: number;
  __T22_LIVE_CHANNEL__?: RTCDataChannel;
  __GEOTUTOR_WORLD_V2__?: {
    world: { snapshotHash: string; objects: Array<{ name: string }> };
  };
};

const OUTPUT_ROOT = path.resolve(
  process.cwd(),
  "../../output/audit",
);

test("@t22-live credentialed Realtime negotiates v2, reads the published world and closes", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.T22_LIVE !== "1",
    "Run with pnpm gate:t22:live when a credentialed environment is available.",
  );
  await installLiveProbe(page);
  const routeHeaders: Array<Record<string, string>> = [];
  const routeResults: Array<{ status: number; code?: string }> = [];
  page.on("request", (webRequest) => {
    if (webRequest.url().endsWith("/api/realtime/session")) {
      routeHeaders.push(webRequest.headers());
    }
  });
  page.on("response", async (webResponse) => {
    if (!webResponse.url().endsWith("/api/realtime/session")) return;
    let code: string | undefined;
    if (!webResponse.ok()) {
      try {
        const body = (await webResponse.json()) as {
          error?: { code?: string };
        };
        code = body.error?.code;
      } catch {
        code = "unreadable_error";
      }
    }
    routeResults.push({ status: webResponse.status(), ...(code ? { code } : {}) });
  });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const draft = createTeacherGeometryDraftV2("en");
  const response = await request.post("/api/teacher/exercises", {
    data: { draft },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { publication: { id: string } };
  await page.goto(`/?teacherExercise=${payload.publication.id}`);
  await expect(
    page.locator(".geogebra-scratchpad[data-state=ready]"),
  ).toBeVisible();
  await page.waitForFunction(
    () =>
      (window as LiveProbeWindow).__GEOTUTOR_WORLD_V2__?.world.objects.length ===
      8,
  );
  const hashBefore = await page.evaluate(
    () => (window as LiveProbeWindow).__GEOTUTOR_WORLD_V2__!.world.snapshotHash,
  );

  await page.getByRole("button", { name: "Use live text" }).click();
  await expect.poll(() => routeResults.length).toBe(1);
  if (
    !routeResults[0] ||
    routeResults[0].status < 200 ||
    routeResults[0].status >= 300
  ) {
    throw new Error(`Realtime route failed: ${JSON.stringify(routeResults[0])}`);
  }
  await page.waitForFunction(() => {
    const mode = document
      .querySelector("[data-capability-mode]")
      ?.getAttribute("data-capability-mode");
    const connection = document.querySelector(".connection-state")?.textContent;
    return mode === "typed_live" || connection === "failed" || connection === "closed";
  });
  const connectionDiagnostic = await page.evaluate(() => {
    const target = window as LiveProbeWindow;
    const created = target.__T22_LIVE_SERVER_EVENTS__?.find(
      (event) => event.type === "session.created",
    ) as
      | {
          session?: {
            model?: unknown;
            output_modalities?: unknown;
            tool_choice?: unknown;
            tools?: Array<{ name?: unknown; type?: unknown }>;
            reasoning?: { effort?: unknown };
          };
        }
      | undefined;
    return {
      mode: document
        .querySelector("[data-capability-mode]")
        ?.getAttribute("data-capability-mode"),
      connectionState: document.querySelector(".connection-state")?.textContent,
      timeline: [...document.querySelectorAll(".coach-diagnostics ol li")].map(
        (element) => element.textContent,
      ),
      eventTypes: target.__T22_LIVE_SERVER_EVENTS__?.map((event) => event.type),
      session: created?.session
        ? {
            model: created.session.model,
            outputModalities: created.session.output_modalities,
            toolChoice: created.session.tool_choice,
            toolNames: created.session.tools?.map(({ name }) => name),
            toolTypes: created.session.tools?.map(({ type }) => type),
            reasoningEffort: created.session.reasoning?.effort,
          }
        : undefined,
    };
  });
  if (connectionDiagnostic.mode !== "typed_live") {
    throw new Error(
      `Realtime session rejected: ${JSON.stringify(connectionDiagnostic)}`,
    );
  }
  await expect(page.locator("[data-capability-mode]")).toHaveAttribute(
    "data-capability-mode",
    "typed_live",
  );
  expect(routeHeaders).toHaveLength(1);
  expect(routeHeaders[0]["x-geotutor-tutor-profile"]).toBe("geogebra_tutor");
  expect(routeHeaders[0]["x-geotutor-geometry-harness"]).toBe("v2");

  await page.waitForFunction(() => {
    const target = window as LiveProbeWindow;
    return target.__T22_LIVE_SERVER_EVENTS__?.some(
      (event) => event.type === "session.created",
    );
  });
  const negotiated = await page.evaluate(() => {
    const target = window as LiveProbeWindow;
    const event = target.__T22_LIVE_SERVER_EVENTS__?.find(
      (candidate) => candidate.type === "session.created",
    ) as
      | {
          session?: {
            output_modalities?: string[];
            tools?: Array<{ name?: string; type?: string }>;
            tool_choice?: string;
          };
        }
      | undefined;
    return {
      modalities: event?.session?.output_modalities,
      toolChoice: event?.session?.tool_choice,
      tools: event?.session?.tools?.map(({ name }) => name),
    };
  });
  expect(negotiated).toEqual({
    modalities: ["text"],
    toolChoice: "auto",
    tools: [...GEOMETRY_INVESTIGATION_MODEL_ACTIONS_V1],
  });

  await page.waitForFunction(() => {
    const target = window as LiveProbeWindow;
    return target.__T22_LIVE_CLIENT_EVENTS__?.some((event) => {
      if (event.type !== "conversation.item.create") return false;
      const serialized = JSON.stringify(event);
      return (
        serialized.includes("geometry_world.v2") &&
        serialized.includes("geometry_realtime_pedagogy_context.v1")
      );
    });
  });
  await page
    .getByLabel("Ask your question")
    .fill(
      "Use inspect_geometry_workspace to read the current board, then ask one short question about constructing the four midpoints. Do not mutate anything.",
    );
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByLabel("Live text response")).not.toBeEmpty();
  await page.waitForFunction(() => {
    const target = window as LiveProbeWindow;
    return target.__T22_LIVE_CLIENT_EVENTS__?.some((event) => {
      if (event.type !== "conversation.item.create") return false;
      const item = event.item as { type?: unknown } | undefined;
      return item?.type === "function_call_output";
    });
  });

  const liveEvidence = await page.evaluate(() => {
    const target = window as LiveProbeWindow;
    return {
      getUserMediaCalls: target.__T22_LIVE_GET_USER_MEDIA_CALLS__,
      channelState: target.__T22_LIVE_CHANNEL__?.readyState,
      hash: target.__GEOTUTOR_WORLD_V2__?.world.snapshotHash,
      responseDone: target.__T22_LIVE_SERVER_EVENTS__?.some(
        (event) => event.type === "response.done",
      ),
      toolOutput: target.__T22_LIVE_CLIENT_EVENTS__?.some((event) => {
        const item = event.item as { type?: unknown } | undefined;
        return event.type === "conversation.item.create" &&
          item?.type === "function_call_output";
      }),
      audioEvents: target.__T22_LIVE_SERVER_EVENTS__
        ?.map((event) => String(event.type ?? ""))
        .filter((type) => type.includes("audio")).length,
    };
  });
  expect(liveEvidence).toEqual({
    getUserMediaCalls: 0,
    channelState: "open",
    hash: hashBefore,
    responseDone: true,
    toolOutput: true,
    audioEvents: 0,
  });

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("closed", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as LiveProbeWindow).__T22_LIVE_CHANNEL__?.readyState,
      ),
    )
    .toBe("closed");
  expect(consoleErrors).toEqual([]);

  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(
    path.join(OUTPUT_ROOT, "T22-C08-realtime-smoke.json"),
    `${JSON.stringify(
      {
        schemaVersion: "geotutor_geometry_realtime_smoke.v1",
        result: "pass",
        harness: "v2",
        mode: "typed_live",
        exactToolPalette: true,
        boundedWorldPublished: true,
        pedagogyPublished: true,
        inspectionCompleted: true,
        geometryUnchanged: true,
        microphoneCalls: 0,
        audioEvents: 0,
        resourcesClosed: true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});

async function installLiveProbe(page: Page) {
  await page.addInitScript(() => {
    const target = window as LiveProbeWindow;
    target.__T22_LIVE_CLIENT_EVENTS__ = [];
    target.__T22_LIVE_SERVER_EVENTS__ = [];
    target.__T22_LIVE_GET_USER_MEDIA_CALLS__ = 0;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      target.__T22_LIVE_GET_USER_MEDIA_CALLS__ =
        (target.__T22_LIVE_GET_USER_MEDIA_CALLS__ ?? 0) + 1;
      return getUserMedia(...args);
    };
    const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = createDataChannel.apply(this, args);
      target.__T22_LIVE_CHANNEL__ = channel;
      const send = channel.send.bind(channel) as (data: string) => void;
      Object.defineProperty(channel, "send", {
        value: (data: string) => {
          target.__T22_LIVE_CLIENT_EVENTS__?.push(
            JSON.parse(String(data)) as Record<string, unknown>,
          );
          send(data);
        },
      });
      channel.addEventListener("message", (message) => {
        target.__T22_LIVE_SERVER_EVENTS__?.push(
          JSON.parse(String(message.data)) as Record<string, unknown>,
        );
      });
      return channel;
    };
  });
}

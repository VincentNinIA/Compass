import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

type ReliabilityExport = {
  version: string;
  distributions: Array<{
    name: string;
    sampleCount: number;
    status: string;
    fallback: string;
  }>;
};

type ReliabilityWindow = Window & {
  ggbApplet?: { evalCommand(command: string): boolean };
  __GEOTUTOR_EXPORT_RELIABILITY__?: () => ReliabilityExport;
};

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

async function installVoiceWithoutRemoteAudio(page: Page) {
  await page.addInitScript(() => {
    class SilentDataChannel {
      readyState: RTCDataChannelState = "connecting";
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;

      send() {}

      close() {
        this.readyState = "closed";
      }

      open() {
        this.readyState = "open";
        this.onopen?.(new Event("open"));
        this.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "session.created",
              session: {
                model: "gpt-realtime-2.1",
                audio: {
                  input: {
                    turn_detection: {
                      type: "server_vad",
                      create_response: false,
                      interrupt_response: true,
                    },
                  },
                  output: { voice: "marin" },
                },
                reasoning: { effort: "low" },
              },
            }),
          }),
        );
      }
    }

    class SilentPeerConnection {
      connectionState: RTCPeerConnectionState = "new";
      signalingState: RTCSignalingState = "stable";
      onconnectionstatechange: (() => void) | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      private readonly channel = new SilentDataChannel();

      createDataChannel() {
        return this.channel as unknown as RTCDataChannel;
      }

      addTrack() {
        return {} as RTCRtpSender;
      }

      addTransceiver() {
        return {} as RTCRtpTransceiver;
      }

      async createOffer() {
        return {
          type: "offer" as const,
          sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=audio 9 RTP/AVP 111\r\n",
        };
      }

      async setLocalDescription() {}

      async setRemoteDescription() {
        this.connectionState = "connected";
        this.onconnectionstatechange?.();
        this.channel.open();
      }

      close() {
        this.signalingState = "closed";
        this.connectionState = "closed";
      }
    }

    Object.defineProperty(window, "RTCPeerConnection", {
      configurable: true,
      value: SilentPeerConnection,
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const track = { stop() {} } as MediaStreamTrack;
        return {
          getTracks: () => [track],
          getAudioTracks: () => [track],
        } as MediaStream;
      },
    });
  });
}

test("T6-C05 measures real local paths and exposes first-audio degradation without sensitive payloads", async ({
  page,
}) => {
  await installVoiceWithoutRemoteAudio(page);
  await page.route("**/api/exercise/parse", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyExercise),
    }),
  );
  await page.route("**/api/realtime/session", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/sdp",
      body: "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\nm=audio 9 RTP/AVP 111\r\n",
    }),
  );
  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await page.locator("#exercise-photo-input").setInputFiles(exerciseImage);
  await page.getByRole("button", { name: "Read my exercise" }).click();
  await page.getByRole("button", { name: "Looks right — start building" }).click();
  await expect(page.getByText(/Canvas initialized with A, B and AB only/)).toBeVisible();
  await page.evaluate(() => {
    const api = (window as ReliabilityWindow).ggbApplet;
    if (!api?.evalCommand("studentLine = PerpendicularLine((1,0),AB)")) {
      throw new Error("Could not create the local feedback candidate.");
    }
  });
  await page.waitForFunction(
    () =>
      (window as ReliabilityWindow)
        .__GEOTUTOR_EXPORT_RELIABILITY__?.()
        .distributions.find(({ name }) => name === "feedback_local")
        ?.sampleCount === 1,
  );

  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(page.locator("[data-capability-mode]")).toContainText(
    "Reason: latency budget exceeded",
    { timeout: 8_000 },
  );
  const firstAudioRow = page.locator('[data-latency-budget="first_audio"]');
  await expect(firstAudioRow).toContainText("degraded · typed live");

  const report = await page.evaluate(
    () => (window as ReliabilityWindow).__GEOTUTOR_EXPORT_RELIABILITY__?.(),
  );
  expect(report).toMatchObject({
    version: "geotutor.latency.v1",
    distributions: expect.arrayContaining([
      expect.objectContaining({ name: "image", sampleCount: 1 }),
      expect.objectContaining({ name: "feedback_local", sampleCount: 1 }),
      expect.objectContaining({ name: "session", sampleCount: 1 }),
      expect.objectContaining({
        name: "first_audio",
        sampleCount: 1,
        status: "degraded",
        fallback: "typed_live",
      }),
    ]),
  });
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    "OPENAI_API_KEY",
    "Bearer ",
    "data:image",
    "studentLine",
    "perpendicular_bisector",
    "v=0",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }

  await page.setViewportSize({ width: 640, height: 720 });
  const reliabilityTable = page.getByRole("table", {
    name: "In-memory latency distributions for this page session",
  });
  await reliabilityTable.scrollIntoViewIfNeeded();
  await expect(reliabilityTable).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../output/playwright/T6-C05-latency-fallback-zoom-200.png",
    fullPage: true,
  });
});

import { expect, test, type Page } from "@playwright/test";

type T0Window = Window & {
  __GEOTUTOR_GGB_EVIDENCE__?: {
    version: string;
    objects: Array<{
      label: string;
      exists: boolean;
      defined: boolean;
      command: string;
    }>;
  };
  __T0_AUDIO__?: {
    context: AudioContext;
    oscillator: OscillatorNode;
    destination: MediaStreamAudioDestinationNode;
  };
  __T0_CHANNEL__?: RTCDataChannel;
  __T0_PEER__?: RTCPeerConnection;
  __T0_EVENTS__?: string[];
};

async function installSyntheticMicrophone(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as T0Window;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = 220;
    oscillator.connect(destination);
    oscillator.start();

    navigator.mediaDevices.getUserMedia = async () => {
      await context.resume();
      return destination.stream;
    };

    const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = createDataChannel.apply(this, args);
      testWindow.__T0_CHANNEL__ = channel;
      testWindow.__T0_PEER__ = this;
      testWindow.__T0_EVENTS__ = [];
      channel.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(String(message.data)) as { type?: unknown };
          if (typeof event.type === "string") testWindow.__T0_EVENTS__?.push(event.type);
        } catch {
          testWindow.__T0_EVENTS__?.push("malformed");
        }
      });
      return channel;
    };

    testWindow.__T0_AUDIO__ = { context, oscillator, destination };
  });
}

async function expectClosedResources(page: Page) {
  await page.waitForFunction(
    () => (window as T0Window).__T0_CHANNEL__?.readyState === "closed",
  );
  await expect(page.getByText("not attached", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const testWindow = window as T0Window;
      return {
        channel: testWindow.__T0_CHANNEL__?.readyState,
        peer: testWindow.__T0_PEER__?.connectionState,
        localTrack: testWindow.__T0_AUDIO__?.destination.stream.getAudioTracks()[0]
          ?.readyState,
        attachedAudioStreams: [...document.querySelectorAll("audio")].filter(
          (audio) => audio.srcObject,
        ).length,
      };
    }),
  ).toEqual({
    channel: "closed",
    peer: "closed",
    localTrack: "ended",
    attachedAudioStreams: 0,
  });
}

test("T0 GeoGebra creates and reads A, B and AB", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();

  expect(
    await page.evaluate(() => (window as T0Window).__GEOTUTOR_GGB_EVIDENCE__),
  ).toEqual({
    version: "5.4.920.0",
    objects: [
      { label: "A", exists: true, defined: true, command: "(-2, 0)" },
      { label: "B", exists: true, defined: true, command: "(2, 0)" },
      { label: "AB", exists: true, defined: true, command: "Segment[A, B]" },
    ],
  });
});

test("T0 Realtime failure preserves GeoGebra and releases resources", async ({
  page,
}) => {
  await page.route("**/api/realtime/session", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "upstream_unavailable",
          message: "Realtime is temporarily unavailable.",
          retryable: true,
        },
      }),
    }),
  );
  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();
  await installSyntheticMicrophone(page);

  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(page.getByText("failed", { exact: true })).toBeVisible();
  await expectClosedResources(page);

  const evidence = await page.evaluate(
    () => (window as T0Window).__GEOTUTOR_GGB_EVIDENCE__,
  );
  expect(evidence?.objects.every((object) => object.exists && object.defined)).toBe(true);
});

test("T0 GeoGebra failure still reaches the isolated Realtime boundary", async ({
  page,
}) => {
  let routeReached = false;
  await page.route("**/deployggb.js", (route) => route.abort("failed"));
  await page.route("**/api/realtime/session", (route) => {
    routeReached = true;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "upstream_unavailable",
          message: "Realtime is temporarily unavailable.",
          retryable: true,
        },
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByText("Applet unavailable", { exact: true })).toBeVisible();
  await installSyntheticMicrophone(page);

  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(page.getByText("failed", { exact: true })).toBeVisible();
  expect(routeReached).toBe(true);
  await expectClosedResources(page);
});

test("@live T0 credentialed WebRTC receives audio and cleans up with GeoGebra down", async ({
  page,
}) => {
  test.skip(process.env.T0_LIVE !== "1", "Run with pnpm test:e2e:t0:live");

  await page.route("**/deployggb.js", (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByText("Applet unavailable", { exact: true })).toBeVisible();
  await installSyntheticMicrophone(page);

  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(page.getByText("oai-events open", { exact: true })).toBeVisible();
  await page.waitForFunction(() =>
    (window as T0Window).__T0_EVENTS__?.includes("session.created"),
  );

  await page.evaluate(() => {
    const channel = (window as T0Window).__T0_CHANNEL__;
    channel?.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Say exactly: Geometry ready." }],
        },
      }),
    );
    channel?.send(JSON.stringify({ type: "response.create" }));
  });
  await page.waitForFunction(() =>
    (window as T0Window).__T0_EVENTS__?.includes("response.done"),
  );

  expect(
    await page.evaluate(() => {
      const testWindow = window as T0Window;
      return {
        channel: testWindow.__T0_CHANNEL__?.readyState,
        peer: testWindow.__T0_PEER__?.connectionState,
        ice: testWindow.__T0_PEER__?.iceConnectionState,
        sessionCreated: testWindow.__T0_EVENTS__?.includes("session.created"),
        audioDone: testWindow.__T0_EVENTS__?.includes("response.output_audio.done"),
        transcriptDone: testWindow.__T0_EVENTS__?.includes(
          "response.output_audio_transcript.done",
        ),
        responseDone: testWindow.__T0_EVENTS__?.includes("response.done"),
        remoteAudioTracks: [...document.querySelectorAll("audio")].flatMap((audio) => {
          const stream = audio.srcObject;
          return stream instanceof MediaStream
            ? stream.getAudioTracks().map((track) => track.readyState)
            : [];
        }),
      };
    }),
  ).toEqual({
    channel: "open",
    peer: "connected",
    ice: "connected",
    sessionCreated: true,
    audioDone: true,
    transcriptDone: true,
    responseDone: true,
    remoteAudioTracks: ["live"],
  });

  await page.getByRole("button", { name: "Stop" }).click();
  await expectClosedResources(page);
});

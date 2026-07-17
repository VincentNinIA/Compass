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
    gain: GainNode;
    destination: MediaStreamAudioDestinationNode;
  };
  __T0_CHANNEL__?: RTCDataChannel;
  __T0_PEER__?: RTCPeerConnection;
  __T0_EVENTS__?: string[];
  __T0_CLIENT_EVENTS__?: string[];
  __T2_FUNCTION_CALLS__?: Array<{ name: string; callId: string }>;
  __T2_FUNCTION_OUTPUTS__?: string[];
  __T2_CREATED_RESPONSE_IDS__?: string[];
  __T2_CANCELLED_RESPONSE_IDS__?: string[];
  __T0_SESSION_PROFILE__?: {
    model?: string;
    voice?: string;
    reasoningEffort?: string;
  };
};

async function installSyntheticMicrophone(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as T0Window;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = 220;
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
      testWindow.__T0_CHANNEL__ = channel;
      testWindow.__T0_PEER__ = this;
      testWindow.__T0_EVENTS__ = [];
      testWindow.__T0_CLIENT_EVENTS__ = [];
      testWindow.__T2_FUNCTION_CALLS__ = [];
      testWindow.__T2_FUNCTION_OUTPUTS__ = [];
      testWindow.__T2_CREATED_RESPONSE_IDS__ = [];
      testWindow.__T2_CANCELLED_RESPONSE_IDS__ = [];
      const send = channel.send.bind(channel) as (data: unknown) => void;
      Object.defineProperty(channel, "send", { value: (data: unknown) => {
        try {
          const event = JSON.parse(String(data)) as { type?: unknown };
          if (typeof event.type === "string") {
            testWindow.__T0_CLIENT_EVENTS__?.push(event.type);
          }
          if (
            event.type === "conversation.item.create" &&
            typeof (event as { item?: { call_id?: unknown } }).item?.call_id === "string"
          ) {
            testWindow.__T2_FUNCTION_OUTPUTS__?.push(
              (event as { item: { call_id: string } }).item.call_id,
            );
          }
          if (
            event.type === "response.cancel" &&
            typeof (event as { response_id?: unknown }).response_id === "string"
          ) {
            testWindow.__T2_CANCELLED_RESPONSE_IDS__?.push(
              (event as { response_id: string }).response_id,
            );
          }
        } catch {
          testWindow.__T0_CLIENT_EVENTS__?.push("malformed");
        }
        send(data);
      } });
      channel.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(String(message.data)) as {
            type?: unknown;
            session?: {
              model?: unknown;
              audio?: { output?: { voice?: unknown } };
              reasoning?: { effort?: unknown };
            };
          };
          if (typeof event.type === "string") testWindow.__T0_EVENTS__?.push(event.type);
          if (
            event.type === "response.created" &&
            typeof (event as { response?: { id?: unknown } }).response?.id === "string"
          ) {
            testWindow.__T2_CREATED_RESPONSE_IDS__?.push(
              (event as { response: { id: string } }).response.id,
            );
          }
          if (event.type === "response.done") {
            const output = (event as { response?: { output?: unknown } }).response?.output;
            for (const item of Array.isArray(output) ? output : []) {
              if (
                item?.type === "function_call" &&
                typeof item.name === "string" &&
                typeof item.call_id === "string"
              ) {
                testWindow.__T2_FUNCTION_CALLS__?.push({
                  name: item.name,
                  callId: item.call_id,
                });
              }
            }
          }
          if (event.type === "session.created") {
            testWindow.__T0_SESSION_PROFILE__ = {
              model:
                typeof event.session?.model === "string"
                  ? event.session.model
                  : undefined,
              voice:
                typeof event.session?.audio?.output?.voice === "string"
                  ? event.session.audio.output.voice
                  : undefined,
              reasoningEffort:
                typeof event.session?.reasoning?.effort === "string"
                  ? event.session.reasoning.effort
                  : undefined,
            };
          }
        } catch {
          testWindow.__T0_EVENTS__?.push("malformed");
        }
      });
      return channel;
    };

    testWindow.__T0_AUDIO__ = { context, oscillator, gain, destination };
  });
}

async function produceSyntheticTurn(page: Page) {
  await page.evaluate(async () => {
    const audio = (window as T0Window).__T0_AUDIO__;
    if (!audio) throw new Error("Synthetic microphone is unavailable.");
    const frequencies = [170, 240, 190, 310, 220, 280, 180, 260, 200, 300];
    audio.gain.gain.setValueAtTime(1, audio.context.currentTime);
    for (const frequency of frequencies) {
      audio.oscillator.frequency.setValueAtTime(frequency, audio.context.currentTime);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    audio.gain.gain.setValueAtTime(0, audio.context.currentTime);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
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
  await page.goto("/?specialist=geometry");
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
          domain: "realtime_session",
          code: "upstream_unavailable",
          retryable: true,
          userMessage: "Realtime is temporarily unavailable.",
          correlationId: "realtime_session_t0_failure",
        },
      }),
    }),
  );
  await page.goto("/?specialist=geometry");
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
          domain: "realtime_session",
          code: "upstream_unavailable",
          retryable: true,
          userMessage: "Realtime is temporarily unavailable.",
          correlationId: "realtime_session_t0_applet_failure",
        },
      }),
    });
  });
  await page.goto("/?specialist=geometry");
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
  await page.goto("/?specialist=geometry");
  await expect(page.getByText("Applet unavailable", { exact: true })).toBeVisible();
  await installSyntheticMicrophone(page);

  await page.getByRole("button", { name: "Start voice" }).click();
  await page.waitForFunction(() =>
    (window as T0Window).__T0_EVENTS__?.includes("session.created"),
  );
  expect(
    await page.evaluate(() => (window as T0Window).__T0_SESSION_PROFILE__),
  ).toEqual({
    model: "gpt-realtime-2.1",
    voice: "cedar",
    reasoningEffort: "low",
  });
  await expect(page.getByText("oai-events open", { exact: true })).toBeVisible();

  await page.getByLabel("Ask your question").fill("Say exactly: Geometry ready.");
  await page.getByRole("button", { name: "Send question" }).click();
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

test("@live T2 server VAD emits one response.create for at least three committed turns", async ({
  page,
}) => {
  test.skip(process.env.T0_LIVE !== "1", "Run with pnpm test:e2e:t0:live");
  test.setTimeout(90_000);

  await page.route("**/deployggb.js", (route) => route.abort("failed"));
  await page.goto("/?specialist=geometry");
  await installSyntheticMicrophone(page);
  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(page.getByText("oai-events open", { exact: true })).toBeVisible();

  let committedTurns = 0;
  for (let stimulus = 0; stimulus < 3 && committedTurns < 3; stimulus += 1) {
    await produceSyntheticTurn(page);
    await page.waitForFunction(
      (previous) =>
        ((window as T0Window).__T0_EVENTS__?.filter(
          (type) => type === "input_audio_buffer.committed",
        ).length ?? 0) > previous,
      committedTurns,
    );
    committedTurns =
      (await page.evaluate(
        () =>
          (window as T0Window).__T0_EVENTS__?.filter(
            (type) => type === "input_audio_buffer.committed",
          ).length,
      )) ?? 0;
    await page.waitForFunction(
      (expected) =>
        ((window as T0Window).__T0_EVENTS__?.filter(
          (type) => type === "response.done",
        ).length ?? 0) >= expected,
      committedTurns,
    );
    expect(
      await page.evaluate(
        () =>
          (window as T0Window).__T0_CLIENT_EVENTS__?.filter(
            (type) => type === "response.create",
          ).length,
      ),
    ).toBe(committedTurns);
  }
  expect(committedTurns).toBeGreaterThanOrEqual(3);

  await page.getByRole("button", { name: "Stop" }).click();
  await expectClosedResources(page);
});

test("@live T2 completes a correlated read_construction tool loop", async ({ page }) => {
  test.skip(process.env.T0_LIVE !== "1", "Run with pnpm test:e2e:t0:live");

  await page.goto("/?specialist=geometry");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();
  await installSyntheticMicrophone(page);
  const revision = await page.evaluate(
    () => (window as T0Window & { __GEOTUTOR_PROGRESS__?: { revision?: number } }).__GEOTUTOR_PROGRESS__?.revision,
  );
  expect(typeof revision).toBe("number");

  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(page.getByText("oai-events open", { exact: true })).toBeVisible();
  await page
    .getByLabel("Ask your question")
    .fill(`Use read_construction exactly once with revision ${revision} before answering.`);
  await page.getByRole("button", { name: "Send question" }).click();

  await page.waitForFunction(
    () => (window as T0Window).__T2_FUNCTION_OUTPUTS__?.length === 1,
  );
  await page.waitForFunction(
    () =>
      ((window as T0Window).__T0_EVENTS__?.filter((type) => type === "response.done")
        .length ?? 0) >= 2,
  );
  const evidence = await page.evaluate(() => {
    const state = window as T0Window;
    return {
      calls: state.__T2_FUNCTION_CALLS__,
      outputs: state.__T2_FUNCTION_OUTPUTS__,
      responseCreates: state.__T0_CLIENT_EVENTS__?.filter(
        (type) => type === "response.create",
      ).length,
    };
  });
  expect(evidence.calls).toHaveLength(1);
  expect(evidence.calls?.[0]?.name).toBe("read_construction");
  expect(evidence.outputs).toEqual([evidence.calls?.[0]?.callId]);
  expect(evidence.responseCreates).toBe(2);
  await expect(page.getByText(/1 output\(s\) · continued/)).toBeVisible();

  await page.getByRole("button", { name: "Stop" }).click();
  await expectClosedResources(page);
});

test("@live T2 Stop cancels and clears an active audio response", async ({ page }) => {
  test.skip(process.env.T0_LIVE !== "1", "Run with pnpm test:e2e:t0:live");

  await page.route("**/deployggb.js", (route) => route.abort("failed"));
  await page.goto("/?specialist=geometry");
  await installSyntheticMicrophone(page);
  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(page.getByText("oai-events open", { exact: true })).toBeVisible();
  await page
    .getByLabel("Ask your question")
    .fill("Count upward slowly for at least thirty seconds, saying one number per second.");
  await page.getByRole("button", { name: "Send question" }).click();
  await page.waitForFunction(() =>
    (window as T0Window).__T0_EVENTS__?.includes("output_audio_buffer.started"),
  );

  await page.getByRole("button", { name: "Stop" }).click();
  await expectClosedResources(page);

  const evidence = await page.evaluate(() => {
    const state = window as T0Window;
    const sent = state.__T0_CLIENT_EVENTS__ ?? [];
    return {
      created: state.__T2_CREATED_RESPONSE_IDS__,
      cancelled: state.__T2_CANCELLED_RESPONSE_IDS__,
      cancelIndex: sent.lastIndexOf("response.cancel"),
      clearIndex: sent.lastIndexOf("output_audio_buffer.clear"),
    };
  });
  expect(evidence.created).toHaveLength(1);
  expect(evidence.cancelled).toEqual(evidence.created);
  expect(evidence.cancelIndex).toBeGreaterThan(-1);
  expect(evidence.clearIndex).toBe(evidence.cancelIndex + 1);
});

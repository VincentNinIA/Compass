import { expect, test, type Page, type Route } from "@playwright/test";

type CapabilityProbeWindow = Window & {
  __T6_CLIENT_EVENTS__?: Array<Record<string, unknown>>;
  __T6_SERVER_EVENTS__?: Array<Record<string, unknown>>;
  __T6_GET_USER_MEDIA_CALLS__?: number;
  __T6_CLOSE_CHANNEL__?: () => void;
  __T6_EMIT_TYPED_DONE__?: () => void;
};

async function installCredentialedTypedProbe(page: Page) {
  await page.addInitScript(() => {
    const state = window as CapabilityProbeWindow;
    state.__T6_CLIENT_EVENTS__ = [];
    state.__T6_SERVER_EVENTS__ = [];
    state.__T6_GET_USER_MEDIA_CALLS__ = 0;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      state.__T6_GET_USER_MEDIA_CALLS__ =
        (state.__T6_GET_USER_MEDIA_CALLS__ ?? 0) + 1;
      return getUserMedia(...args);
    };
    const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = createDataChannel.apply(this, args);
      const send = channel.send.bind(channel) as (data: string) => void;
      Object.defineProperty(channel, "send", {
        value: (data: string) => {
          state.__T6_CLIENT_EVENTS__?.push(
            JSON.parse(String(data)) as Record<string, unknown>,
          );
          send(data);
        },
      });
      channel.addEventListener("message", (message) => {
        state.__T6_SERVER_EVENTS__?.push(
          JSON.parse(String(message.data)) as Record<string, unknown>,
        );
      });
      return channel;
    };
  });
}

async function installCapabilityTransport(
  page: Page,
  options: { denyMicrophone?: boolean; holdTypedResponse?: boolean } = {},
) {
  await page.addInitScript(({ denyMicrophone, holdTypedResponse }) => {
    const state = window as CapabilityProbeWindow;
    state.__T6_CLIENT_EVENTS__ = [];
    state.__T6_GET_USER_MEDIA_CALLS__ = 0;

    class FakeDataChannel {
      readyState: RTCDataChannelState = "connecting";
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      mode: "live_voice" | "typed_live" = "typed_live";

      send(serialized: string) {
        const event = JSON.parse(String(serialized)) as Record<string, unknown> & {
          type?: string;
          response?: { metadata?: Record<string, string> };
        };
        state.__T6_CLIENT_EVENTS__?.push(event);
        if (this.mode !== "typed_live" || event.type !== "response.create") return;
        const metadata = event.response?.metadata ?? {};
        window.setTimeout(() => {
          this.emit({
            type: "response.created",
            response: { id: "t6-text-response", metadata },
          });
          const emitDone = () =>
            this.emit({
              type: "response.done",
              response: {
                id: "t6-text-response",
                status: "completed",
                metadata,
                output: [
                  {
                    type: "message",
                    content: [
                      {
                        type: "output_text",
                        text: "Compare the two distances before changing the line.",
                      },
                    ],
                  },
                ],
              },
            });
          if (holdTypedResponse) {
            state.__T6_EMIT_TYPED_DONE__ = emitDone;
          } else {
            emitDone();
          }
        }, 0);
      }

      close() {
        this.readyState = "closed";
      }

      open(mode: "live_voice" | "typed_live") {
        this.mode = mode;
        this.readyState = "open";
        this.onopen?.(new Event("open"));
        this.emit(
          mode === "live_voice"
            ? {
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
              }
            : {
                type: "session.created",
                session: {
                  model: "gpt-realtime-2.1",
                  reasoning: { effort: "low" },
                  output_modalities: ["text"],
                  tools: [],
                  tool_choice: "none",
                },
              },
        );
      }

      unexpectedClose() {
        this.readyState = "closed";
        this.onclose?.(new Event("close"));
      }

      private emit(event: Record<string, unknown>) {
        this.onmessage?.(
          new MessageEvent("message", { data: JSON.stringify(event) }),
        );
      }
    }

    class FakePeerConnection {
      connectionState: RTCPeerConnectionState = "new";
      signalingState: RTCSignalingState = "stable";
      onconnectionstatechange: (() => void) | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      private readonly channel = new FakeDataChannel();
      private stream?: MediaStream;

      createDataChannel() {
        state.__T6_CLOSE_CHANNEL__ = () => this.channel.unexpectedClose();
        return this.channel as unknown as RTCDataChannel;
      }

      addTrack(_track: MediaStreamTrack, stream: MediaStream) {
        this.stream = stream;
        return {} as RTCRtpSender;
      }

      addTransceiver() {
        return {} as RTCRtpTransceiver;
      }

      async createOffer() {
        return {
          type: "offer" as const,
          sdp: this.stream
            ? "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=audio 9 RTP/AVP 111\r\n"
            : "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=audio 0 RTP/AVP 111\r\na=inactive\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
        };
      }

      async setLocalDescription() {}

      async setRemoteDescription() {
        const mode = this.stream ? "live_voice" : "typed_live";
        this.connectionState = "connected";
        this.onconnectionstatechange?.();
        if (this.stream) {
          const track = this.stream.getAudioTracks()[0];
          if (track) {
            this.ontrack?.({
              streams: [this.stream],
              track,
            } as unknown as RTCTrackEvent);
          }
        }
        this.channel.open(mode);
      }

      close() {
        this.signalingState = "closed";
        this.connectionState = "closed";
      }
    }

    Object.defineProperty(window, "RTCPeerConnection", {
      configurable: true,
      value: FakePeerConnection,
    });

    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        state.__T6_GET_USER_MEDIA_CALLS__ =
          (state.__T6_GET_USER_MEDIA_CALLS__ ?? 0) + 1;
        if (denyMicrophone) {
          throw new DOMException("Permission denied", "NotAllowedError");
        }
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const destination = context.createMediaStreamDestination();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        await context.resume();
        return destination.stream;
      },
    });
  }, options);
}

function successfulSessionRoute(requests: string[]) {
  return async (route: Route) => {
    const mode = route.request().headers()["x-geotutor-capability-mode"];
    requests.push(mode ?? "missing");
    await route.fulfill({
      status: 201,
      contentType: "application/sdp",
      body:
        mode === "typed_live"
          ? "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\nm=audio 0 RTP/AVP 111\r\na=inactive\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"
          : "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\nm=audio 9 RTP/AVP 111\r\n",
    });
  };
}

test("T6-C02 scripted_local sends no model request and typed_live is a real text session", async ({
  page,
}) => {
  const requests: string[] = [];
  await installCapabilityTransport(page);
  await page.route("**/api/realtime/session", successfulSessionRoute(requests));
  await page.goto("/");

  const badge = page.locator("[data-capability-mode]");
  await expect(badge).toHaveAttribute("data-capability-mode", "scripted_local");
  await expect(badge).toContainText("no OpenAI or model request is sent");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.screenshot({
    path: "../../output/playwright/T6-C02-scripted-local.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Use live text" }).click();
  await expect(badge).toHaveAttribute("data-capability-mode", "typed_live");
  await expect(badge).toContainText("microphone and audio are off");
  expect(requests).toEqual(["typed_live"]);
  expect(
    await page.evaluate(
      () => (window as CapabilityProbeWindow).__T6_GET_USER_MEDIA_CALLS__,
    ),
  ).toBe(0);

  await page.getByLabel("Ask your question").fill("What should I compare?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByLabel("Live text response")).toHaveText(
    "Compare the two distances before changing the line.",
  );
  expect(
    await page.evaluate(() =>
      (window as CapabilityProbeWindow).__T6_CLIENT_EVENTS__?.map(
        (event) => event.type,
      ),
    ),
  ).toEqual(["conversation.item.create", "response.create"]);
  await page.screenshot({
    path: "../../output/playwright/T6-C02-typed-live.png",
    fullPage: true,
  });
});

test("T6-C02 live_voice requires microphone and audio, then a channel loss never auto-retries", async ({
  page,
}) => {
  const requests: string[] = [];
  await installCapabilityTransport(page);
  await page.route("**/api/realtime/session", successfulSessionRoute(requests));
  await page.goto("/");

  const badge = page.locator("[data-capability-mode]");
  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(badge).toHaveAttribute("data-capability-mode", "live_voice");
  await expect(badge).toContainText(
    "peer, oai-events, microphone and remote audio are verified",
  );
  expect(requests).toEqual(["live_voice"]);
  expect(
    await page.evaluate(
      () => (window as CapabilityProbeWindow).__T6_GET_USER_MEDIA_CALLS__,
    ),
  ).toBe(1);
  await page.screenshot({
    path: "../../output/playwright/T6-C02-live-voice.png",
    fullPage: true,
  });

  await page.evaluate(() =>
    (window as CapabilityProbeWindow).__T6_CLOSE_CHANNEL__?.(),
  );
  await expect(badge).toHaveAttribute("data-capability-mode", "scripted_local");
  await expect(badge).toContainText("Reason: voice connection lost");
  await page.waitForTimeout(1_300);
  expect(requests).toEqual(["live_voice"]);
});

test("T6-C02 denied microphone proposes a manual typed fallback without touching geometry", async ({
  page,
}) => {
  const requests: string[] = [];
  await installCapabilityTransport(page, { denyMicrophone: true });
  await page.route("**/api/realtime/session", successfulSessionRoute(requests));
  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();
  const before = await page.evaluate(
    () =>
      (window as Window & { __GEOTUTOR_GGB_EVIDENCE__?: unknown })
        .__GEOTUTOR_GGB_EVIDENCE__,
  );

  const badge = page.locator("[data-capability-mode]");
  await page.getByRole("button", { name: "Start voice" }).click();
  await expect(badge).toContainText("Reason: microphone permission denied");
  expect(requests).toEqual([]);
  await expect(page.getByRole("button", { name: "Use live text" })).toBeEnabled({
    timeout: 3_000,
  });
  await page.getByRole("button", { name: "Use live text" }).click();
  await expect(badge).toHaveAttribute("data-capability-mode", "typed_live");
  expect(requests).toEqual(["typed_live"]);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __GEOTUTOR_GGB_EVIDENCE__?: unknown })
          .__GEOTUTOR_GGB_EVIDENCE__,
    ),
  ).toEqual(before);
});

test("T6-C02 route failure and offline state stay local with zero automatic retry", async ({
  context,
  page,
}) => {
  let requests = 0;
  await installCapabilityTransport(page);
  await page.route("**/api/realtime/session", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          domain: "realtime_session",
          code: "upstream_unavailable",
          retryable: true,
          userMessage: "Realtime is temporarily unavailable.",
          correlationId: "realtime_session_e2e_failure",
        },
      }),
    });
  });
  await page.goto("/");
  const badge = page.locator("[data-capability-mode]");
  await page.getByRole("button", { name: "Use live text" }).click();
  await expect(badge).toContainText("Reason: typed connection failed");
  await page.waitForTimeout(1_300);
  expect(requests).toBe(1);

  await context.setOffline(true);
  await expect(badge).toContainText("Reason: offline");
  expect(requests).toBe(1);
  await context.setOffline(false);
  await expect(badge).toContainText("Reason: local ready");
});

test("T6-C01 reset cancels an active typed response and ignores its late completion", async ({
  page,
}) => {
  const requests: string[] = [];
  await installCapabilityTransport(page, { holdTypedResponse: true });
  await page.route("**/api/realtime/session", successfulSessionRoute(requests));
  await page.goto("/");
  await expect(page.getByText("API verified", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Use live text" }).click();
  await expect(page.locator("[data-capability-mode]")).toHaveAttribute(
    "data-capability-mode",
    "typed_live",
  );
  await page.getByLabel("Ask your question").fill("What should I compare?");
  await page.getByRole("button", { name: "Send question" }).click();
  await page.waitForFunction(
    () =>
      typeof (window as CapabilityProbeWindow).__T6_EMIT_TYPED_DONE__ ===
      "function",
  );

  await page.getByRole("button", { name: "Reset construction" }).click();
  await page.waitForFunction(
    () =>
      (window as Window & { __GEOTUTOR_RESET__?: { ok?: boolean } })
        .__GEOTUTOR_RESET__?.ok === true,
  );
  expect(
    await page.evaluate(
      () =>
        (window as Window & {
          __GEOTUTOR_RESET__?: {
            value?: { cancelledScopes?: string[] };
          };
        }).__GEOTUTOR_RESET__?.value?.cancelledScopes,
    ),
  ).toEqual(expect.arrayContaining(["realtime_responses_audio_tools"]));
  expect(
    await page.evaluate(() =>
      (window as CapabilityProbeWindow).__T6_CLIENT_EVENTS__?.map(
        (event) => event.type,
      ),
    ),
  ).toEqual(
    expect.arrayContaining([
      "conversation.item.create",
      "response.create",
      "response.cancel",
    ]),
  );
  await expect(page.locator("[data-capability-mode]")).toContainText(
    "Reason: construction reset",
  );

  await page.evaluate(() =>
    (window as CapabilityProbeWindow).__T6_EMIT_TYPED_DONE__?.(),
  );
  await page.waitForTimeout(50);
  await expect(page.getByLabel("Live text response")).toHaveCount(0);
});

test("@live T6-C02 credentialed typed_live stays text-only without microphone or audio", async ({
  page,
}) => {
  test.skip(process.env.T0_LIVE !== "1", "Run with the credentialed live gate.");
  await installCredentialedTypedProbe(page);
  await page.goto("/");
  const badge = page.locator("[data-capability-mode]");

  await page.getByRole("button", { name: "Use live text" }).click();
  await expect(badge).toHaveAttribute("data-capability-mode", "typed_live", {
    timeout: 30_000,
  });
  await page
    .getByLabel("Ask your question")
    .fill("Reply with one short reflective geometry question.");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByLabel("Live text response")).not.toBeEmpty({
    timeout: 30_000,
  });

  const evidence = await page.evaluate(() => {
    const state = window as CapabilityProbeWindow;
    const clientEvents = state.__T6_CLIENT_EVENTS__ ?? [];
    const serverEvents = state.__T6_SERVER_EVENTS__ ?? [];
    return {
      getUserMediaCalls: state.__T6_GET_USER_MEDIA_CALLS__,
      responseRequest: clientEvents.find(
        (event) => event.type === "response.create",
      ),
      responseDone: serverEvents.some((event) => event.type === "response.done"),
      audioEvents: serverEvents
        .map((event) => String(event.type ?? ""))
        .filter((type) => type.includes("audio")),
      attachedAudioStreams: [...document.querySelectorAll("audio")].filter(
        (audio) => audio.srcObject,
      ).length,
    };
  });
  expect(evidence.getUserMediaCalls).toBe(0);
  expect(evidence.responseRequest).toMatchObject({
    type: "response.create",
    response: {
      output_modalities: ["text"],
      tools: [],
      tool_choice: "none",
    },
  });
  expect(evidence.responseDone).toBe(true);
  expect(evidence.audioEvents).toEqual([]);
  expect(evidence.attachedAudioStreams).toBe(0);
});

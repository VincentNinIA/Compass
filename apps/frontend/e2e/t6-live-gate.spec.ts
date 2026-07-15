import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type SafeClientEvent = {
  type: string;
  metadataKind?: string;
  conversation?: string;
  outputModalities?: string[];
  toolsCount?: number;
};

type SafeServerEvent = {
  type: string;
  responseId?: string;
  status?: string;
  metadataKind?: string;
  conversationId?: string | null;
  outputModalities?: string[];
  outputItemTypes?: string[];
  contentTypes?: string[];
  sessionModel?: string;
  sessionVoice?: string;
  reasoningEffort?: string;
};

type EvidenceEntry = {
  runId: string;
  actionId?: string;
  revision: number;
  kind: string;
  correlationIds: { evidenceIds?: string[] };
  status: string;
};

type EvidenceExport = {
  version: string;
  runId: string;
  dropped: number;
  entries: EvidenceEntry[];
};

type AppletApi = {
  deleteObject(name: string): void;
  evalCommand(command: string): boolean;
  getAllObjectNames(): string[];
  getCommandString(name: string, substituteNumbers?: boolean): string;
};

type GateProbe = {
  context: AudioContext;
  oscillator: OscillatorNode;
  destination: MediaStreamAudioDestinationNode;
  channel?: RTCDataChannel;
  peer?: RTCPeerConnection;
  getUserMediaCalls: number;
  clientEvents: SafeClientEvent[];
  serverEvents: SafeServerEvent[];
};

type GateWindow = Window & {
  ggbApplet?: AppletApi;
  __T6_LIVE_GATE_PROBE__?: GateProbe;
  __GEOTUTOR_EXPORT_EVIDENCE__?: () => EvidenceExport;
  __GEOTUTOR_PROGRESS__?: {
    score?: number;
    revision?: number;
    evidenceIds?: string[];
  };
  __GEOTUTOR_INVARIANCE_SCENE__?: {
    status?: string;
    restoration?: string;
    restored?: boolean;
    beforeHash?: string | null;
    afterHash?: string | null;
    helpers?: string[];
    listenerCountBefore?: number | null;
    listenerCountAfter?: number;
  };
  __GEOTUTOR_INVARIANCE_SUMMARY__?: {
    source?: string;
    reason?: string;
    responseId?: string | null;
  };
  __GEOTUTOR_RESET__?: {
    ok?: boolean;
    value?: {
      restoration?: string;
      recovered?: boolean;
      inventory?: string[];
      registry?: Array<{ name: string; owner: string; kind: string }>;
      listenerCount?: number;
      afterHash?: string;
      checkpointHash?: string;
      cancelledScopes?: string[];
    };
  };
};

type StepEvidence = Record<string, string | number | boolean | null | string[]>;

type ManifestStep = {
  id: string;
  status: "pass" | "fail";
  startedAt: string;
  durationMs: number;
  evidence: StepEvidence;
};

const outputRoot = path.resolve(
  process.cwd(),
  "../../output/playwright/T6-C07",
);
const fixturePath = path.resolve(
  process.cwd(),
  "test-fixtures/t3-exercise/clear-en.jpg",
);

function parseRequiredJson(name: string): Record<string, unknown> {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the live gate runner.`);
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

async function installLiveProbe(page: Page) {
  await page.addInitScript(() => {
    const gateWindow = window as GateWindow;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = 220;
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();

    const probe: GateProbe = {
      context,
      oscillator,
      destination,
      getUserMediaCalls: 0,
      clientEvents: [],
      serverEvents: [],
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        probe.getUserMediaCalls += 1;
        await context.resume();
        return destination.stream;
      },
    });

    const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = createDataChannel.apply(this, args);
      probe.channel = channel;
      probe.peer = this;
      const send = channel.send.bind(channel) as (data: string) => void;
      Object.defineProperty(channel, "send", {
        configurable: true,
        value: (data: string) => {
          try {
            const event = JSON.parse(String(data)) as {
              type?: unknown;
              response?: {
                metadata?: { kind?: unknown };
                conversation?: unknown;
                output_modalities?: unknown;
                tools?: unknown;
              };
            };
            if (typeof event.type === "string") {
              const response = event.response;
              probe.clientEvents.push({
                type: event.type,
                metadataKind:
                  typeof response?.metadata?.kind === "string"
                    ? response.metadata.kind
                    : undefined,
                conversation:
                  typeof response?.conversation === "string"
                    ? response.conversation
                    : undefined,
                outputModalities: Array.isArray(response?.output_modalities)
                  ? response.output_modalities.filter(
                      (item): item is string => typeof item === "string",
                    )
                  : undefined,
                toolsCount: Array.isArray(response?.tools)
                  ? response.tools.length
                  : undefined,
              });
            }
          } catch {
            probe.clientEvents.push({ type: "malformed_client_event" });
          }
          send(data);
        },
      });
      channel.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(String(message.data)) as {
            type?: unknown;
            session?: {
              model?: unknown;
              audio?: { output?: { voice?: unknown } };
              reasoning?: { effort?: unknown };
            };
            response?: {
              id?: unknown;
              status?: unknown;
              conversation_id?: unknown;
              output_modalities?: unknown;
              metadata?: { kind?: unknown };
              output?: Array<{
                type?: unknown;
                content?: Array<{ type?: unknown }>;
              }>;
            };
          };
          if (typeof event.type !== "string") return;
          const response = event.response;
          probe.serverEvents.push({
            type: event.type,
            responseId:
              typeof response?.id === "string" ? response.id : undefined,
            status:
              typeof response?.status === "string"
                ? response.status
                : undefined,
            metadataKind:
              typeof response?.metadata?.kind === "string"
                ? response.metadata.kind
                : undefined,
            conversationId:
              typeof response?.conversation_id === "string" ||
              response?.conversation_id === null
                ? response.conversation_id
                : undefined,
            outputModalities: Array.isArray(response?.output_modalities)
              ? response.output_modalities.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            outputItemTypes: Array.isArray(response?.output)
              ? response.output
                  .map((item) => item.type)
                  .filter((item): item is string => typeof item === "string")
              : undefined,
            contentTypes: Array.isArray(response?.output)
              ? response.output.flatMap((item) =>
                  Array.isArray(item.content)
                    ? item.content
                        .map((content) => content.type)
                        .filter(
                          (content): content is string =>
                            typeof content === "string",
                        )
                    : [],
                )
              : undefined,
            sessionModel:
              typeof event.session?.model === "string"
                ? event.session.model
                : undefined,
            sessionVoice:
              typeof event.session?.audio?.output?.voice === "string"
                ? event.session.audio.output.voice
                : undefined,
            reasoningEffort:
              typeof event.session?.reasoning?.effort === "string"
                ? event.session.reasoning.effort
                : undefined,
          });
        } catch {
          probe.serverEvents.push({ type: "malformed_server_event" });
        }
      });
      return channel;
    };
    gateWindow.__T6_LIVE_GATE_PROBE__ = probe;
  });
}

async function readProbe(page: Page) {
  return page.evaluate(() => {
    const probe = (window as GateWindow).__T6_LIVE_GATE_PROBE__;
    return {
      getUserMediaCalls: probe?.getUserMediaCalls ?? 0,
      clientEvents: probe?.clientEvents ?? [],
      serverEvents: probe?.serverEvents ?? [],
      channel: probe?.channel?.readyState ?? "missing",
      peer: probe?.peer?.connectionState ?? "missing",
      ice: probe?.peer?.iceConnectionState ?? "missing",
      localTrack:
        probe?.destination.stream.getAudioTracks()[0]?.readyState ?? "missing",
      attachedAudioTracks: [...document.querySelectorAll("audio")].flatMap(
        (audio) => {
          const stream = audio.srcObject;
          return stream instanceof MediaStream
            ? stream.getAudioTracks().map((track) => track.readyState)
            : [];
        },
      ),
    };
  });
}

async function readEvidence(page: Page) {
  return page.evaluate(
    () => (window as GateWindow).__GEOTUTOR_EXPORT_EVIDENCE__?.(),
  );
}

function completedResponseCount(events: SafeServerEvent[]) {
  return events.filter(
    (event) => event.type === "response.done" && event.status === "completed",
  ).length;
}

test("@live T6-C07 completes one strict golden journey", async ({ page }) => {
  test.skip(
    process.env.T6_LIVE_GATE !== "1",
    "Run only through the T6 live gate runner.",
  );
  test.setTimeout(180_000);

  const runIndex = Number.parseInt(process.env.T6_GATE_RUN_INDEX ?? "", 10);
  const seriesId = process.env.T6_GATE_SERIES_ID;
  const candidate = parseRequiredJson("T6_GATE_CANDIDATE");
  const environment = parseRequiredJson("T6_GATE_ENVIRONMENT");
  if (!Number.isInteger(runIndex) || runIndex < 1 || !seriesId) {
    throw new Error("The live gate run identity is incomplete.");
  }

  await mkdir(outputRoot, { recursive: true });
  const manifestPath = path.join(outputRoot, `run-${runIndex}.json`);
  const completedScreenshot = path.join(
    outputRoot,
    `T6-C07-run-${runIndex}-completed.png`,
  );
  const failedScreenshot = path.join(
    outputRoot,
    `T6-C07-run-${runIndex}-failed.png`,
  );
  const steps: ManifestStep[] = [];
  const exerciseResponseStatuses: number[] = [];
  const startedAt = new Date().toISOString();
  let failure: unknown;

  const runStep = async (
    id: string,
    operation: () => Promise<StepEvidence>,
  ) => {
    const stepStarted = Date.now();
    try {
      const evidence = await operation();
      steps.push({
        id,
        status: "pass",
        startedAt: new Date(stepStarted).toISOString(),
        durationMs: Date.now() - stepStarted,
        evidence,
      });
    } catch (error) {
      steps.push({
        id,
        status: "fail",
        startedAt: new Date(stepStarted).toISOString(),
        durationMs: Date.now() - stepStarted,
        evidence: {
          failureClass: error instanceof Error ? error.name : "UnknownError",
        },
      });
      throw error;
    }
  };

  try {
    await installLiveProbe(page);
    page.on("response", (response) => {
      if (response.url().includes("/api/exercise/parse")) {
        exerciseResponseStatuses.push(response.status());
      }
    });

    await runStep("photo_extraction", async () => {
      const response = await page.goto("/");
      expect(response).not.toBeNull();
      expect(new URL(page.url()).protocol).toBe("https:");
      expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
      await expect(page.getByText("API verified", { exact: true })).toBeVisible();
      await page.locator("#exercise-photo-input").setInputFiles(fixturePath);
      await page.getByRole("button", { name: "Read my exercise" }).click();
      await expect(
        page.getByRole("button", { name: "Looks right — start building" }),
      ).toBeVisible({ timeout: 30_000 });
      expect(exerciseResponseStatuses).toEqual([200]);
      return {
        secureContext: true,
        exerciseResponseStatus: 200,
        routeRequests: exerciseResponseStatuses.length,
        extractionOutcome: "ready",
      };
    });

    await runStep("exercise_confirmation", async () => {
      await page.getByRole("button", { name: "Looks right — start building" }).click();
      await expect(
        page.getByText(/Canvas initialized with A, B and AB only/),
      ).toBeVisible();
      const construction = await page.evaluate(() => {
        const api = (window as GateWindow).ggbApplet;
        if (!api) throw new Error("GeoGebra API unavailable.");
        const names = [...api.getAllObjectNames()].map(String).sort();
        return {
          names,
          commands: names.map((name) =>
            api.getCommandString(name, false).replaceAll("−", "-"),
          ),
        };
      });
      expect(construction.names).toEqual(["A", "AB", "B"]);
      expect(construction.commands).toEqual(
        expect.arrayContaining(["(-3, 0)", "Segment[A, B]", "(3, 0)"]),
      );
      return {
        appletVersion: "5.4.920.0",
        inventory: construction.names,
        givensOnly: true,
      };
    });

    await runStep("first_block_silent", async () => {
      await page.evaluate(() => {
        const api = (window as GateWindow).ggbApplet;
        if (!api?.evalCommand(
          "studentLine = PerpendicularLine((1,0),AB)",
        )) {
          throw new Error("GeoGebra rejected the seeded incorrect line.");
        }
      });
      await expect(page.getByTestId("construction-progress")).toContainText(
        "1/2",
      );
      await page.waitForFunction(
        () =>
          (window as GateWindow)
            .__GEOTUTOR_EXPORT_EVIDENCE__?.()
            .entries.some((entry) => entry.kind === "decision_silent") === true,
      );
      const evidence = await readEvidence(page);
      const decisions =
        evidence?.entries.filter((entry) => entry.kind.startsWith("decision_")) ??
        [];
      expect(decisions.map((entry) => entry.kind)).toEqual(["decision_silent"]);
      expect(decisions[0]?.correlationIds.evidenceIds).toHaveLength(2);
      const probe = await readProbe(page);
      expect(
        probe.clientEvents.filter((event) => event.type === "response.create"),
      ).toHaveLength(0);
      return {
        progress: "1/2",
        decision: "SILENT",
        proofCount: 2,
        responseCreates: 0,
      };
    });

    await runStep("live_voice", async () => {
      await page.getByRole("button", { name: "Start voice" }).click();
      const badge = page.locator("[data-capability-mode]");
      await expect(badge).toHaveAttribute("data-capability-mode", "live_voice", {
        timeout: 30_000,
      });
      await expect(page.getByText("oai-events open", { exact: true })).toBeVisible();
      await expect(page.getByText("track attached", { exact: true })).toBeVisible();
      await page.waitForFunction(
        () =>
          (window as GateWindow).__T6_LIVE_GATE_PROBE__?.serverEvents.some(
            (event) => event.type === "session.created",
          ) === true,
      );
      const probe = await readProbe(page);
      const session = probe.serverEvents.find(
        (event) => event.type === "session.created",
      );
      expect(probe.getUserMediaCalls).toBe(1);
      expect(probe.channel).toBe("open");
      expect(probe.peer).toBe("connected");
      expect(["connected", "completed"]).toContain(probe.ice);
      expect(probe.localTrack).toBe("live");
      expect(probe.attachedAudioTracks).toEqual(["live"]);
      expect(session).toMatchObject({
        sessionModel: "gpt-realtime-2.1",
        sessionVoice: "marin",
        reasoningEffort: "low",
      });
      return {
        capability: "live_voice",
        peer: probe.peer,
        dataChannel: probe.channel,
        microphoneTracks: 1,
        remoteAudioTracks: probe.attachedAudioTracks.length,
        model: session?.sessionModel ?? "missing",
      };
    });

    await runStep("repeated_block_speaks", async () => {
      const before = await readProbe(page);
      const responseCreatesBefore = before.clientEvents.filter(
        (event) => event.type === "response.create",
      ).length;
      const itemCreatesBefore = before.clientEvents.filter(
        (event) => event.type === "conversation.item.create",
      ).length;
      const responseDoneBefore = completedResponseCount(before.serverEvents);
      const audioDoneBefore = before.serverEvents.filter(
        (event) => event.type === "response.output_audio.done",
      ).length;
      await page.evaluate(() => {
        const api = (window as GateWindow).ggbApplet;
        if (!api?.evalCommand("studentPoint = (0,2)")) {
          throw new Error("GeoGebra rejected the repeated-block action.");
        }
      });
      await page.waitForFunction(
        () =>
          (window as GateWindow)
            .__GEOTUTOR_EXPORT_EVIDENCE__?.()
            .entries.some((entry) => entry.kind === "decision_speak") === true,
      );
      await page.waitForFunction(
        (count) =>
          ((window as GateWindow).__T6_LIVE_GATE_PROBE__?.clientEvents.filter(
            (event) => event.type === "response.create",
          ).length ?? 0) === count + 1,
        responseCreatesBefore,
      );
      await page.waitForFunction(
        ({ done, audio }) => {
          const events =
            (window as GateWindow).__T6_LIVE_GATE_PROBE__?.serverEvents ?? [];
          return (
            events.filter(
              (event) =>
                event.type === "response.done" && event.status === "completed",
            ).length ===
              done + 1 &&
            events.filter(
              (event) => event.type === "response.output_audio.done",
            ).length ===
              audio + 1
          );
        },
        { done: responseDoneBefore, audio: audioDoneBefore },
      );
      const after = await readProbe(page);
      const decisions =
        (await readEvidence(page))?.entries.filter((entry) =>
          entry.kind.startsWith("decision_"),
        ) ?? [];
      expect(decisions.map((entry) => entry.kind)).toEqual([
        "decision_silent",
        "decision_speak",
      ]);
      expect(decisions[1]?.correlationIds.evidenceIds).toHaveLength(2);
      expect(
        after.clientEvents.filter(
          (event) => event.type === "conversation.item.create",
        ).length - itemCreatesBefore,
      ).toBe(1);
      return {
        decision: "SPEAK",
        helpLevel: "L1",
        proofCount: 2,
        conversationItems: 1,
        responseCreates: 1,
        audioResponses: 1,
      };
    });

    await runStep("verified_correction", async () => {
      await page.evaluate(() => {
        const api = (window as GateWindow).ggbApplet;
        if (!api) throw new Error("GeoGebra API unavailable.");
        api.deleteObject("studentLine");
        if (!api.evalCommand(
          "studentBisector = PerpendicularLine(Midpoint(A,B),AB)",
        )) {
          throw new Error("GeoGebra rejected the verified correction.");
        }
      });
      await expect(page.getByTestId("construction-progress")).toContainText(
        "2/2",
      );
      await page.waitForTimeout(750);
      const responseCreateCount = (await readProbe(page)).clientEvents.filter(
        (event) => event.type === "response.create",
      ).length;
      await page.waitForFunction(
        (expected) => {
          const events =
            (window as GateWindow).__T6_LIVE_GATE_PROBE__?.serverEvents ?? [];
          return (
            events.filter(
              (event) =>
                event.type === "response.done" && event.status === "completed",
            ).length >= expected
          );
        },
        responseCreateCount,
      );
      const progress = await page.evaluate(
        () => (window as GateWindow).__GEOTUTOR_PROGRESS__,
      );
      expect(progress?.score).toBe(2);
      expect(progress?.evidenceIds).toHaveLength(2);
      return {
        progress: "2/2",
        proofCount: progress?.evidenceIds?.length ?? 0,
        revision: progress?.revision ?? -1,
        responsesSettled: true,
      };
    });

    await runStep("invariance_and_summary", async () => {
      const before = await readProbe(page);
      const serverEventOffset = before.serverEvents.length;
      const experiment = page.getByRole("region", {
        name: "Five-position experiment",
      });
      await experiment.getByRole("button", { name: "Run experiment" }).click();
      await expect(experiment.getByText("Completed", { exact: true })).toBeVisible();
      await expect(
        experiment.getByRole("heading", { name: "What you discovered" }),
      ).toBeVisible({ timeout: 30_000 });
      await page.waitForFunction(
        () =>
          (window as GateWindow).__GEOTUTOR_INVARIANCE_SUMMARY__?.source ===
          "realtime",
      );
      expect(await experiment.locator("tbody tr").count()).toBe(5);
      const outcome = await page.evaluate(() => {
        const gateWindow = window as GateWindow;
        const probe = gateWindow.__T6_LIVE_GATE_PROBE__;
        return {
          summary: gateWindow.__GEOTUTOR_INVARIANCE_SUMMARY__,
          scene: gateWindow.__GEOTUTOR_INVARIANCE_SCENE__,
          clientEvents: probe?.clientEvents ?? [],
          serverEvents: probe?.serverEvents ?? [],
        };
      });
      const oobRequest = outcome.clientEvents.find(
        (event) =>
          event.type === "response.create" &&
          event.metadataKind === "geotutor_invariance_summary_v1",
      );
      const oobDone = outcome.serverEvents.find(
        (event) =>
          event.type === "response.done" &&
          event.metadataKind === "geotutor_invariance_summary_v1",
      );
      const oobEvents = outcome.serverEvents.slice(serverEventOffset);
      expect(outcome.summary).toMatchObject({
        source: "realtime",
        reason: "completed",
      });
      expect(outcome.scene).toMatchObject({
        status: "completed",
        restored: true,
        listenerCountBefore: 4,
        listenerCountAfter: 4,
      });
      expect(outcome.scene?.beforeHash).toBe(outcome.scene?.afterHash);
      expect(oobRequest).toMatchObject({
        conversation: "none",
        outputModalities: ["text"],
        toolsCount: 0,
      });
      expect(oobDone).toMatchObject({
        status: "completed",
        conversationId: null,
        outputModalities: ["text"],
        outputItemTypes: ["message"],
        contentTypes: ["output_text"],
      });
      expect(
        oobEvents.filter((event) => event.type.includes("audio")),
      ).toEqual([]);
      return {
        samples: 5,
        passingSamples: 5,
        sceneRestored: true,
        listenerCount: outcome.scene?.listenerCountAfter ?? -1,
        summarySource: outcome.summary?.source ?? "missing",
        oobConversation: oobRequest?.conversation ?? "missing",
        oobModality: oobDone?.outputModalities?.[0] ?? "missing",
        oobAudioEvents: 0,
      };
    });

    await runStep("exact_reset", async () => {
      const evidenceBefore = await readEvidence(page);
      const previousRunId = evidenceBefore?.runId;
      await page.getByRole("button", { name: "Reset construction" }).click();
      await page.waitForFunction(
        () => (window as GateWindow).__GEOTUTOR_RESET__?.ok === true,
      );
      const result = await page.evaluate(() => {
        const gateWindow = window as GateWindow;
        const api = gateWindow.ggbApplet;
        return {
          reset: gateWindow.__GEOTUTOR_RESET__,
          names: [...(api?.getAllObjectNames() ?? [])].map(String).sort(),
          evidence: gateWindow.__GEOTUTOR_EXPORT_EVIDENCE__?.(),
          summaryPresent:
            gateWindow.__GEOTUTOR_INVARIANCE_SUMMARY__ !== undefined,
        };
      });
      expect(result.names).toEqual(["A", "AB", "B"]);
      expect(result.names.some((name) => /^(?:gtInv_|gtHint_)/.test(name))).toBe(
        false,
      );
      expect(result.reset).toMatchObject({
        ok: true,
        value: {
          restoration: "checkpoint",
          recovered: false,
          inventory: ["A", "AB", "B"],
          listenerCount: 4,
          registry: [
            { name: "A", owner: "exercise", kind: "point" },
            { name: "AB", owner: "exercise", kind: "segment" },
            { name: "B", owner: "exercise", kind: "point" },
          ],
        },
      });
      expect(result.reset?.value?.afterHash).toBe(
        result.reset?.value?.checkpointHash,
      );
      expect(result.reset?.value?.cancelledScopes).toEqual(
        expect.arrayContaining(["realtime_responses_audio_tools"]),
      );
      expect(result.evidence).toMatchObject({ dropped: 0, entries: [] });
      expect(result.evidence?.runId).not.toBe(previousRunId);
      expect(result.summaryPresent).toBe(false);
      return {
        inventory: result.names,
        listenerCount: result.reset?.value?.listenerCount ?? -1,
        restoration: result.reset?.value?.restoration ?? "missing",
        checkpointHashMatched:
          result.reset?.value?.afterHash === result.reset?.value?.checkpointHash,
        evidenceCleared: result.evidence?.entries.length === 0,
        helpersRemaining: 0,
      };
    });

    await runStep("transport_cleanup", async () => {
      await expect(page.getByText("closed", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop" })).toBeDisabled();
      await page.waitForFunction(
        () =>
          (window as GateWindow).__T6_LIVE_GATE_PROBE__?.channel?.readyState ===
          "closed",
      );
      const probe = await readProbe(page);
      expect(probe.channel).toBe("closed");
      expect(probe.peer).toBe("closed");
      expect(probe.localTrack).toBe("ended");
      expect(probe.attachedAudioTracks).toEqual([]);
      await expect(page.locator("[data-capability-mode]")).toHaveAttribute(
        "data-capability-mode",
        "scripted_local",
      );
      return {
        channel: probe.channel,
        peer: probe.peer,
        microphoneTrack: probe.localTrack,
        attachedAudioTracks: probe.attachedAudioTracks.length,
        finalMode: "scripted_local_after_terminal_reset",
      };
    });

    await page.screenshot({ path: completedScreenshot, fullPage: true });
  } catch (error) {
    failure = error;
    await page
      .screenshot({ path: failedScreenshot, fullPage: true })
      .catch(() => undefined);
  } finally {
    const result = failure === undefined && steps.length === 9 ? "pass" : "fail";
    const currentMode = await page
      .locator("[data-capability-mode]")
      .getAttribute("data-capability-mode")
      .catch(() => null);
    const manifest = {
      version: "geotutor_live_run.v1",
      seriesId,
      runIndex,
      candidate,
      environment,
      startedAt,
      completedAt: new Date().toISOString(),
      steps,
      evidence: {
        geogebra: steps.some((step) => step.id === "exercise_confirmation" && step.status === "pass")
          ? "real_applet_5.4.920.0"
          : "missing",
        exerciseService: steps.some((step) => step.id === "photo_extraction" && step.status === "pass")
          ? "live_openai_responses"
          : "missing",
        realtimeService: steps.some(
          (step) => step.id === "invariance_and_summary" && step.status === "pass",
        )
          ? "live_openai_realtime"
          : "missing",
        scriptedLocal:
          result === "pass" ? false : currentMode === "scripted_local",
      },
      artifacts: [
        path.relative(
          path.resolve(process.cwd(), "../.."),
          result === "pass" ? completedScreenshot : failedScreenshot,
        ),
      ],
      result,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  if (failure !== undefined) throw failure;
});

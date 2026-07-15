import { describe, expect, it } from "vitest";

import {
  EMPTY_RETRY_BACKOFF,
  RETRY_BACKOFF_DELAYS_MS,
  assessCapabilitySupport,
  createInitialCapabilityMode,
  isCapabilityReconnectSafe,
  nextRetryBackoff,
  retryAllowed,
  transitionCapabilityMode,
} from "./capability-mode";

describe("CapabilityMode", () => {
  it("keeps exactly the three contracted modes and only permits user-proven live upgrades", () => {
    const local = createInitialCapabilityMode("local_ready", 10);
    const typed = transitionCapabilityMode(
      local,
      { kind: "typed_live", reason: "typed_connected" },
      "user_connected_typed",
      20,
    );
    const voice = transitionCapabilityMode(
      typed,
      { kind: "live_voice", reason: "voice_connected" },
      "user_connected_voice",
      30,
    );

    expect([local.kind, typed.kind, voice.kind]).toEqual([
      "scripted_local",
      "typed_live",
      "live_voice",
    ]);
    expect([local.since, typed.since, voice.since]).toEqual([10, 20, 30]);
    expect(() =>
      transitionCapabilityMode(
        local,
        { kind: "live_voice", reason: "voice_connected" },
        "transport_failure",
      ),
    ).toThrow(/user-started voice/);
    expect(() =>
      transitionCapabilityMode(
        voice,
        { kind: "typed_live", reason: "typed_connected" },
        "transport_failure",
      ),
    ).toThrow(/user-started text/);
  });

  it.each([
    [{ online: false }, [false, false, "offline"]],
    [{ webRtc: false }, [false, false, "browser_missing_webrtc"]],
    [{ dataChannel: false }, [false, false, "browser_missing_webrtc"]],
    [{ microphone: false }, [false, true, "browser_missing_microphone"]],
    [{ audio: false }, [false, true, "browser_missing_audio"]],
    [{}, [true, true, "local_ready"]],
  ] as const)("assesses the browser matrix %j", (override, expected) => {
    const support = assessCapabilitySupport({
      webRtc: true,
      dataChannel: true,
      microphone: true,
      audio: true,
      online: true,
      ...override,
    });
    expect([support.liveVoice, support.typedLive, support.localReason]).toEqual(
      expected,
    );
  });

  it("bounds repeated failure backoff without scheduling an automatic retry", () => {
    let state = EMPTY_RETRY_BACKOFF;
    const observed: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      state = nextRetryBackoff(state, 100);
      observed.push(state.delayMs);
    }

    expect(observed).toEqual([1_000, 2_000, 4_000, 5_000, 5_000, 5_000, 5_000]);
    expect(Math.max(...observed)).toBe(RETRY_BACKOFF_DELAYS_MS.at(-1));
    expect(retryAllowed(state, state.retryAt - 1)).toBe(false);
    expect(retryAllowed(state, state.retryAt)).toBe(true);
  });

  it.each([
    ["idle", {}, true],
    ["failed", {}, true],
    ["closed", {}, true],
    ["connecting", {}, false],
    ["live", {}, false],
    ["idle", { studentIsDragging: true }, false],
    ["idle", { studentIsSpeaking: true }, false],
    ["idle", { tutorIsSpeaking: true }, false],
  ] as const)(
    "allows a manual reconnect only in a safe state: %s %j",
    (connection, interactionOverride, expected) => {
      expect(
        isCapabilityReconnectSafe(connection, {
          interaction: {
            studentIsDragging: false,
            studentIsSpeaking: false,
            tutorIsSpeaking: false,
            ...interactionOverride,
          },
        }),
      ).toBe(expected);
    },
  );

  it("rejects pending interventions and active responses", () => {
    const interaction = {
      studentIsDragging: false,
      studentIsSpeaking: false,
      tutorIsSpeaking: false,
    };
    expect(
      isCapabilityReconnectSafe("idle", { interaction, pendingIntervention: {} }),
    ).toBe(false);
    expect(
      isCapabilityReconnectSafe("idle", { interaction, activeResponse: {} }),
    ).toBe(false);
  });
});

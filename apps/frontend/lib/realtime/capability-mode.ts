export const CAPABILITY_MODE_KINDS = [
  "live_voice",
  "typed_live",
  "scripted_local",
] as const;

export type CapabilityModeKind = (typeof CAPABILITY_MODE_KINDS)[number];

export type CapabilityModeReason =
  | "local_ready"
  | "user_selected_local"
  | "offline"
  | "browser_missing_webrtc"
  | "browser_missing_microphone"
  | "browser_missing_audio"
  | "microphone_permission_denied"
  | "voice_connection_failed"
  | "voice_connection_lost"
  | "typed_connection_failed"
  | "typed_connection_lost"
  | "latency_budget_exceeded"
  | "construction_reset"
  | "voice_connected"
  | "typed_connected";

export type CapabilityMode = Readonly<{
  kind: CapabilityModeKind;
  reason: CapabilityModeReason;
  since: number;
}>;

export type CapabilityTransitionTrigger =
  | "user_connected_voice"
  | "user_connected_typed"
  | "transport_failure"
  | "user_selected_local"
  | "construction_reset"
  | "offline"
  | "capability_missing";

export type BrowserCapabilitySnapshot = Readonly<{
  webRtc: boolean;
  dataChannel: boolean;
  microphone: boolean;
  audio: boolean;
  online: boolean;
}>;

export type CapabilitySupport = Readonly<{
  liveVoice: boolean;
  typedLive: boolean;
  localReason: Extract<
    CapabilityModeReason,
    | "local_ready"
    | "offline"
    | "browser_missing_webrtc"
    | "browser_missing_microphone"
    | "browser_missing_audio"
  >;
}>;

const ALLOWED_REASONS: Record<CapabilityModeKind, ReadonlySet<CapabilityModeReason>> = {
  live_voice: new Set(["voice_connected"]),
  typed_live: new Set(["typed_connected"]),
  scripted_local: new Set([
    "local_ready",
    "user_selected_local",
    "offline",
    "browser_missing_webrtc",
    "browser_missing_microphone",
    "browser_missing_audio",
    "microphone_permission_denied",
    "voice_connection_failed",
    "voice_connection_lost",
    "typed_connection_failed",
    "typed_connection_lost",
    "latency_budget_exceeded",
    "construction_reset",
  ]),
};

export function createInitialCapabilityMode(
  reason: CapabilityMode["reason"] = "local_ready",
  now = Date.now(),
): CapabilityMode {
  return transitionCapabilityMode(
    { kind: "scripted_local", reason: "local_ready", since: now },
    { kind: "scripted_local", reason },
    reason === "offline" ? "offline" : "capability_missing",
    now,
  );
}

export function transitionCapabilityMode(
  current: CapabilityMode,
  next: Pick<CapabilityMode, "kind" | "reason">,
  trigger: CapabilityTransitionTrigger,
  now = Date.now(),
): CapabilityMode {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("Capability mode timestamps must be finite and non-negative.");
  }
  if (!ALLOWED_REASONS[next.kind].has(next.reason)) {
    throw new Error(`Reason ${next.reason} is invalid for ${next.kind}.`);
  }
  if (next.kind === "live_voice" && trigger !== "user_connected_voice") {
    throw new Error("live_voice requires a completed user-started voice connection.");
  }
  if (next.kind === "typed_live" && trigger !== "user_connected_typed") {
    throw new Error("typed_live requires a completed user-started text connection.");
  }
  if (
    next.kind === "scripted_local" &&
    (trigger === "user_connected_voice" || trigger === "user_connected_typed")
  ) {
    throw new Error("A completed live connection cannot produce scripted_local.");
  }
  if (current.kind === next.kind && current.reason === next.reason) return current;
  return Object.freeze({ ...next, since: now });
}

export function assessCapabilitySupport(
  snapshot: BrowserCapabilitySnapshot,
): CapabilitySupport {
  if (!snapshot.online) {
    return { liveVoice: false, typedLive: false, localReason: "offline" };
  }
  if (!snapshot.webRtc || !snapshot.dataChannel) {
    return {
      liveVoice: false,
      typedLive: false,
      localReason: "browser_missing_webrtc",
    };
  }
  if (!snapshot.microphone) {
    return {
      liveVoice: false,
      typedLive: true,
      localReason: "browser_missing_microphone",
    };
  }
  if (!snapshot.audio) {
    return {
      liveVoice: false,
      typedLive: true,
      localReason: "browser_missing_audio",
    };
  }
  return { liveVoice: true, typedLive: true, localReason: "local_ready" };
}

export type RetryBackoff = Readonly<{
  failures: number;
  delayMs: number;
  retryAt: number;
}>;

export const RETRY_BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 5_000] as const;

export const EMPTY_RETRY_BACKOFF: RetryBackoff = Object.freeze({
  failures: 0,
  delayMs: 0,
  retryAt: 0,
});

export function nextRetryBackoff(
  current: RetryBackoff,
  now = Date.now(),
): RetryBackoff {
  const failures = current.failures + 1;
  const delayMs =
    RETRY_BACKOFF_DELAYS_MS[
      Math.min(failures - 1, RETRY_BACKOFF_DELAYS_MS.length - 1)
    ];
  return Object.freeze({ failures, delayMs, retryAt: now + delayMs });
}

export function retryAllowed(backoff: RetryBackoff, now = Date.now()): boolean {
  return now >= backoff.retryAt;
}

export type CapabilitySafetyState = Readonly<{
  interaction: Readonly<{
    studentIsDragging: boolean;
    studentIsSpeaking: boolean;
    tutorIsSpeaking: boolean;
  }>;
  pendingIntervention?: unknown;
  activeResponse?: unknown;
}>;

export function isCapabilityReconnectSafe(
  connectionState: "idle" | "connecting" | "live" | "failed" | "closed",
  pedagogy?: CapabilitySafetyState,
): boolean {
  if (connectionState === "connecting" || connectionState === "live") return false;
  return !(
    pedagogy?.interaction.studentIsDragging ||
    pedagogy?.interaction.studentIsSpeaking ||
    pedagogy?.interaction.tutorIsSpeaking ||
    pedagogy?.pendingIntervention ||
    pedagogy?.activeResponse
  );
}

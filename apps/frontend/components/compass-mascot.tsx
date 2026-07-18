"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Image from "next/image";

import type { VoiceTurnState } from "@/lib/realtime/voice-turn";
import { useLanguage } from "./language-provider";

export const MASCOT_ACTIVITIES = [
  "idle",
  "receiving",
  "thinking",
  "listening",
  "speaking",
  "modifying",
  "hinting",
  "celebrating",
  "error",
] as const;

export type MascotActivity = (typeof MASCOT_ACTIVITIES)[number];
export type MascotPlacement = "floating" | "workspace" | "coach" | "canvas";
export type MascotFocusSide = "left" | "center" | "right";
export type MascotSpeechEnergy = number | null;

type MascotSpeechEnergyListener = (energy: MascotSpeechEnergy) => void;

type MascotLease = Readonly<{
  activity: MascotActivity;
  sequence: number;
  source: string;
  token: number;
}>;

export type MascotSnapshot = Readonly<{
  activity: MascotActivity;
  source: string | null;
}>;

export type MascotController = Readonly<{
  current: MascotSnapshot;
  start(source: string, activity: Exclude<MascotActivity, "idle">): void;
  stop(source: string): void;
  pulse(
    source: string,
    activity: Exclude<MascotActivity, "idle">,
    durationMs?: number,
  ): void;
  setSpeechEnergy(energy: MascotSpeechEnergy): void;
  subscribeSpeechEnergy(listener: MascotSpeechEnergyListener): () => void;
  reset(): void;
}>;

export const MASCOT_PRIORITY: Readonly<Record<MascotActivity, number>> = {
  idle: 0,
  receiving: 20,
  thinking: 30,
  listening: 40,
  speaking: 50,
  modifying: 60,
  hinting: 70,
  celebrating: 80,
  error: 90,
};

const ROW_BY_ACTIVITY: Readonly<Record<MascotActivity, number>> = {
  idle: 0,
  receiving: 1,
  thinking: 2,
  listening: 3,
  speaking: 4,
  modifying: 5,
  hinting: 6,
  celebrating: 7,
  error: 8,
};

// The first cell of every row is the clean key pose in the current atlas.
// Activity is animated by the compositor, never by advancing whole-body cells.
const POSE_BY_ACTIVITY: Readonly<Record<MascotActivity, number>> = {
  idle: 0,
  receiving: 0,
  thinking: 0,
  listening: 0,
  speaking: 0,
  modifying: 0,
  hinting: 0,
  celebrating: 0,
  error: 0,
};

const COPY: Readonly<
  Record<MascotActivity, Readonly<{ en: string; fr: string }>>
> = {
  idle: { en: "Here when you need me", fr: "Je suis là si tu as besoin" },
  receiving: { en: "I received your exercise", fr: "J’ai reçu ton exercice" },
  thinking: { en: "I’m thinking it through", fr: "Je réfléchis avec toi" },
  listening: { en: "I’m listening", fr: "Je t’écoute" },
  speaking: { en: "Let’s reason together", fr: "Raisonnons ensemble" },
  modifying: { en: "I’m updating the workspace", fr: "Je mets l’espace à jour" },
  hinting: { en: "I’m drawing a small hint", fr: "Je trace un petit indice" },
  celebrating: { en: "That’s it — well done!", fr: "C’est ça — bravo !" },
  error: { en: "I hit a snag", fr: "J’ai rencontré un souci" },
};

const IDLE_SNAPSHOT: MascotSnapshot = Object.freeze({
  activity: "idle",
  source: null,
});

const NOOP = () => undefined;
const NOOP_SUBSCRIBE = () => NOOP;
const DEFAULT_CONTROLLER: MascotController = Object.freeze({
  current: IDLE_SNAPSHOT,
  start: NOOP,
  stop: NOOP,
  pulse: NOOP,
  setSpeechEnergy: NOOP,
  subscribeSpeechEnergy: NOOP_SUBSCRIBE,
  reset: NOOP,
});

const MascotContext = createContext<MascotController>(DEFAULT_CONTROLLER);

let atlasDecodePromise: Promise<void> | undefined;

function preloadMascotAtlas(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (atlasDecodePromise) return atlasDecodePromise;
  const image = new window.Image();
  image.src = "/mascot/compass-mentor-atlas.webp";
  atlasDecodePromise =
    typeof image.decode === "function"
      ? image.decode().catch(() => undefined)
      : Promise.resolve();
  return atlasDecodePromise;
}

export function selectMascotLease(
  leases: Iterable<MascotLease>,
): MascotSnapshot {
  let selected: MascotLease | undefined;
  for (const lease of leases) {
    if (
      !selected ||
      MASCOT_PRIORITY[lease.activity] > MASCOT_PRIORITY[selected.activity] ||
      (MASCOT_PRIORITY[lease.activity] ===
        MASCOT_PRIORITY[selected.activity] &&
        lease.sequence > selected.sequence)
    ) {
      selected = lease;
    }
  }
  return selected
    ? Object.freeze({ activity: selected.activity, source: selected.source })
    : IDLE_SNAPSHOT;
}

export function mascotActivityForVoiceTurn(
  state: VoiceTurnState,
): Exclude<MascotActivity, "idle"> | null {
  switch (state) {
    case "speaking":
      return "listening";
    case "committed":
    case "requested":
      return "thinking";
    case "responding":
      return "speaking";
    case "tooling":
      return "modifying";
    case "failed":
      return "error";
    case "completed":
    case "cancelled":
      return null;
  }
}

export function mascotActivityForRealtimeEvent(
  type: string,
): Exclude<MascotActivity, "idle"> | null | undefined {
  switch (type) {
    case "input_audio_buffer.speech_started":
      return "listening";
    case "input_audio_buffer.speech_stopped":
    case "input_audio_buffer.committed":
      return "thinking";
    case "response.created":
      return "speaking";
    case "response.done":
      return null;
    case "error":
      return "error";
    default:
      return undefined;
  }
}

export function MascotProvider({ children }: { children: ReactNode }) {
  const leasesRef = useRef(new Map<string, MascotLease>());
  const timersRef = useRef(new Map<string, number>());
  const speechEnergyRef = useRef<MascotSpeechEnergy>(null);
  const speechEnergyListenersRef = useRef(new Set<MascotSpeechEnergyListener>());
  const sequenceRef = useRef(0);
  const tokenRef = useRef(0);
  const [snapshot, setSnapshot] = useState<MascotSnapshot>(IDLE_SNAPSHOT);

  const publish = useCallback(() => {
    const next = selectMascotLease(leasesRef.current.values());
    setSnapshot((previous) =>
      previous.activity === next.activity && previous.source === next.source
        ? previous
        : next,
    );
  }, []);

  const clearTimer = useCallback((source: string) => {
    const timer = timersRef.current.get(source);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(source);
  }, []);

  const start = useCallback<MascotController["start"]>(
    (source, activity) => {
      if (!source) return;
      clearTimer(source);
      leasesRef.current.set(
        source,
        Object.freeze({
          activity,
          sequence: ++sequenceRef.current,
          source,
          token: ++tokenRef.current,
        }),
      );
      publish();
    },
    [clearTimer, publish],
  );

  const stop = useCallback<MascotController["stop"]>(
    (source) => {
      clearTimer(source);
      if (leasesRef.current.delete(source)) publish();
    },
    [clearTimer, publish],
  );

  const pulse = useCallback<MascotController["pulse"]>(
    (source, activity, durationMs = 1_800) => {
      if (!source) return;
      clearTimer(source);
      const token = ++tokenRef.current;
      leasesRef.current.set(
        source,
        Object.freeze({
          activity,
          sequence: ++sequenceRef.current,
          source,
          token,
        }),
      );
      publish();
      timersRef.current.set(
        source,
        window.setTimeout(() => {
          timersRef.current.delete(source);
          if (leasesRef.current.get(source)?.token !== token) return;
          leasesRef.current.delete(source);
          publish();
        }, Math.max(100, durationMs)),
      );
    },
    [clearTimer, publish],
  );

  const setSpeechEnergy = useCallback<MascotController["setSpeechEnergy"]>(
    (energy) => {
      const next =
        energy === null || !Number.isFinite(energy)
          ? null
          : Math.min(1, Math.max(0, energy));
      if (Object.is(speechEnergyRef.current, next)) return;
      speechEnergyRef.current = next;
      for (const listener of speechEnergyListenersRef.current) listener(next);
    },
    [],
  );

  const subscribeSpeechEnergy = useCallback<
    MascotController["subscribeSpeechEnergy"]
  >((listener) => {
    speechEnergyListenersRef.current.add(listener);
    listener(speechEnergyRef.current);
    return () => speechEnergyListenersRef.current.delete(listener);
  }, []);

  const reset = useCallback(() => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
    leasesRef.current.clear();
    setSpeechEnergy(null);
    setSnapshot(IDLE_SNAPSHOT);
  }, [setSpeechEnergy]);

  useEffect(() => {
    void preloadMascotAtlas();
  }, []);

  useEffect(() => {
    const debugWindow = window as Window & {
      __COMPASS_MASCOT_DEBUG__?: Readonly<{
        getSnapshot(): MascotSnapshot;
        start: MascotController["start"];
        stop: MascotController["stop"];
        pulse: MascotController["pulse"];
        setSpeechEnergy: MascotController["setSpeechEnergy"];
        reset: MascotController["reset"];
      }>;
    };
    debugWindow.__COMPASS_MASCOT_DEBUG__ = Object.freeze({
      getSnapshot: () => selectMascotLease(leasesRef.current.values()),
      start,
      stop,
      pulse,
      setSpeechEnergy,
      reset,
    });
    return () => {
      delete debugWindow.__COMPASS_MASCOT_DEBUG__;
    };
  }, [pulse, reset, setSpeechEnergy, start, stop]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
      leasesRef.current.clear();
      speechEnergyListenersRef.current.clear();
    },
    [],
  );

  const value: MascotController = {
    current: snapshot,
    start,
    stop,
    pulse,
    setSpeechEnergy,
    subscribeSpeechEnergy,
    reset,
  };

  return <MascotContext.Provider value={value}>{children}</MascotContext.Provider>;
}

export function useMascotController(): MascotController {
  return useContext(MascotContext);
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return reduced;
}

export function CompassMascot({
  placement = "floating",
  focusSide = "center",
  labelOverride,
  quiet = false,
}: {
  placement?: MascotPlacement;
  focusSide?: MascotFocusSide;
  labelOverride?: string;
  quiet?: boolean;
}) {
  const { language, text } = useLanguage();
  const { current, subscribeSpeechEnergy } = useMascotController();
  const reducedMotion = useReducedMotion();
  const label = labelOverride ?? COPY[current.activity][language];

  if (placement === "workspace") {
    return (
      <aside
        className="compass-mascot-presence compass-mascot-presence--workspace"
        data-placement={placement}
        data-mascot-state={current.activity}
        data-source={current.source ?? "idle"}
        aria-label={text("Compass presence", "Présence de Compass")}
      >
        <Image
          className="compass-mascot-portrait"
          src="/mascot/compass-mentor-leaning.png"
          alt=""
          width={1627}
          height={967}
          priority
        />
        <p>{label}</p>
      </aside>
    );
  }

  return (
    <MascotAnimation
      snapshot={current}
      language={language}
      reducedMotion={reducedMotion}
      title={text("Compass presence", "Présence de Compass")}
      placement={placement}
      focusSide={focusSide}
      label={label}
      quiet={quiet}
      subscribeSpeechEnergy={subscribeSpeechEnergy}
    />
  );
}

function MascotAnimation({
  snapshot,
  language,
  reducedMotion,
  title,
  placement,
  focusSide,
  label,
  quiet,
  subscribeSpeechEnergy,
}: {
  snapshot: MascotSnapshot;
  language: "en" | "fr";
  reducedMotion: boolean;
  title: string;
  placement: Exclude<MascotPlacement, "workspace">;
  focusSide: MascotFocusSide;
  label: string;
  quiet: boolean;
  subscribeSpeechEnergy: MascotController["subscribeSpeechEnergy"];
}) {
  const presenceRef = useRef<HTMLElement>(null);
  const renderedFrame = reducedMotion ? 0 : POSE_BY_ACTIVITY[snapshot.activity];
  const row = ROW_BY_ACTIVITY[snapshot.activity];
  const frameStyle: CSSProperties = {
    backgroundPosition: `${(renderedFrame / 7) * 100}% ${(row / 8) * 100}%`,
  };

  useEffect(
    () =>
      subscribeSpeechEnergy((energy) => {
        const presence = presenceRef.current;
        if (!presence) return;
        const hasMeter = energy !== null;
        if (presence.dataset.speechSignal !== (hasMeter ? "meter" : "fallback")) {
          presence.dataset.speechSignal = hasMeter ? "meter" : "fallback";
        }
        const level = energy ?? 0;
        presence.style.setProperty("--mascot-speech-energy", level.toFixed(3));
        presence.style.setProperty(
          "--mascot-speech-lift",
          `${(-2.4 * level).toFixed(2)}px`,
        );
        presence.style.setProperty(
          "--mascot-mouth-scale",
          (0.18 + level * 1.45).toFixed(3),
        );
        presence.style.setProperty(
          "--mascot-wave-opacity",
          Math.min(1, 0.05 + level * 1.2).toFixed(3),
        );
        presence.style.setProperty(
          "--mascot-wave-scale",
          (0.35 + level * 0.65).toFixed(3),
        );
      }),
    [subscribeSpeechEnergy],
  );

  return (
    <aside
      ref={presenceRef}
      className={`compass-mascot-presence compass-mascot-presence--${placement}`}
      data-placement={placement}
      data-frame={renderedFrame}
      data-renderer="css-compositor"
      data-mascot-state={snapshot.activity}
      data-source={snapshot.source ?? "idle"}
      data-focus-side={focusSide}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-speech-signal="fallback"
      aria-label={title}
    >
      <div className="compass-mascot-sprite-stage" aria-hidden="true">
        <div
          className="compass-mascot-sprite compass-mascot-sprite--current"
          style={frameStyle}
        />
        <span className="compass-mascot-mouth" />
        <span className="compass-mascot-motion-accent">
          <i />
          <i />
          <i />
        </span>
      </div>
      {quiet ? null : <p>{label ?? COPY[snapshot.activity][language]}</p>}
    </aside>
  );
}

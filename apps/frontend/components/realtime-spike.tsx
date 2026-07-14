"use client";

import { useEffect, useRef, useState } from "react";

import {
  RealtimeSessionError,
  RealtimeWebRtcSession,
  type RealtimeConnectionState,
} from "@/lib/realtime/webrtc-session";

function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission was denied. Allow access and try again.";
  }
  if (error instanceof RealtimeSessionError) {
    return error.message;
  }
  return "The Realtime connection could not be established. You can try again.";
}

export function RealtimeSpike() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<RealtimeWebRtcSession | undefined>(undefined);
  const [state, setState] = useState<RealtimeConnectionState>("idle");
  const [timeline, setTimeline] = useState<string[]>([]);
  const [lastEvent, setLastEvent] = useState<string>();
  const [remoteAudio, setRemoteAudio] = useState(false);
  const [error, setError] = useState<string>();

  const appendTimeline = (entry: string) => {
    setTimeline((current) => [...current.slice(-6), entry]);
  };

  const stop = () => {
    sessionRef.current?.stop();
    sessionRef.current = undefined;
  };

  const start = async () => {
    if (!audioRef.current || state === "connecting" || state === "live") {
      return;
    }

    stop();
    setTimeline([]);
    setLastEvent(undefined);
    setRemoteAudio(false);
    setError(undefined);

    const session = new RealtimeWebRtcSession(audioRef.current, {
      onState: setState,
      onTimeline: appendTimeline,
      onEvent: (event) => setLastEvent(event.type),
      onRemoteAudio: setRemoteAudio,
      onFailure: (failure) => setError(failure.message),
    });
    sessionRef.current = session;

    try {
      await session.start();
    } catch (reason) {
      setError(friendlyError(reason));
    }
  };

  useEffect(() => () => sessionRef.current?.stop(), []);

  return (
    <section className="spike realtime-spike" aria-labelledby="realtime-spike-title">
      <div className="spike-heading">
        <div>
          <p className="section-index">T0 / Realtime spike</p>
          <h2 id="realtime-spike-title">A voice connection with visible boundaries</h2>
        </div>
        <p>
          Your microphone starts only after consent. Stop closes the track,
          oai-events channel, peer connection and remote audio.
        </p>
      </div>

      <div className="realtime-console">
        <div className="connection-control">
          <p className={`connection-state connection-state-${state}`} role="status">
            {state}
          </p>
          <p className="connection-copy">
            {state === "idle" && "Ready to request microphone access."}
            {state === "connecting" && "Negotiating the secure WebRTC session…"}
            {state === "live" && "Speak naturally. Remote audio is enabled."}
            {state === "failed" && error}
            {state === "closed" && "All session resources are closed."}
          </p>
          <div className="connection-actions">
            <button
              type="button"
              onClick={() => void start()}
              disabled={state === "connecting" || state === "live"}
            >
              {state === "failed" || state === "closed" ? "Try again" : "Start voice"}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={stop}
              disabled={state !== "connecting" && state !== "live"}
            >
              Stop
            </button>
          </div>
          <audio ref={audioRef} autoPlay aria-label="GeoTutor remote audio" />
        </div>

        <div className="connection-evidence" aria-live="polite">
          <div>
            <span>Data channel</span>
            <strong>{state === "live" ? "oai-events open" : "not open"}</strong>
          </div>
          <div>
            <span>Last server event</span>
            <strong>{lastEvent ?? "none"}</strong>
          </div>
          <div>
            <span>Remote audio</span>
            <strong>{remoteAudio ? "track attached" : "not attached"}</strong>
          </div>
          <ol aria-label="WebRTC timeline">
            {timeline.map((entry, index) => (
              <li key={`${index}-${entry}`}>{entry}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

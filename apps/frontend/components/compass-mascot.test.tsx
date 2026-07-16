import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompassMascot,
  MascotProvider,
  mascotActivityForRealtimeEvent,
  mascotActivityForVoiceTurn,
  useMascotController,
} from "./compass-mascot";

function Controls() {
  const mascot = useMascotController();
  return (
    <div>
      <button onClick={() => mascot.start("analysis", "thinking")}>think</button>
      <button onClick={() => mascot.start("hint", "hinting")}>hint</button>
      <button onClick={() => mascot.stop("hint")}>stop hint</button>
      <button onClick={() => mascot.pulse("alert", "error", 500)}>error</button>
      <button onClick={() => mascot.start("alert", "celebrating")}>replace</button>
      <button onClick={mascot.reset}>reset</button>
    </div>
  );
}

function renderMascot() {
  return render(
    <MascotProvider>
      <CompassMascot />
      <Controls />
    </MascotProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CompassMascot", () => {
  it("arbitrates concurrent sources by priority and returns safely to idle", () => {
    vi.useFakeTimers();
    renderMascot();
    const presence = () => screen.getByLabelText("Compass presence");

    expect(presence()).toHaveAttribute("data-mascot-state", "idle");
    fireEvent.click(screen.getByRole("button", { name: "think" }));
    expect(presence()).toHaveAttribute("data-mascot-state", "thinking");

    fireEvent.click(screen.getByRole("button", { name: "hint" }));
    expect(presence()).toHaveAttribute("data-mascot-state", "hinting");
    fireEvent.click(screen.getByRole("button", { name: "stop hint" }));
    expect(presence()).toHaveAttribute("data-mascot-state", "thinking");

    fireEvent.click(screen.getByRole("button", { name: "error" }));
    expect(presence()).toHaveAttribute("data-mascot-state", "error");
    act(() => vi.advanceTimersByTime(500));
    expect(presence()).toHaveAttribute("data-mascot-state", "thinking");

    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(presence()).toHaveAttribute("data-mascot-state", "idle");
    expect(presence()).toHaveAttribute("data-source", "idle");
  });

  it("does not let a stale pulse timer remove a newer lease from the same source", () => {
    vi.useFakeTimers();
    renderMascot();
    const presence = () => screen.getByLabelText("Compass presence");

    fireEvent.click(screen.getByRole("button", { name: "error" }));
    fireEvent.click(screen.getByRole("button", { name: "replace" }));
    act(() => vi.advanceTimersByTime(800));

    expect(presence()).toHaveAttribute("data-mascot-state", "celebrating");
    expect(presence()).toHaveAttribute("data-source", "alert");
  });

  it("plays a non-idle atlas sequence once and then settles", () => {
    vi.useFakeTimers();
    renderMascot();
    const presence = () => screen.getByLabelText("Compass presence");

    expect(presence()).toHaveAttribute("data-frame", "0");
    fireEvent.click(screen.getByRole("button", { name: "think" }));
    act(() => vi.advanceTimersByTime(170 * 7));
    expect(presence()).toHaveAttribute("data-frame", "7");
    act(() => vi.advanceTimersByTime(420));
    expect(presence()).toHaveAttribute("data-frame", "0");
    act(() => vi.advanceTimersByTime(2_000));
    expect(presence()).toHaveAttribute("data-frame", "0");
  });

  it("keeps a fixed first pose when reduced motion is requested", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    renderMascot();
    const presence = () => screen.getByLabelText("Compass presence");

    fireEvent.click(screen.getByRole("button", { name: "think" }));
    act(() => vi.advanceTimersByTime(2_000));
    expect(presence()).toHaveAttribute("data-mascot-state", "thinking");
    expect(presence()).toHaveAttribute("data-frame", "0");
  });
});

describe("mascotActivityForVoiceTurn", () => {
  it("maps only closed voice-turn states to presentation activities", () => {
    expect(mascotActivityForVoiceTurn("speaking")).toBe("listening");
    expect(mascotActivityForVoiceTurn("committed")).toBe("thinking");
    expect(mascotActivityForVoiceTurn("requested")).toBe("thinking");
    expect(mascotActivityForVoiceTurn("responding")).toBe("speaking");
    expect(mascotActivityForVoiceTurn("tooling")).toBe("modifying");
    expect(mascotActivityForVoiceTurn("failed")).toBe("error");
    expect(mascotActivityForVoiceTurn("completed")).toBeNull();
    expect(mascotActivityForVoiceTurn("cancelled")).toBeNull();
  });
});

describe("mascotActivityForRealtimeEvent", () => {
  it("maps exact server event types and ignores free-form or unknown input", () => {
    expect(
      mascotActivityForRealtimeEvent("input_audio_buffer.speech_started"),
    ).toBe("listening");
    expect(
      mascotActivityForRealtimeEvent("input_audio_buffer.speech_stopped"),
    ).toBe("thinking");
    expect(
      mascotActivityForRealtimeEvent("input_audio_buffer.committed"),
    ).toBe("thinking");
    expect(mascotActivityForRealtimeEvent("response.created")).toBe("speaking");
    expect(mascotActivityForRealtimeEvent("response.done")).toBeNull();
    expect(mascotActivityForRealtimeEvent("error")).toBe("error");
    expect(mascotActivityForRealtimeEvent("the transcript says thinking")).toBeUndefined();
  });
});

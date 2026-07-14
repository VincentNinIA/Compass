import { describe, expect, it } from "vitest";

import {
  ResponseGate,
  explicitResponseOwner,
  proactiveResponseOwner,
} from "./response-gate";

describe("T4-C06 ResponseGate", () => {
  it("allows one pending or active owner at a time", () => {
    const gate = new ResponseGate();
    const explicit = explicitResponseOwner("turn-1");
    const proactive = proactiveResponseOwner("directive-1");

    expect(gate.reserve(explicit)).toBe(true);
    expect(gate.reserve(proactive)).toBe(false);
    expect(gate.activate(explicit, "response-1")).toBe(true);
    expect(gate.reserve(proactive)).toBe(false);
    expect(gate.snapshot()).toEqual({
      owner: explicit,
      state: "active",
      responseId: "response-1",
    });
  });

  it("keeps an owner across a tool continuation then releases it", () => {
    const gate = new ResponseGate();
    const owner = explicitResponseOwner("turn-tools");

    expect(gate.reserve(owner)).toBe(true);
    expect(gate.activate(owner, "response-tools")).toBe(true);
    expect(gate.continue(owner)).toBe(true);
    expect(gate.snapshot()).toEqual({ owner, state: "pending" });
    expect(gate.activate(owner, "response-final")).toBe(true);
    expect(gate.release(owner, "response-final")).toBe(true);
    expect(gate.snapshot()).toBeUndefined();
  });

  it("rejects duplicate owners and mismatched terminals", () => {
    const gate = new ResponseGate();
    const owner = proactiveResponseOwner("directive-1");

    expect(gate.reserve(owner)).toBe(true);
    expect(gate.activate(owner, "response-1")).toBe(true);
    expect(gate.release(owner, "other-response")).toBe(false);
    expect(gate.release(owner, "response-1")).toBe(true);
    expect(gate.reserve(owner)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckpointService } from "./checkpoint";
import type { GeoGebraAdapter } from "./adapter";
import { SceneRegistry } from "./scene";
import { SnapshotService } from "./snapshot";
import {
  HintConfirmationLedger,
  type HintAuthorization,
} from "@/lib/pedagogy/hint-assistance";
import { HighlightManager } from "@/lib/tools/highlight";
import type { Checkpoint, GeoGebraApi } from "@/types/geogebra";
import { HINT_OBJECT_PREFIX, HintOrchestrator } from "./hint-orchestrator";

type HarnessOptions = {
  rejectHelper?: boolean;
  failHelperDelete?: boolean;
};

function authorization(level: 1 | 2 | 3 | 4): HintAuthorization {
  return Object.freeze({
    directiveId: `directive-l${level}`,
    level,
    source: "explicit",
    allowedTools:
      level === 3
        ? (Object.freeze(["highlight_objects"]) as readonly ["highlight_objects"])
        : Object.freeze([]),
    requiresConfirmation: level === 4,
    cleanupPolicy:
      level === 3
        ? "restore_visual_hint"
        : level === 4
          ? "remove_helpers_or_restore_checkpoint"
          : "none",
  });
}

function harness(options: HarnessOptions = {}) {
  const registry = new SceneRegistry();
  const commands = new Map<string, string>([
    ["A", "(-3,0)"],
    ["B", "(3,0)"],
    ["AB", "Segment(A,B)"],
    ["studentLine", "Line(A,B)"],
  ]);
  const colors = new Map<string, string>(
    [...commands.keys()].map((name) => [name, `#${name === "AB" ? "445566" : "112233"}`]),
  );
  for (const object of [
    { name: "A", owner: "exercise" as const, kind: "point" as const },
    { name: "B", owner: "exercise" as const, kind: "point" as const },
    { name: "AB", owner: "exercise" as const, kind: "segment" as const },
    { name: "studentLine", owner: "student" as const, kind: "line" as const },
  ]) {
    registry.register(object.name, object.owner, object.kind);
  }
  const api: GeoGebraApi = {
    evalCommand: vi.fn((command) => {
      const name = command.split("=")[0].trim();
      if (options.rejectHelper && name.startsWith(HINT_OBJECT_PREFIX)) return false;
      commands.set(name, command.split("=").slice(1).join("=").trim());
      colors.set(name, "#112233");
      return true;
    }),
    exists: (name) => commands.has(name),
    isDefined: (name) => commands.has(name),
    getCommandString: (name) => commands.get(name) ?? "",
    getColor: (name) => colors.get(name) ?? "#112233",
    setColor: vi.fn((name, red, green, blue) => {
      colors.set(
        name,
        `#${[red, green, blue]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")}`,
      );
    }),
    deleteObject: vi.fn((name) => {
      if (options.failHelperDelete && name.endsWith("_d")) return;
      commands.delete(name);
      colors.delete(name);
    }),
    setCoordSystem: vi.fn(),
    setFixed: vi.fn(),
    setLabelVisible: vi.fn(),
  };
  const adapter = {
    withApi<T>(operation: (value: GeoGebraApi) => T) {
      return { ok: true as const, value: operation(api) };
    },
  } as GeoGebraAdapter;
  const snapshots = new SnapshotService(adapter, registry);
  const baseline = snapshots.capture();
  if (!baseline.ok) throw new Error("baseline unavailable");
  const checkpointValue: Checkpoint = {
    base64: "safety",
    initialHash: baseline.value.hash,
    initialObjectNames: [...commands.keys()].sort(),
    initialObjects: registry.list(),
  };
  const captureCheckpoint = vi.fn(async () => ({
    ok: true as const,
    value: {
      checkpoint: checkpointValue,
      snapshot: baseline.value,
      listenerCount: 4,
    },
  }));
  const restoreExact = vi.fn(async () => {
    for (const name of [...commands.keys()]) {
      if (name.startsWith(HINT_OBJECT_PREFIX)) commands.delete(name);
    }
    registry.replace(checkpointValue.initialObjects);
    return {
      ok: true as const,
      value: {
        epoch: 2,
        recovered: false,
        snapshot: baseline.value,
        listenerCount: 4,
      },
    };
  });
  const checkpoint = {
    captureCheckpoint,
    restoreExact,
  } as unknown as CheckpointService;
  const highlights = new HighlightManager(adapter, registry);
  const confirmations = new HintConfirmationLedger(
    () => "confirmation_token_0001",
    () => 1_000,
  );
  const orchestrator = new HintOrchestrator(
    adapter,
    registry,
    snapshots,
    checkpoint,
    highlights,
    confirmations,
  );
  return {
    api,
    registry,
    commands,
    colors,
    snapshots,
    checkpoint,
    captureCheckpoint,
    restoreExact,
    confirmations,
    orchestrator,
    revision: baseline.value.revision,
  };
}

describe("T4-C07 GeoGebra hint orchestrator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers L1 and L2 without any GeoGebra mutation", async () => {
    const test = harness();
    const before = [...test.commands.entries()];
    await expect(
      test.orchestrator.deliver(authorization(1), { revision: test.revision }),
    ).resolves.toMatchObject({ status: "delivered", level: 1, helpers: [] });
    await expect(
      test.orchestrator.deliver(authorization(2), { revision: test.revision }),
    ).resolves.toMatchObject({ status: "delivered", level: 2, helpers: [] });
    expect([...test.commands.entries()]).toEqual(before);
    expect(test.api.setColor).not.toHaveBeenCalled();
  });

  it("temporarily highlights A/B/AB, owns the L3 midpoint, then restores exactly", async () => {
    const test = harness();
    const studentBefore = test.commands.get("studentLine");
    const pending = test.orchestrator.deliver(authorization(3), {
      revision: test.revision,
      ttlMs: 500,
    });
    const helper = test.registry
      .list()
      .find(({ name }) => name.startsWith(HINT_OBJECT_PREFIX));
    expect(helper).toMatchObject({ owner: "hint", kind: "point" });
    expect(test.colors.get("A")).toBe("#f59e0b");
    expect(test.colors.get("AB")).toBe("#f59e0b");
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toMatchObject({
      status: "delivered",
      level: 3,
      restored: true,
      checkpointFallback: false,
    });
    expect(test.colors.get("A")).toBe("#112233");
    expect(test.colors.get("AB")).toBe("#445566");
    expect(test.registry.list().some(({ owner }) => owner === "hint")).toBe(false);
    expect(test.commands.get("studentLine")).toBe(studentBefore);
    expect(test.captureCheckpoint).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "new_action"] as const)(
    "restores L3 in finally when %s",
    async (reason) => {
      const test = harness();
      const pending = test.orchestrator.deliver(authorization(3), {
        revision: test.revision,
        ttlMs: 1_000,
      });
      if (reason === "new_action") {
        test.commands.set("studentPoint", "(1,2)");
        test.registry.register("studentPoint", "student", "point");
        test.orchestrator.notifyStudentAction();
      } else {
        test.orchestrator.cancelActive();
      }
      await expect(pending).resolves.toMatchObject({
        status: "cancelled",
        reason,
        restored: true,
      });
      expect(test.colors.get("A")).toBe("#112233");
      expect(test.registry.list().some(({ owner }) => owner === "hint")).toBe(false);
      if (reason === "new_action") {
        expect(test.commands.get("studentPoint")).toBe("(1,2)");
      }
    },
  );

  it("restores the L3 color when GeoGebra rejects its helper command", async () => {
    const test = harness({ rejectHelper: true });
    await expect(
      test.orchestrator.deliver(authorization(3), {
        revision: test.revision,
        ttlMs: 500,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      reason: "effect_failed",
      restored: true,
    });
    expect(test.colors.get("A")).toBe("#112233");
    expect(test.colors.get("AB")).toBe("#445566");
    expect(test.registry.list().some(({ owner }) => owner === "hint")).toBe(false);
  });

  it("refuses L4 without a directive/revision confirmation and mutates nothing", async () => {
    const test = harness();
    const before = [...test.commands.entries()];
    await expect(
      test.orchestrator.deliver(authorization(4), { revision: test.revision }),
    ).resolves.toEqual({ status: "rejected", reason: "confirmation_required" });
    expect([...test.commands.entries()]).toEqual(before);
    expect(test.captureCheckpoint).not.toHaveBeenCalled();
    expect(test.api.setColor).not.toHaveBeenCalled();
  });

  it("creates only reserved owner:hint L4 helpers and removes them normally", async () => {
    const test = harness();
    const auth = authorization(4);
    const challenge = test.confirmations.issue(auth, test.revision);
    const pending = test.orchestrator.deliver(auth, {
      revision: test.revision,
      confirmationToken: challenge!.token,
      ttlMs: 500,
    });
    await vi.waitFor(() => {
      expect(test.registry.list().filter(({ owner }) => owner === "hint")).toHaveLength(2);
    });
    expect(
      test.registry
        .list()
        .filter(({ owner }) => owner === "hint")
        .every(({ name }) => name.startsWith(HINT_OBJECT_PREFIX)),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toMatchObject({
      status: "delivered",
      level: 4,
      restored: true,
      checkpointFallback: false,
    });
    expect(test.captureCheckpoint).toHaveBeenCalledTimes(1);
    expect(test.restoreExact).not.toHaveBeenCalled();
    expect(test.registry.list().some(({ owner }) => owner === "hint")).toBe(false);
    expect(test.commands.has("studentLine")).toBe(true);
  });

  it("uses the safety checkpoint only when normal L4 cleanup fails", async () => {
    const test = harness({ failHelperDelete: true });
    const auth = authorization(4);
    const challenge = test.confirmations.issue(auth, test.revision);
    const pending = test.orchestrator.deliver(auth, {
      revision: test.revision,
      confirmationToken: challenge!.token,
      ttlMs: 500,
    });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toMatchObject({
      status: "delivered",
      level: 4,
      restored: true,
      checkpointFallback: true,
    });
    expect(test.restoreExact).toHaveBeenCalledTimes(1);
    expect(test.commands.has("studentLine")).toBe(true);
    expect(test.registry.list().some(({ owner }) => owner === "hint")).toBe(false);
  });
});

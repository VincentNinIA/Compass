import { describe, expect, it, vi } from "vitest";

import {
  OPERATION_BOUNDARIES,
  OPERATION_KINDS,
  OPERATION_PRIORITY,
  OperationArbiter,
  type OperationKind,
} from "./arbiter";

describe("OperationArbiter", () => {
  it.each(permutations([...OPERATION_KINDS]))(
    "applies reset > speech > action > tool for permutation %s",
    (...order) => {
      const arbiter = new OperationArbiter();
      const leases = order.map((kind, index) =>
        arbiter.begin({ kind, epoch: 7, revision: index }),
      );

      const pending = arbiter.snapshot().pending;
      expect(pending).toHaveLength(1);
      expect(pending[0].kind).toBe("reset");
      expect(pending[0].priority).toBe(OPERATION_PRIORITY.reset);
      for (const lease of leases.filter(({ token }) => token.kind !== "reset")) {
        expect(lease.token.abort.aborted).toBe(true);
      }
      arbiter.close();
    },
  );

  it("preempts every lower operation and rejects late lower arrivals", () => {
    const arbiter = new OperationArbiter();
    const tool = arbiter.begin({ kind: "tool", epoch: 1, revision: 1 });
    const action = arbiter.begin({ kind: "student_action", epoch: 1, revision: 2 });
    const speech = arbiter.begin({ kind: "student_speech", epoch: 1, revision: 2 });
    const lateTool = arbiter.begin({ kind: "tool", epoch: 1, revision: 2 });

    expect(tool.token.abort.aborted).toBe(true);
    expect(action.token.abort.aborted).toBe(true);
    expect(speech.accepted).toBe(true);
    expect(lateTool.accepted).toBe(false);
    expect(lateTool.token.abort.aborted).toBe(true);
    expect(arbiter.snapshot().pending.map(({ kind }) => kind)).toEqual([
      "student_speech",
    ]);
    speech.finish();
    expect(arbiter.hasPending()).toBe(false);
  });

  it("revalidates epoch and revision at all four effect boundaries", () => {
    const arbiter = new OperationArbiter();
    const committed: string[] = [];

    for (const boundary of OPERATION_BOUNDARIES) {
      const lease = arbiter.begin({
        kind: "student_action",
        epoch: 4,
        revision: 9,
      });
      lease.commit(boundary, { epoch: 4, revision: 9 }, () => {
        committed.push(boundary);
      });
      lease.finish();
    }

    const stale = arbiter.begin({
      kind: "student_action",
      epoch: 4,
      revision: 9,
    });
    expect(
      stale.commit("ui_commit", { epoch: 5, revision: 9 }, () => {
        committed.push("stale");
      }),
    ).toBeUndefined();
    expect(stale.token.abort.aborted).toBe(true);
    expect(committed).toEqual([...OPERATION_BOUNDARIES]);
    expect(arbiter.snapshot().trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "quarantined",
          boundary: "ui_commit",
          reason: "authority_changed",
        }),
      ]),
    );
  });

  it("quarantines a non-cooperative late result and clears pending by watchdog", async () => {
    vi.useFakeTimers();
    try {
      const arbiter = new OperationArbiter({ watchdogMs: 40 });
      const lease = arbiter.begin({ kind: "tool", epoch: 2, revision: 3 });
      const idle = arbiter.waitForIdle(60);

      await vi.advanceTimersByTimeAsync(41);

      expect(await idle).toBe(true);
      expect(lease.token.abort.aborted).toBe(true);
      expect(arbiter.hasPending()).toBe(false);
      expect(
        lease.commit("tool_publish", undefined, () => "late-output"),
      ).toBeUndefined();
      expect(arbiter.snapshot().trace.at(-1)).toMatchObject({
        event: "quarantined",
        reason: "watchdog_timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the same winner under deterministic variable delays", async () => {
    vi.useFakeTimers();
    try {
      const arbiter = new OperationArbiter({ watchdogMs: 1_000 });
      const starts: Array<{ delay: number; kind: OperationKind }> = [
        { delay: 19, kind: "tool" },
        { delay: 7, kind: "student_action" },
        { delay: 13, kind: "student_speech" },
        { delay: 23, kind: "reset" },
      ];
      for (const { delay, kind } of starts) {
        setTimeout(() => {
          arbiter.begin({ kind, epoch: 8, revision: delay });
        }, delay);
      }
      await vi.advanceTimersByTimeAsync(24);
      expect(arbiter.snapshot().pending.map(({ kind }) => kind)).toEqual([
        "reset",
      ]);
      arbiter.close();
      expect(arbiter.hasPending()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report idle in the middle of an atomic preemption", async () => {
    const arbiter = new OperationArbiter();
    arbiter.begin({ kind: "tool", epoch: 1, revision: 1 });
    const idle = arbiter.waitForIdle(20);
    const action = arbiter.begin({
      kind: "student_action",
      epoch: 1,
      revision: 2,
    });

    expect(await idle).toBe(false);
    expect(arbiter.snapshot().pending.map(({ kind }) => kind)).toEqual([
      "student_action",
    ]);
    action.finish();
  });
});

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(
      (rest) => [value, ...rest],
    ),
  );
}

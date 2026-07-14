import { describe, expect, it } from "vitest";

import { deriveExercisePlanV1 } from "@/lib/exercise/exercise-contracts";
import { decideIntervention } from "./policy";
import {
  createInitialPedagogyState,
  pedagogyReducer,
  type PedagogyState,
} from "./state";
import {
  HINT_LEVEL_MATRIX,
  HintConfirmationLedger,
  createHintAuthorization,
  nextUsefulHelpLevel,
} from "./hint-assistance";

const PLAN = deriveExercisePlanV1({
  schemaVersion: "exercise_extraction.v1",
  outcome: "ready",
  language: "en",
  instruction: "Construct the perpendicular bisector of AB.",
  pointLabels: ["A", "B"],
  segmentEndpoints: ["A", "B"],
  requestedConstruction: "perpendicular_bisector",
  learningObjective: "perpendicular_bisector_equidistance",
  ambiguityCode: null,
  clarificationQuestion: null,
  unsupportedReason: null,
});

function stateAt(level: 0 | 1 | 2 | 3 | 4): PedagogyState {
  return {
    ...createInitialPedagogyState(PLAN, {
      epoch: 1,
      revision: 7,
      snapshotHash: "hash-r7",
    }),
    helpLevel: level,
  };
}

function anchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

describe("T4-C07 hint authorization", () => {
  it("defines the closed L1-L4 matrix", () => {
    expect(HINT_LEVEL_MATRIX).toEqual({
      1: {
        level: 1,
        allowedTools: [],
        requiresConfirmation: false,
        cleanupPolicy: "none",
      },
      2: {
        level: 2,
        allowedTools: [],
        requiresConfirmation: false,
        cleanupPolicy: "none",
      },
      3: {
        level: 3,
        allowedTools: ["highlight_objects"],
        requiresConfirmation: false,
        cleanupPolicy: "restore_visual_hint",
      },
      4: {
        level: 4,
        allowedTools: [],
        requiresConfirmation: true,
        cleanupPolicy: "remove_helpers_or_restore_checkpoint",
      },
    });
    expect(Object.isFrozen(HINT_LEVEL_MATRIX[3].allowedTools)).toBe(true);
  });

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 4],
  ] as const)("selects the lowest useful level after L%s", (current, next) => {
    expect(nextUsefulHelpLevel(current)).toBe(next);
  });

  it("hard-caps a proactive authorization at L1 with no tools", () => {
    expect(
      createHintAuthorization(stateAt(3), {
        directiveId: "proactive-1",
        kind: "proactive",
        helpLevel: 4,
        baseRevision: 7,
      }),
    ).toEqual({
      directiveId: "proactive-1",
      level: 1,
      source: "proactive",
      allowedTools: [],
      requiresConfirmation: false,
      cleanupPolicy: "none",
    });
  });

  it("rejects an explicit level that skips the lowest useful level", () => {
    expect(
      createHintAuthorization(stateAt(1), {
        directiveId: "explicit-skip",
        kind: "explicit",
        helpLevel: 3,
        baseRevision: 7,
      }),
    ).toBeNull();
    expect(
      createHintAuthorization(stateAt(2), {
        directiveId: "explicit-l3",
        kind: "explicit",
        helpLevel: 3,
        baseRevision: 7,
      }),
    ).toMatchObject({
      level: 3,
      allowedTools: ["highlight_objects"],
      requiresConfirmation: false,
    });
  });

  it("replays successive explicit requests as L1, L2, L3, then confirmed L4", () => {
    let state = stateAt(0);
    const expected = [1, 2, 3, 4] as const;
    for (const [index, level] of expected.entries()) {
      const requestId = `help-${index + 1}`;
      state = pedagogyReducer(state, {
        type: "explicit_help_requested",
        requestId,
        ...anchor(state),
      });
      const decision = decideIntervention(state, {
        type: "explicit_help",
        requestId,
      });
      expect(decision).toMatchObject({
        type: "speak",
        directiveDraft: {
          kind: "explicit",
          helpLevel: level,
          allowedTools: HINT_LEVEL_MATRIX[level].allowedTools,
        },
      });
      state = pedagogyReducer(state, {
        type: "assistance_delivered",
        directiveId: `directive-${index + 1}`,
        level,
        source: "explicit",
        ...anchor(state),
      });
      expect(state.helpLevel).toBe(level);
    }
  });

  it("does not advance after a cancelled or skipped delivery", () => {
    const state = stateAt(1);
    const rejected = pedagogyReducer(state, {
      type: "assistance_delivered",
      directiveId: "directive-skip",
      level: 3,
      source: "explicit",
      ...anchor(state),
    });
    expect(rejected.helpLevel).toBe(1);
    expect(rejected.rejectedTransitions.at(-1)?.reason).toBe("invalid_payload");
  });

  it("binds an L4 confirmation token to one directive and revision", () => {
    let now = 1_000;
    const ledger = new HintConfirmationLedger(
      () => "confirm_token_0001",
      () => now,
      500,
    );
    const authorization = createHintAuthorization(stateAt(3), {
      directiveId: "explicit-l4",
      kind: "explicit",
      helpLevel: 4,
      baseRevision: 7,
    });
    if (!authorization) throw new Error("authorization unavailable");
    const challenge = ledger.issue(authorization, 7);
    expect(challenge).toMatchObject({
      directiveId: "explicit-l4",
      revision: 7,
      expiresAt: 1_500,
    });
    expect(ledger.consume(challenge!.token, "other", 7)).toBe(false);
    expect(ledger.consume(challenge!.token, "explicit-l4", 8)).toBe(false);
    expect(ledger.consume(challenge!.token, "explicit-l4", 7)).toBe(true);
    expect(ledger.consume(challenge!.token, "explicit-l4", 7)).toBe(false);

    const expired = new HintConfirmationLedger(
      () => "confirm_token_0002",
      () => now,
      500,
    );
    const expiring = expired.issue(authorization, 7);
    now = 1_501;
    expect(expired.consume(expiring!.token, "explicit-l4", 7)).toBe(false);
  });
});

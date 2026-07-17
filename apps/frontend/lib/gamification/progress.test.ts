import { describe, expect, it } from "vitest";

import {
  awardMission,
  completedMissionIndexes,
  exerciseXp,
  sessionXp,
  type GamificationLedger,
} from "./progress";

describe("gamification progress ledger", () => {
  it("credits a completed mission once and upgrades it to verified", () => {
    const empty: GamificationLedger = [];
    const completed = awardMission(empty, "exercise-1", 0, "completed");
    const replay = awardMission(completed, "exercise-1", 0, "completed");
    const verified = awardMission(replay, "exercise-1", 0, "verified");

    expect(exerciseXp(completed, "exercise-1")).toBe(10);
    expect(replay).toBe(completed);
    expect(exerciseXp(verified, "exercise-1")).toBe(20);
    expect(awardMission(verified, "exercise-1", 0, "completed")).toBe(verified);
  });

  it("accumulates several exercises while keeping their scores separate", () => {
    let ledger: GamificationLedger = [];
    ledger = awardMission(ledger, "history", 0, "completed");
    ledger = awardMission(ledger, "history", 1, "completed");
    ledger = awardMission(ledger, "geometry", 0, "verified");

    expect(exerciseXp(ledger, "history")).toBe(20);
    expect(exerciseXp(ledger, "geometry")).toBe(20);
    expect(sessionXp(ledger)).toBe(40);
    expect([...completedMissionIndexes(ledger, "history")]).toEqual([0, 1]);
  });

  it("rejects invalid award identities without changing the ledger", () => {
    const ledger: GamificationLedger = [];

    expect(awardMission(ledger, "", 0, "completed")).toBe(ledger);
    expect(awardMission(ledger, "exercise", -1, "verified")).toBe(ledger);
    expect(awardMission(ledger, "exercise", 0.5, "completed")).toBe(ledger);
  });
});

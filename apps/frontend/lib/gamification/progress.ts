export const COMPLETED_MISSION_XP = 10 as const;
export const VERIFIED_MISSION_XP = 20 as const;

export type MissionAwardTier = "completed" | "verified";

export type MissionAward = {
  exerciseId: string;
  taskIndex: number;
  tier: MissionAwardTier;
  points: typeof COMPLETED_MISSION_XP | typeof VERIFIED_MISSION_XP;
};

export type GamificationLedger = readonly MissionAward[];

export function awardMission(
  ledger: GamificationLedger,
  exerciseId: string,
  taskIndex: number,
  tier: MissionAwardTier,
): GamificationLedger {
  if (!validExerciseId(exerciseId) || !Number.isInteger(taskIndex) || taskIndex < 0) {
    return ledger;
  }
  const existingIndex = ledger.findIndex(
    (award) =>
      award.exerciseId === exerciseId && award.taskIndex === taskIndex,
  );
  const existing = ledger[existingIndex];
  if (existing?.tier === "verified" || existing?.tier === tier) return ledger;

  const nextAward: MissionAward = Object.freeze({
    exerciseId,
    taskIndex,
    tier,
    points:
      tier === "verified" ? VERIFIED_MISSION_XP : COMPLETED_MISSION_XP,
  });
  if (existingIndex < 0) return Object.freeze([...ledger, nextAward]);
  const next = [...ledger];
  next[existingIndex] = nextAward;
  return Object.freeze(next);
}

export function exerciseMissionAwards(
  ledger: GamificationLedger,
  exerciseId: string | undefined,
): readonly MissionAward[] {
  if (!exerciseId) return [];
  return ledger.filter((award) => award.exerciseId === exerciseId);
}

export function completedMissionIndexes(
  ledger: GamificationLedger,
  exerciseId: string | undefined,
): ReadonlySet<number> {
  return new Set(
    exerciseMissionAwards(ledger, exerciseId).map((award) => award.taskIndex),
  );
}

export function exerciseXp(
  ledger: GamificationLedger,
  exerciseId: string | undefined,
): number {
  return exerciseMissionAwards(ledger, exerciseId).reduce(
    (total, award) => total + award.points,
    0,
  );
}

export function sessionXp(ledger: GamificationLedger): number {
  return ledger.reduce((total, award) => total + award.points, 0);
}

function validExerciseId(value: string): boolean {
  return value.length > 0 && value.length <= 128;
}

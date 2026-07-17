import { describe, expect, it } from "vitest";

import {
  decideGeometryLearningInterventionV1,
  type GeometryLearningFloorV1,
} from "./learning-policy";
import type { GeometrySessionStateV1 } from "./session";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

const activity = VARIGNON_ACTIVITY_FR_V1;
const freeFloor: GeometryLearningFloorV1 = {
  learnerDragging: false,
  learnerSpeaking: false,
  tutorSpeaking: false,
  interventionPending: false,
};

describe("geometry learning policy", () => {
  it("keeps the first block silent and emits one L1 on the repeated block", () => {
    const first = state({ repeatedBlockCount: 1 });
    expect(
      decideGeometryLearningInterventionV1(
        activity,
        first,
        { type: "attempt", missionId: "V3", actionId: "attempt_1" },
        freeFloor,
      ),
    ).toEqual({ type: "SILENT", reason: "first_block" });

    const repeated = state({ repeatedBlockCount: 2, lastActionId: "attempt_2" });
    const decision = decideGeometryLearningInterventionV1(
      activity,
      repeated,
      { type: "attempt", missionId: "V3", actionId: "attempt_2" },
      freeFloor,
    );
    expect(decision).toMatchObject({
      type: "SPEAK",
      reason: "repeated_block",
      directive: {
        source: "proactive",
        level: 1,
        requiresConsent: false,
      },
    });

    const alreadyHelped = state({
      repeatedBlockCount: 3,
      lastActionId: "attempt_3",
      proactiveSignatures: ["learner_capture_V3"],
    });
    expect(
      decideGeometryLearningInterventionV1(
        activity,
        alreadyHelped,
        { type: "attempt", missionId: "V3", actionId: "attempt_3" },
        freeFloor,
      ),
    ).toEqual({ type: "SILENT", reason: "already_helped" });
  });

  it("escalates explicit help by one delivered level and never mutates at L1/L2", () => {
    const level1 = decideGeometryLearningInterventionV1(
      activity,
      state({ processedHelpRequestIds: ["help_1"] }),
      { type: "explicit_help", missionId: "V3", requestId: "help_1" },
      freeFloor,
    );
    expect(level1).toMatchObject({
      type: "SPEAK",
      directive: { level: 1 },
    });
    expect(level1).not.toHaveProperty("directive.action");

    const level2 = decideGeometryLearningInterventionV1(
      activity,
      state({
        processedHelpRequestIds: ["help_2"],
        deliveredLevels: [1],
      }),
      { type: "explicit_help", missionId: "V3", requestId: "help_2" },
      freeFloor,
    );
    expect(level2).toMatchObject({
      type: "SPEAK",
      directive: { level: 2 },
    });
    expect(level2).not.toHaveProperty("directive.action");
  });

  it("queues the same bounded directive while the learner owns the floor", () => {
    const decision = decideGeometryLearningInterventionV1(
      activity,
      state({ repeatedBlockCount: 2, lastActionId: "attempt_2" }),
      { type: "attempt", missionId: "V3", actionId: "attempt_2" },
      { ...freeFloor, learnerSpeaking: true },
    );
    expect(decision).toMatchObject({
      type: "QUEUE",
      reason: "floor_busy",
      directive: { level: 1, source: "proactive" },
    });
  });

  it("offers L4 only for a declared demonstration mission after prior levels", () => {
    const decision = decideGeometryLearningInterventionV1(
      activity,
      state(
        {
          missionId: "V8",
          processedHelpRequestIds: ["help_4"],
          deliveredLevels: [1, 2, 3],
          lastMissingSignature: "justification_step_demo_v8_7",
        },
        "V8",
      ),
      { type: "explicit_help", missionId: "V8", requestId: "help_4" },
      freeFloor,
    );
    expect(decision).toMatchObject({
      type: "SPEAK",
      directive: {
        level: 4,
        action: "demonstrate_geometry_step",
        requiresConsent: true,
      },
    });
  });
});

function state(
  attemptOverrides: Partial<
    GeometrySessionStateV1["attempts"][string]
  > = {},
  missionId = "V3",
): GeometrySessionStateV1 {
  const lastActionId = attemptOverrides.lastActionId ?? "attempt_1";
  return {
    activityId: activity.id,
    epoch: 1,
    revision: 2,
    phase: missionId === "V8" ? "justifying" : "exploring",
    captures: [],
    missions: activity.missions.map((mission) => ({
      missionId: mission.id,
      order: mission.order,
      status:
        mission.id === missionId
          ? "active"
          : mission.order < Number(missionId.slice(1))
            ? "verified"
            : "locked",
      evidenceIds: [],
      missingEvidenceIds:
        mission.id === missionId
          ? [attemptOverrides.lastMissingSignature ?? "learner_capture_V3"]
          : [],
    })),
    activeMissionId: missionId,
    reflections: {
      conjectureCompleted: missionId === "V8",
      transferCompleted: false,
      completedJustificationStepIds: [],
    },
    attempts: {
      [missionId]: {
        missionId,
        count: 1,
        repeatedBlockCount: 1,
        explicitHelpRequestCount: 0,
        lastActionId,
        lastMissingSignature:
          attemptOverrides.lastMissingSignature ?? "learner_capture_V3",
        processedActionIds: [lastActionId],
        processedHelpRequestIds: [],
        deliveredLevels: [],
        proactiveSignatures: [],
        ...attemptOverrides,
      },
    },
    processedReflectionIds: [],
    demonstrationsViewed: [],
    assistance: { highestLevelUsed: 0, deliveredDirectiveIds: [] },
    xpLedger: {},
    rejectionCount: 0,
  };
}

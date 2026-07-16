import { describe, expect, it } from "vitest";

import {
  LEARNING_SESSION_REPORT_SCHEMA_VERSION,
  parseLearningSessionReportV1,
} from "./session-report";

const VALID_REPORT = {
  schemaVersion: LEARNING_SESSION_REPORT_SCHEMA_VERSION,
  exerciseId: "teacher_fraction-01",
  title: "Compare fractions",
  subject: "mathematics",
  totalMissions: 3,
  completedMissions: 2,
  verifiedMissions: 1,
  reflectedMissions: 1,
  exerciseXp: 30,
  transferCompleted: false,
  updatedAt: 123,
} as const;

describe("learning session report", () => {
  it("keeps only anonymous factual session fields", () => {
    const parsed = parseLearningSessionReportV1(VALID_REPORT);
    expect(parsed).toEqual(VALID_REPORT);
    expect(Object.keys(parsed)).not.toContain("learnerName");
    expect(Object.keys(parsed)).not.toContain("transferAnswer");
  });

  it("rejects impossible progress counts and free-form additions", () => {
    expect(() =>
      parseLearningSessionReportV1({
        ...VALID_REPORT,
        completedMissions: 4,
      }),
    ).toThrow();
    expect(() =>
      parseLearningSessionReportV1({
        ...VALID_REPORT,
        transferAnswer: "I would use it in another problem.",
      }),
    ).toThrow();
  });
});

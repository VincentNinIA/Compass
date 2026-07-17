import { describe, expect, it } from "vitest";

import { createDemoAccessHash } from "@/lib/demo-access/server";

import {
  CLASSROOM_LEARNER_COOKIE_NAME,
  CLASSROOM_TEACHER_COOKIE_NAME,
  classroomTeacherAuthSubjectHash,
  inspectLearnerSession,
  inspectTeacherSession,
  issueLearnerSession,
  issueTeacherSession,
  readClassroomPilotConfig,
  serializeClassroomCookie,
  verifyClassroomTeacherAccessCode,
} from "./pilot-session";

const now = 1_800_000_000_000;

describe("T25-C02 classroom sessions", () => {
  it("is opt-in and fails closed when a required secret is missing", async () => {
    expect(readClassroomPilotConfig({})).toEqual({ status: "disabled" });
    expect(
      readClassroomPilotConfig({ COMPASS_CLASSROOM_ENABLED: "1" }),
    ).toEqual({ status: "unavailable" });

    const accessHash = await createDemoAccessHash(
      "teacher-pilot-code",
      Buffer.alloc(16, 3),
    );
    const environment = {
      COMPASS_CLASSROOM_ENABLED: "1",
      COMPASS_PILOT_TEACHER_ACCESS_HASH: accessHash,
      COMPASS_PILOT_TEACHER_SUBJECT: "pilot-teacher-t25",
      COMPASS_CLASSROOM_SESSION_SECRET: "s".repeat(48),
    };
    const config = readClassroomPilotConfig(environment);
    expect(config.status).toBe("enabled");
    if (config.status !== "enabled") throw new Error("config_missing");
    await expect(
      verifyClassroomTeacherAccessCode("teacher-pilot-code", config),
    ).resolves.toBe(true);
    expect(classroomTeacherAuthSubjectHash("pilot-teacher-t25")).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(classroomTeacherAuthSubjectHash("pilot-teacher-t25")).not.toContain(
      "teacher-pilot-code",
    );
  });

  it("issues signed, expiring teacher and learner cookies without identity data", async () => {
    const accessHash = await createDemoAccessHash(
      "teacher-pilot-code",
      Buffer.alloc(16, 4),
    );
    const environment = {
      COMPASS_CLASSROOM_ENABLED: "1",
      COMPASS_PILOT_TEACHER_ACCESS_HASH: accessHash,
      COMPASS_PILOT_TEACHER_SUBJECT: "pilot-teacher-t25",
      COMPASS_CLASSROOM_SESSION_SECRET: "z".repeat(48),
    };
    const config = readClassroomPilotConfig(environment);
    if (config.status !== "enabled") throw new Error("config_missing");

    const teacher = issueTeacherSession(
      "teacher_12345678",
      config,
      now,
    );
    const teacherCookie = serializeClassroomCookie(
      CLASSROOM_TEACHER_COOKIE_NAME,
      teacher.token,
      { maxAge: 60, secure: true },
    );
    expect(teacherCookie).toContain("HttpOnly");
    expect(teacherCookie).toContain("SameSite=Strict");
    expect(teacherCookie).toContain("Secure");
    expect(
      inspectTeacherSession(teacherCookie, { environment, now }),
    ).toMatchObject({ status: "authorized", teacherId: "teacher_12345678" });
    const tamperedCookie = serializeClassroomCookie(
      CLASSROOM_TEACHER_COOKIE_NAME,
      `${teacher.token}x`,
      { maxAge: 60, secure: true },
    );
    expect(
      inspectTeacherSession(tamperedCookie, { environment, now }),
    ).toEqual({ status: "required" });
    expect(
      inspectTeacherSession(teacherCookie, {
        environment,
        now: teacher.expiresAt * 1_000,
      }),
    ).toEqual({ status: "required" });
    const rotatedAccessHash = await createDemoAccessHash(
      "teacher-pilot-code-rotated",
      Buffer.alloc(16, 5),
    );
    expect(
      inspectTeacherSession(teacherCookie, {
        environment: {
          ...environment,
          COMPASS_PILOT_TEACHER_ACCESS_HASH: rotatedAccessHash,
        },
        now,
      }),
    ).toEqual({ status: "required" });

    const learner = issueLearnerSession(
      "classroom_12345678",
      "learner_12345678",
      config,
      now,
    );
    const learnerCookie = serializeClassroomCookie(
      CLASSROOM_LEARNER_COOKIE_NAME,
      learner.token,
      { maxAge: 60, secure: false },
    );
    expect(
      inspectLearnerSession(learnerCookie, { environment, now }),
    ).toMatchObject({
      status: "authorized",
      classroomId: "classroom_12345678",
      learnerAliasId: "learner_12345678",
    });
    expect(learnerCookie).not.toMatch(/@|email|name=/i);
  });
});

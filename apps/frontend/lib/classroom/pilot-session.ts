import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  readCookie,
  shouldUseSecureCookie,
  verifyDemoAccessCode,
} from "@/lib/demo-access/server";

export const CLASSROOM_TEACHER_COOKIE_NAME = "compass_teacher_session";
export const CLASSROOM_LEARNER_COOKIE_NAME = "compass_learner_session";
export const CLASSROOM_TEACHER_TTL_SECONDS = 8 * 60 * 60;
export const CLASSROOM_LEARNER_TTL_SECONDS = 7 * 24 * 60 * 60;

const TOKEN_VERSION = "v1";
const SCRYPT_HASH = /^scrypt-v1\$[A-Za-z0-9_-]{22,}\$[A-Za-z0-9_-]{43}$/;
const ENTITY_ID = /^(teacher|classroom|learner)_[a-z0-9-]{8,80}$/;

type Environment = Readonly<Record<string, string | undefined>>;

export type ClassroomPilotConfig =
  | { status: "disabled" }
  | { status: "unavailable" }
  | {
      status: "enabled";
      teacherAccessHash: string;
      teacherSubject: string;
      sessionSecret: string;
    };

export type TeacherSessionInspection =
  | { status: "disabled" }
  | { status: "unavailable" }
  | { status: "required" }
  | { status: "authorized"; teacherId: string; expiresAt: number };

export type LearnerSessionInspection =
  | { status: "disabled" }
  | { status: "unavailable" }
  | { status: "required" }
  | {
      status: "authorized";
      classroomId: string;
      learnerAliasId: string;
      expiresAt: number;
    };

export function readClassroomPilotConfig(
  environment: Environment = process.env,
): ClassroomPilotConfig {
  if (environment.COMPASS_CLASSROOM_ENABLED !== "1") {
    return { status: "disabled" };
  }
  const teacherAccessHash =
    environment.COMPASS_PILOT_TEACHER_ACCESS_HASH?.trim() ?? "";
  const teacherSubject =
    environment.COMPASS_PILOT_TEACHER_SUBJECT?.trim() ?? "";
  const sessionSecret =
    environment.COMPASS_CLASSROOM_SESSION_SECRET?.trim() ?? "";
  if (
    !SCRYPT_HASH.test(teacherAccessHash) ||
    !/^[A-Za-z][A-Za-z0-9_-]{7,80}$/.test(teacherSubject) ||
    sessionSecret.length < 32
  ) {
    return { status: "unavailable" };
  }
  return {
    status: "enabled",
    teacherAccessHash,
    teacherSubject,
    sessionSecret,
  };
}

export function classroomTeacherAuthSubjectHash(technicalSubject: string): string {
  return `sha256:${createHash("sha256").update(technicalSubject).digest("hex")}`;
}

export function verifyClassroomTeacherAccessCode(
  code: string,
  config: Extract<ClassroomPilotConfig, { status: "enabled" }>,
): Promise<boolean> {
  return verifyDemoAccessCode(code, config.teacherAccessHash);
}

export function issueTeacherSession(
  teacherId: string,
  config: Extract<ClassroomPilotConfig, { status: "enabled" }>,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(now / 1_000) + CLASSROOM_TEACHER_TTL_SECONDS;
  const payload = [
    TOKEN_VERSION,
    expiresAt,
    teacherId,
    teacherAccessFingerprint(config.teacherAccessHash),
  ].join(".");
  return {
    token: `${payload}.${signature(payload, config.sessionSecret)}`,
    expiresAt,
  };
}

export function issueLearnerSession(
  classroomId: string,
  learnerAliasId: string,
  config: Extract<ClassroomPilotConfig, { status: "enabled" }>,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(now / 1_000) + CLASSROOM_LEARNER_TTL_SECONDS;
  const payload = [
    TOKEN_VERSION,
    expiresAt,
    classroomId,
    learnerAliasId,
  ].join(".");
  return {
    token: `${payload}.${signature(payload, config.sessionSecret)}`,
    expiresAt,
  };
}

export function inspectTeacherSession(
  cookieHeader: string | null | undefined,
  options: { environment?: Environment; now?: number } = {},
): TeacherSessionInspection {
  const config = readClassroomPilotConfig(options.environment);
  if (config.status !== "enabled") return config;
  const token = readCookie(cookieHeader, CLASSROOM_TEACHER_COOKIE_NAME);
  if (!token || token.length > 512) return { status: "required" };
  const [
    version,
    rawExpiresAt,
    teacherId,
    accessFingerprint,
    tokenSignature,
    extra,
  ] =
    token.split(".");
  const expiresAt = Number(rawExpiresAt);
  if (
    version !== TOKEN_VERSION ||
    extra !== undefined ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor((options.now ?? Date.now()) / 1_000) ||
    !ENTITY_ID.test(teacherId ?? "") ||
    accessFingerprint !== teacherAccessFingerprint(config.teacherAccessHash) ||
    !tokenSignature
  ) {
    return { status: "required" };
  }
  const payload = [version, rawExpiresAt, teacherId, accessFingerprint].join(".");
  if (!validSignature(payload, tokenSignature, config.sessionSecret)) {
    return { status: "required" };
  }
  return { status: "authorized", teacherId, expiresAt };
}

export function inspectLearnerSession(
  cookieHeader: string | null | undefined,
  options: { environment?: Environment; now?: number } = {},
): LearnerSessionInspection {
  const config = readClassroomPilotConfig(options.environment);
  if (config.status !== "enabled") return config;
  const token = readCookie(cookieHeader, CLASSROOM_LEARNER_COOKIE_NAME);
  if (!token || token.length > 512) return { status: "required" };
  const [
    version,
    rawExpiresAt,
    classroomId,
    learnerAliasId,
    tokenSignature,
    extra,
  ] = token.split(".");
  const expiresAt = Number(rawExpiresAt);
  if (
    version !== TOKEN_VERSION ||
    extra !== undefined ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor((options.now ?? Date.now()) / 1_000) ||
    !ENTITY_ID.test(classroomId ?? "") ||
    !ENTITY_ID.test(learnerAliasId ?? "") ||
    !tokenSignature
  ) {
    return { status: "required" };
  }
  const payload = [version, rawExpiresAt, classroomId, learnerAliasId].join(".");
  if (!validSignature(payload, tokenSignature, config.sessionSecret)) {
    return { status: "required" };
  }
  return {
    status: "authorized",
    classroomId,
    learnerAliasId,
    expiresAt,
  };
}

export function serializeClassroomCookie(
  name: typeof CLASSROOM_TEACHER_COOKIE_NAME | typeof CLASSROOM_LEARNER_COOKIE_NAME,
  token: string,
  options: { maxAge: number; secure: boolean },
): string {
  const attributes = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function classroomCookieIsSecure(
  requestUrl: string,
  environment: Environment = process.env,
): boolean {
  return shouldUseSecureCookie(requestUrl, environment);
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function teacherAccessFingerprint(accessHash: string): string {
  return createHash("sha256")
    .update(accessHash)
    .digest("base64url")
    .slice(0, 22);
}

function validSignature(
  payload: string,
  candidate: string,
  secret: string,
): boolean {
  const expected = signature(payload, secret);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

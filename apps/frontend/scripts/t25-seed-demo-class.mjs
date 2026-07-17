import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const classroomMaterialPath = resolve(root, ".env.classroom.local");
const outputPath = resolve(root, ".env.classroom-demo.local");
const productionUrl = new URL(
  process.env.COMPASS_PRODUCTION_URL ??
    "https://compass-geotutor-demo.vercel.app/",
);
const classLabel = "Test Varignon";
const learnerPseudonym = "Demo";

const material = parseEnv(await readFile(classroomMaterialPath, "utf8"));
const teacherCode = material.COMPASS_PILOT_TEACHER_ACCESS_CODE_LOCAL;
if (!teacherCode) throw new Error("teacher_access_code_missing");

const teacherSession = await request("/api/classroom/teacher/session", {
  method: "POST",
  body: { code: teacherCode, locale: "fr" },
});
const teacherCookie = readCookie(teacherSession.response, "compass_teacher_session");

let classesPayload = await request("/api/classroom/teacher/classes", {
  cookie: teacherCookie,
});
let classroom = classesPayload.payload.classrooms?.find(
  (candidate) => candidate.label === classLabel && candidate.status === "active",
);
let joinCode;

if (!classroom) {
  const created = await request("/api/classroom/teacher/classes", {
    method: "POST",
    cookie: teacherCookie,
    body: { label: classLabel },
  });
  classroom = created.payload.classroom;
  joinCode = created.payload.joinCode;
} else {
  const rotated = await request("/api/classroom/teacher/classes", {
    method: "PATCH",
    cookie: teacherCookie,
    body: { action: "rotate_code", classroomId: classroom.id },
  });
  joinCode = rotated.payload.joinCode;
}

if (!classroom?.id || !joinCode) throw new Error("demo_class_create_failed");

classesPayload = await request("/api/classroom/teacher/classes", {
  cookie: teacherCookie,
});
classroom = classesPayload.payload.classrooms?.find(
  (candidate) => candidate.id === classroom.id,
);
for (const alias of classroom?.learnerAliases ?? []) {
  if (alias.pseudonym.toLocaleLowerCase("fr") !== learnerPseudonym.toLocaleLowerCase("fr")) {
    continue;
  }
  await request("/api/classroom/teacher/classes", {
    method: "PATCH",
    cookie: teacherCookie,
    body: {
      action: "remove_learner",
      classroomId: classroom.id,
      learnerAliasId: alias.id,
    },
  });
}

const joined = await request("/api/classroom/join", {
  method: "POST",
  body: { code: joinCode, pseudonym: learnerPseudonym },
});
const learnerCookie = readCookie(joined.response, "compass_learner_session");
const learnerAliasId = joined.payload.membership?.learnerAlias?.id;
if (!learnerAliasId) throw new Error("demo_learner_join_failed");

const catalog = await request("/api/classroom/teacher/assignments?locale=fr", {
  cookie: teacherCookie,
});
const activity = catalog.payload.catalog?.[0];
if (!activity?.contractHash) throw new Error("varignon_catalog_missing");

const opensAt = Date.now() + 5_000;
const assigned = await request("/api/classroom/teacher/assignments", {
  method: "POST",
  cookie: teacherCookie,
  body: {
    action: "assign",
    catalogId: activity.catalogId,
    classroomId: classroom.id,
    target: { kind: "learner", learnerAliasId },
    locale: "fr",
    expectedContractHash: activity.contractHash,
    idempotencyKey: randomUUID(),
    opensAt,
    closesAt: opensAt + 7 * 24 * 60 * 60 * 1_000,
  },
});
const assignmentId = assigned.payload.assignment?.id;
if (!assignmentId) throw new Error("demo_assignment_create_failed");

await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_500));
const membership = await request("/api/classroom/join", {
  cookie: learnerCookie,
});
const assignment = membership.payload.membership?.assignments?.find(
  (candidate) => candidate.id === assignmentId,
);
if (
  !assignment ||
  assignment.contractHash !== activity.contractHash ||
  assignment.publication?.schemaVersion !== "teacher_exercise_publication.v2" ||
  assignment.publication?.content?.kind !== "geometry_investigation"
) {
  throw new Error("demo_assignment_not_openable");
}

const output = [
  "# Generated locally for the Compass classroom demonstration. Never commit.",
  `COMPASS_PILOT_TEACHER_ACCESS_CODE_LOCAL=${teacherCode}`,
  `COMPASS_TEST_CLASS_LABEL=${classLabel}`,
  `COMPASS_TEST_CLASS_CODE_LOCAL=${joinCode}`,
  `COMPASS_TEST_LEARNER_PSEUDONYM=${learnerPseudonym}`,
  `COMPASS_TEST_ASSIGNMENT_ID=${assignmentId}`,
  `COMPASS_TEST_CONTRACT_HASH=${activity.contractHash}`,
  `COMPASS_PRODUCTION_URL=${productionUrl.origin}`,
  "",
].join("\n");
await writeFile(outputPath, output, { encoding: "utf8", mode: 0o600 });
await chmod(outputPath, 0o600);

console.log(
  `Classroom demo seeded and verified. Local operator material: ${outputPath}`,
);

async function request(path, { method = "GET", cookie, body } = {}) {
  const response = await fetch(new URL(path, productionUrl), {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.code ?? `request_failed_${response.status}`);
  }
  return { response, payload };
}

function readCookie(response, name) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  if (!match) throw new Error(`${name}_missing`);
  return `${name}=${match[1]}`;
}

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

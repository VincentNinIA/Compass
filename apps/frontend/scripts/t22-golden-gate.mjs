import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const scriptPath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(frontendRoot, "../..");
const outputRoot = path.join(repositoryRoot, "output/playwright/T22-C08");
const FORBIDDEN_EVIDENCE =
  /base64|data:image|OPENAI_API_KEY|authorization|bearer\s|sk-(?:proj-)?|\bsdp\b|transcript|conjectureText|transferText|studentName|\bgrade\b/i;

const MANIFEST_KEYS = [
  "schemaVersion",
  "runIndex",
  "seriesId",
  "candidateId",
  "environmentId",
  "publicationId",
  "result",
  "durationMs",
  "steps",
  "restore",
  "resources",
  "quality",
  "artifact",
];

export function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...keys].sort().join("|")
  );
}

export function validateT22Manifest(manifest, expected) {
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) {
    return { ok: false, reason: "manifest_schema" };
  }
  if (
    manifest.schemaVersion !== "geotutor_geometry_golden_run.v1" ||
    manifest.runIndex !== expected.runIndex ||
    manifest.seriesId !== expected.seriesId ||
    manifest.candidateId !== expected.candidateId ||
    manifest.environmentId !== expected.environmentId ||
    !/^teacher_[a-z0-9-]{8,80}$/.test(manifest.publicationId ?? "") ||
    manifest.result !== "pass" ||
    !Number.isFinite(manifest.durationMs) ||
    manifest.durationMs <= 0
  ) {
    return { ok: false, reason: "manifest_identity_or_result" };
  }
  if (
    !hasExactKeys(manifest.steps, [
      "publication",
      "scaffoldObjects",
      "midpointObjects",
      "learnerObjects",
      "captures",
      "parallelFacts",
      "conjecture",
      "justificationSteps",
      "transfer",
      "missions",
      "xp",
    ]) ||
    manifest.steps.publication !== "exact_contract" ||
    manifest.steps.scaffoldObjects !== 8 ||
    manifest.steps.midpointObjects !== 4 ||
    manifest.steps.learnerObjects !== 8 ||
    JSON.stringify(manifest.steps.captures) !==
      JSON.stringify(["convex", "concave", "crossed"]) ||
    manifest.steps.parallelFacts !== 6 ||
    manifest.steps.conjecture !== "completed" ||
    manifest.steps.justificationSteps !== 7 ||
    manifest.steps.transfer !== "completed" ||
    manifest.steps.missions !== "9/9" ||
    manifest.steps.xp !== 160
  ) {
    return { ok: false, reason: "journey_incomplete" };
  }
  if (
    !hasExactKeys(manifest.restore, [
      "status",
      "targetHash",
      "restoredHash",
      "inventoryBefore",
      "inventoryAfter",
      "ownershipBefore",
      "ownershipAfter",
      "listenersBefore",
      "listenersAfter",
    ]) ||
    manifest.restore.status !== "exact" ||
    manifest.restore.targetHash !== manifest.restore.restoredHash ||
    JSON.stringify(manifest.restore.inventoryBefore) !==
      JSON.stringify(manifest.restore.inventoryAfter) ||
    JSON.stringify(manifest.restore.ownershipBefore) !==
      JSON.stringify(manifest.restore.ownershipAfter) ||
    manifest.restore.listenersBefore !== manifest.restore.listenersAfter
  ) {
    return { ok: false, reason: "restore_not_exact" };
  }
  if (
    !hasExactKeys(manifest.resources, [
      "captureCount",
      "evidenceBytes",
      "evidenceMaxBytes",
      "helpersRemaining",
      "cleanupClosed",
      "geometryGlobalsRemaining",
    ]) ||
    manifest.resources.captureCount !== 3 ||
    manifest.resources.evidenceBytes <= 0 ||
    manifest.resources.evidenceBytes > manifest.resources.evidenceMaxBytes ||
    manifest.resources.evidenceMaxBytes !== 12 * 1024 * 1024 ||
    manifest.resources.helpersRemaining !== 0 ||
    manifest.resources.cleanupClosed !== true ||
    manifest.resources.geometryGlobalsRemaining !== 0
  ) {
    return { ok: false, reason: "resources_not_closed" };
  }
  if (
    !hasExactKeys(manifest.quality, [
      "realApplet",
      "appletVersion",
      "geometryHarness",
      "toolRuntime",
      "teacherPreviewReady",
      "publicTeacherJourney",
      "toolbarCanvasGestures",
      "assistanceHighlightObserved",
      "learnerCancellationObserved",
      "consentedDemonstrationObserved",
      "replayControlsObserved",
      "replayStopRestored",
      "restoreInputBarrierObserved",
      "assistantDemoProvenanceObserved",
      "l4LearnerDragPreserved",
      "appletControlsAccessible",
      "axeViolations",
      "viewportOverflow",
      "consoleErrors",
      "reducedMotion",
    ]) ||
    manifest.quality.realApplet !== true ||
    !/^5\.4\.\d+\.\d+$/.test(manifest.quality.appletVersion ?? "") ||
    manifest.quality.geometryHarness !== "v2" ||
    manifest.quality.toolRuntime !== "investigation" ||
    manifest.quality.teacherPreviewReady !== true ||
    manifest.quality.publicTeacherJourney !== true ||
    manifest.quality.toolbarCanvasGestures !== true ||
    manifest.quality.assistanceHighlightObserved !== true ||
    manifest.quality.learnerCancellationObserved !== true ||
    manifest.quality.consentedDemonstrationObserved !== true ||
    manifest.quality.replayControlsObserved !== true ||
    manifest.quality.replayStopRestored !== true ||
    manifest.quality.restoreInputBarrierObserved !== true ||
    manifest.quality.assistantDemoProvenanceObserved !== true ||
    manifest.quality.l4LearnerDragPreserved !== true ||
    manifest.quality.appletControlsAccessible !== true ||
    manifest.quality.axeViolations !== 0 ||
    manifest.quality.viewportOverflow !== false ||
    manifest.quality.consoleErrors !== 0 ||
    manifest.quality.reducedMotion !== true ||
    typeof manifest.artifact !== "string" ||
    !/^T22-C08-run-[123]\.png$/.test(manifest.artifact)
  ) {
    return { ok: false, reason: "quality_gate_failed" };
  }
  if (FORBIDDEN_EVIDENCE.test(JSON.stringify(manifest))) {
    return { ok: false, reason: "sensitive_evidence" };
  }
  return { ok: true, reason: "complete" };
}

export async function fingerprintCandidate() {
  const buildIdPath = path.join(frontendRoot, ".next/BUILD_ID");
  let buildId;
  try {
    buildId = (await readFile(buildIdPath, "utf8")).trim();
  } catch {
    throw new Error("Build the frontend before running the T22 golden gate.");
  }
  const files = [];
  for (const relative of ["app", "components", "lib", "types"]) {
    await collectFiles(path.join(frontendRoot, relative), files);
  }
  for (const file of [
    path.join(frontendRoot, "package.json"),
    path.join(frontendRoot, "next.config.ts"),
    path.join(repositoryRoot, "pnpm-lock.yaml"),
  ]) {
    try {
      if ((await stat(file)).isFile()) files.push(file);
    } catch {
      // Optional config names are allowed; the source directories stay required.
    }
  }
  const sourceHash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    sourceHash.update(`${path.relative(repositoryRoot, file)}\n`);
    sourceHash.update(await readFile(file));
  }
  const sourceDigest = sourceHash.digest("hex");
  const artifactFiles = [
    path.join(frontendRoot, ".next/BUILD_ID"),
    path.join(frontendRoot, ".next/build-manifest.json"),
    path.join(frontendRoot, ".next/routes-manifest.json"),
    path.join(frontendRoot, ".next/required-server-files.json"),
  ];
  await collectFiles(path.join(frontendRoot, ".next/server"), artifactFiles);
  await collectFiles(path.join(frontendRoot, ".next/static"), artifactFiles);
  const artifactHash = createHash("sha256");
  artifactHash.update(`build:${buildId}\n`);
  for (const file of [...new Set(artifactFiles)].sort()) {
    artifactHash.update(`${path.relative(frontendRoot, file)}\n`);
    artifactHash.update(await readFile(file));
  }
  const artifactDigest = artifactHash.digest("hex");
  const id = `candidate_${createHash("sha256")
    .update(`${sourceDigest}:${artifactDigest}`)
    .digest("hex")
    .slice(0, 24)}`;
  return { id, buildId, sourceDigest, artifactDigest };
}

export async function fingerprintEnvironment() {
  const packageJson = JSON.parse(
    await readFile(path.join(frontendRoot, "package.json"), "utf8"),
  );
  const browserExecutable = chromium.executablePath();
  const browserProbe = spawnSync(browserExecutable, ["--version"], {
    encoding: "utf8",
  });
  if (browserProbe.status !== 0 || !browserProbe.stdout.trim()) {
    throw new Error("The actual Playwright Chromium version could not be read.");
  }
  const browserVersion = browserProbe.stdout.trim().slice(0, 120);
  const materialObject = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    next: packageJson.dependencies.next,
    react: packageJson.dependencies.react,
    playwright: packageJson.devDependencies["@playwright/test"],
    browser: browserVersion,
    locale: "en-US",
    timezone: "Europe/Paris",
  };
  const material = JSON.stringify(materialObject);
  return {
    id: `environment_${createHash("sha256")
      .update(material)
      .digest("hex")
      .slice(0, 24)}`,
    browserVersion,
  };
}

async function collectFiles(directory, target) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(resolved, target);
    else if (entry.isFile() && !entry.name.endsWith(".map")) target.push(resolved);
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runGate() {
  const sourceBeforeBuild = await fingerprintSources();
  const build = spawnSync("pnpm", ["build"], {
    cwd: frontendRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (build.status !== 0) {
    throw new Error("The T22 golden gate could not build the frontend artifact.");
  }
  const sourceAfterBuild = await fingerprintSources();
  if (sourceAfterBuild !== sourceBeforeBuild) {
    throw new Error("Executable sources changed while the T22 artifact was built.");
  }
  const candidate = await fingerprintCandidate();
  const environment = await fingerprintEnvironment();
  const candidateId = candidate.id;
  const environmentId = environment.id;
  const seriesId = `series_${createHash("sha256")
    .update(`${candidateId}:${environmentId}:${Date.now()}`)
    .digest("hex")
    .slice(0, 24)}`;

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await writeJson(path.join(outputRoot, "candidate.json"), {
    schemaVersion: "geotutor_geometry_candidate.v1",
    id: candidateId,
    buildId: candidate.buildId,
    sourceDigest: candidate.sourceDigest,
    artifactDigest: candidate.artifactDigest,
  });
  await writeJson(path.join(outputRoot, "environment.json"), {
    schemaVersion: "geotutor_geometry_environment.v1",
    id: environmentId,
    browserVersion: environment.browserVersion,
  });

  const runner = spawnSync(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.t22-golden.config.ts",
      "--grep",
      "@t22-golden",
    ],
    {
      cwd: frontendRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        T22_GOLDEN: "1",
        T22_GATE_SERIES_ID: seriesId,
        T22_GATE_CANDIDATE_ID: candidateId,
        T22_GATE_ENVIRONMENT_ID: environmentId,
      },
    },
  );

  const runs = [];
  for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
    const manifestPath = path.join(outputRoot, `run-${runIndex}.json`);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      manifest = undefined;
    }
    const validation = validateT22Manifest(manifest, {
      runIndex,
      seriesId,
      candidateId,
      environmentId,
    });
    const artifactExists = await stat(
      path.join(outputRoot, `T22-C08-run-${runIndex}.png`),
    )
      .then((entry) => entry.isFile())
      .catch(() => false);
    runs.push({ runIndex, validation: validation.reason, artifactExists });
  }
  const candidateAfter = await fingerprintCandidate();
  const environmentAfter = await fingerprintEnvironment();
  const identityStable =
    candidateAfter.id === candidateId && environmentAfter.id === environmentId;
  const passed =
    runner.status === 0 &&
    identityStable &&
    runs.every(
      ({ validation, artifactExists }) =>
        validation === "complete" && artifactExists,
    );
  const verdict = {
    schemaVersion: "geotutor_geometry_golden_gate.v1",
    seriesId,
    candidateId,
    environmentId,
    identityStable,
    retries: 0,
    consecutiveRuns: passed ? 3 : 0,
    result: passed ? "pass" : "fail",
    runs,
  };
  await writeJson(path.join(outputRoot, "verdict.json"), verdict);
  if (!passed) {
    throw new Error("T22 golden gate failed; inspect the closed verdict and manifests.");
  }
  process.stdout.write(
    `T22 golden gate 3/3 passed without retry on ${candidateId} / ${environmentId}.\n`,
  );
}

async function fingerprintSources() {
  const files = [];
  for (const relative of ["app", "components", "lib", "types"]) {
    await collectFiles(path.join(frontendRoot, relative), files);
  }
  for (const file of [
    path.join(frontendRoot, "package.json"),
    path.join(frontendRoot, "next.config.ts"),
    path.join(repositoryRoot, "pnpm-lock.yaml"),
  ]) {
    try {
      if ((await stat(file)).isFile()) files.push(file);
    } catch {
      // Optional config names do not participate when absent.
    }
  }
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    hash.update(`${path.relative(repositoryRoot, file)}\n`);
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

if (process.argv[1] === scriptPath) {
  runGate().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

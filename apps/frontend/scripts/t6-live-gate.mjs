import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  access,
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
import { spawnSync } from "node:child_process";

const modulePath = import.meta.url.startsWith("file:")
  ? fileURLToPath(import.meta.url)
  : "";
const frontendRoot = modulePath
  ? path.resolve(path.dirname(modulePath), "..")
  : path.resolve(process.cwd());
const repositoryRoot = path.resolve(frontendRoot, "../..");
const outputRoot = path.resolve(repositoryRoot, "output/playwright/T6-C07");
const fixturePath = path.resolve(
  frontendRoot,
  "test-fixtures/t3-exercise/clear-en.jpg",
);
const identityOnly = process.argv.includes("--identity");

const SOURCE_SCOPES = Object.freeze([
  "apps/frontend",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

export const REQUIRED_STEP_IDS = Object.freeze([
  "photo_extraction",
  "exercise_confirmation",
  "first_block_silent",
  "live_voice",
  "repeated_block_speaks",
  "verified_correction",
  "invariance_and_summary",
  "exact_reset",
  "transport_cleanup",
]);

const STATIC_GATES = Object.freeze([
  ["lint", ["--dir", "apps/frontend", "lint"]],
  ["typecheck", ["--dir", "apps/frontend", "typecheck"]],
  ["vitest", ["--dir", "apps/frontend", "test", "--run"]],
  ["build", ["--dir", "apps/frontend", "build"]],
  [
    "playwright_non_live",
    [
      "--dir",
      "apps/frontend",
      "exec",
      "playwright",
      "test",
      "--grep-invert",
      "@live",
    ],
  ],
]);

const FORBIDDEN_EVIDENCE =
  /OPENAI_API_KEY|Bearer\s+|\bsk-(?:proj-)?[A-Za-z0-9_-]+|data:image|\bv=0(?:\r?\n|%0A)|input_text|transcript|sdp|private[_ -]?key/i;

export const RUN_EVIDENCE_KEYS = Object.freeze({
  photo_extraction: [
    "exerciseResponseStatus",
    "extractionOutcome",
    "routeRequests",
    "secureContext",
  ],
  exercise_confirmation: ["appletVersion", "givensOnly", "inventory"],
  first_block_silent: ["decision", "progress", "proofCount", "responseCreates"],
  live_voice: [
    "capability",
    "dataChannel",
    "microphoneTracks",
    "model",
    "peer",
    "remoteAudioTracks",
  ],
  repeated_block_speaks: [
    "audioResponses",
    "conversationItems",
    "decision",
    "helpLevel",
    "proofCount",
    "responseCreates",
  ],
  verified_correction: ["progress", "proofCount", "responsesSettled", "revision"],
  invariance_and_summary: [
    "listenerCount",
    "oobAudioEvents",
    "oobConversation",
    "oobModality",
    "passingSamples",
    "samples",
    "sceneRestored",
    "summarySource",
  ],
  exact_reset: [
    "checkpointHashMatched",
    "evidenceCleared",
    "helpersRemaining",
    "inventory",
    "listenerCount",
    "restoration",
  ],
  transport_cleanup: [
    "attachedAudioTracks",
    "channel",
    "finalMode",
    "microphoneTrack",
    "peer",
  ],
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function hasExactKeys(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

export function qualificationIdentityStable(expected, candidate, environment) {
  return (
    candidate?.id === expected.candidateId &&
    environment?.id === expected.environmentId
  );
}

function readCommand(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
  return result.stdout.trim();
}

function runCommand(command, args, env = process.env) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    stdio: "inherit",
  });
  return {
    status: result.status ?? 1,
    durationMs: Date.now() - startedAt,
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

async function listCandidateFiles() {
  const listed = readCommand(
    "git",
    ["ls-files", "-co", "--exclude-standard", "--", ...SOURCE_SCOPES],
    repositoryRoot,
  );
  return [...new Set(listed.split("\n").filter(Boolean))].sort();
}

export async function computeCandidateIdentity() {
  const files = await listCandidateFiles();
  const digest = createHash("sha256");
  for (const relativePath of files) {
    digest.update(relativePath);
    digest.update("\0");
    digest.update(await readFile(path.resolve(repositoryRoot, relativePath)));
    digest.update("\0");
  }
  const head = readCommand("git", ["rev-parse", "HEAD"]);
  const sourceSha256 = digest.digest("hex");
  const facts = {
    head,
    sourceSha256,
    sourceFileCount: files.length,
    dirty:
      readCommand("git", ["status", "--porcelain=v1", "--", ...SOURCE_SCOPES])
        .length > 0,
  };
  return Object.freeze({
    id: `candidate_${sha256(stableJson(facts)).slice(0, 24)}`,
    ...facts,
  });
}

async function assertReadable(filePath, label) {
  if (!filePath) throw new Error(`${label} is not configured.`);
  await access(filePath);
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`${label} is not a readable non-empty file.`);
  }
}

async function browserVersion() {
  const browser = await chromium.launch({ headless: true });
  try {
    return browser.version();
  } finally {
    await browser.close();
  }
}

async function verifyCertificatePair(certificatePath, privateKeyPath) {
  const certificateCheck = spawnSync(
    "openssl",
    ["x509", "-checkend", "0", "-noout", "-in", certificatePath],
    { encoding: "utf8" },
  );
  if (certificateCheck.status !== 0) {
    throw new Error("The configured TLS certificate is expired or invalid.");
  }
  const certificatePublicKey = readCommand(
    "openssl",
    ["x509", "-in", certificatePath, "-pubkey", "-noout"],
  );
  const privatePublicKey = readCommand(
    "openssl",
    ["pkey", "-in", privateKeyPath, "-pubout"],
  );
  if (sha256(certificatePublicKey) !== sha256(privatePublicKey)) {
    throw new Error("The configured TLS certificate and private key do not match.");
  }
}

export async function computeEnvironmentIdentity() {
  const certificatePath = process.env.GEOTUTOR_TLS_CERT;
  const privateKeyPath = process.env.GEOTUTOR_TLS_KEY;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for the live gate.");
  }
  await assertReadable(certificatePath, "GEOTUTOR_TLS_CERT");
  await assertReadable(privateKeyPath, "GEOTUTOR_TLS_KEY");
  await assertReadable(fixturePath, "Golden exercise fixture");
  await verifyCertificatePair(certificatePath, privateKeyPath);

  const host = process.env.GEOTUTOR_HTTPS_HOST ?? "127.0.0.1";
  const port = process.env.GEOTUTOR_HTTPS_PORT ?? "3443";
  const facts = {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    node: process.version,
    pnpm: readCommand("pnpm", ["--version"]),
    playwright: readCommand(
      "pnpm",
      ["--dir", "apps/frontend", "exec", "playwright", "--version"],
    ),
    chromium: await browserVersion(),
    httpsOrigin: `https://${host}:${port}`,
    tls: "TLSv1.2+ self-signed local qualification certificate",
    certificateSha256: await hashFile(certificatePath),
    fixtureSha256: await hashFile(fixturePath),
    credentialConfigured: true,
    credentialScope: "single inherited runner process",
    microphone: "synthetic browser MediaStream audio track",
    geogebraVersion: "5.4.920.0",
    exerciseModel: "gpt-5.6-terra",
    realtimeModel: "gpt-realtime-2.1",
    serverRuntime: "Next.js production server over HTTPS",
  };
  const identityFacts = {
    ...facts,
    credentialFingerprint: sha256(apiKey),
  };
  return Object.freeze({
    id: `environment_${sha256(stableJson(identityFacts)).slice(0, 24)}`,
    ...facts,
  });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateRunManifest(manifest, expected, requireArtifacts = true) {
  if (!isRecord(manifest)) return { ok: false, reason: "manifest_missing" };
  if (
    !hasExactKeys(manifest, [
      "artifacts",
      "candidate",
      "completedAt",
      "environment",
      "evidence",
      "result",
      "runIndex",
      "seriesId",
      "startedAt",
      "steps",
      "version",
    ])
  ) {
    return { ok: false, reason: "manifest_schema" };
  }
  if (manifest.version !== "geotutor_live_run.v1") {
    return { ok: false, reason: "manifest_version" };
  }
  if (
    manifest.runIndex !== expected.runIndex ||
    manifest.seriesId !== expected.seriesId ||
    manifest.candidate?.id !== expected.candidateId ||
    manifest.environment?.id !== expected.environmentId
  ) {
    return { ok: false, reason: "identity_mismatch" };
  }
  if (manifest.result !== "pass") return { ok: false, reason: "run_failed" };
  if (!Array.isArray(manifest.steps)) {
    return { ok: false, reason: "steps_missing" };
  }
  if (
    manifest.steps.length !== REQUIRED_STEP_IDS.length ||
    manifest.steps.some(
      (step, index) =>
        !isRecord(step) ||
        step.id !== REQUIRED_STEP_IDS[index] ||
        step.status !== "pass" ||
        !hasExactKeys(step, [
          "durationMs",
          "evidence",
          "id",
          "startedAt",
          "status",
        ]) ||
        typeof step.startedAt !== "string" ||
        !Number.isFinite(Date.parse(step.startedAt)) ||
        !Number.isFinite(step.durationMs) ||
        step.durationMs < 0 ||
        !hasExactKeys(step.evidence, RUN_EVIDENCE_KEYS[step.id] ?? []),
    )
  ) {
    return { ok: false, reason: "step_evidence_incomplete" };
  }
  if (
    manifest.evidence?.geogebra !== "real_applet_5.4.920.0" ||
    manifest.evidence?.exerciseService !== "live_openai_responses" ||
    manifest.evidence?.realtimeService !== "live_openai_realtime" ||
    manifest.evidence?.scriptedLocal !== false
  ) {
    return { ok: false, reason: "live_evidence_incomplete" };
  }
  if (
    requireArtifacts &&
    (!Array.isArray(manifest.artifacts) ||
      !manifest.artifacts.some((item) => item.endsWith(".png")) ||
      !manifest.artifacts.some((item) => item.endsWith(".webm")))
  ) {
    return { ok: false, reason: "artifacts_missing" };
  }
  if (FORBIDDEN_EVIDENCE.test(JSON.stringify(manifest))) {
    return { ok: false, reason: "sensitive_evidence" };
  }
  return { ok: true, reason: "complete" };
}

export function validateEvidenceFileList(relativePaths) {
  const files = [...relativePaths].sort();
  if (files.length !== new Set(files).size) {
    return { ok: false, reason: "duplicate_artifact" };
  }
  const requiredJson = [
    "gate-verdict.json",
    "preflight.json",
    "run-1.json",
    "run-2.json",
    "run-3.json",
    "series-state.json",
  ];
  for (const required of requiredJson) {
    if (!files.includes(required)) {
      return { ok: false, reason: "evidence_file_missing" };
    }
  }
  for (const runIndex of [1, 2, 3]) {
    if (!files.includes(`T6-C07-run-${runIndex}-completed.png`)) {
      return { ok: false, reason: "evidence_file_missing" };
    }
    const videos = files.filter((file) =>
      new RegExp(`^playwright-run-${runIndex}/.+/video\\.webm$`).test(file),
    );
    if (videos.length !== 1) {
      return { ok: false, reason: "video_inventory" };
    }
  }
  const allowed = files.every(
    (file) =>
      requiredJson.includes(file) ||
      /^T6-C07-run-[1-3]-completed\.png$/.test(file) ||
      /^playwright-run-[1-3]\/.+\/video\.webm$/.test(file),
  );
  if (!allowed || files.length !== 12) {
    return { ok: false, reason: "unexpected_artifact" };
  }
  return { ok: true, reason: "complete" };
}

export function nextConsecutiveCount(current, manifestValidation, identityStable) {
  if (!identityStable || !manifestValidation.ok) return 0;
  return current + 1;
}

async function listRelativeFiles(directory, root = directory) {
  const paths = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return paths;
  }
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listRelativeFiles(absolutePath, root)));
    } else {
      paths.push(path.relative(root, absolutePath));
    }
  }
  return paths.sort();
}

async function collectArtifacts(runIndex) {
  const paths = [];
  const runDirectory = path.join(outputRoot, `playwright-run-${runIndex}`);
  await rm(path.join(runDirectory, ".last-run.json"), { force: true });
  const runFiles = await listRelativeFiles(runDirectory);
  if (
    runFiles.length !== 1 ||
    !/.+\/video\.webm$/.test(runFiles[0] ?? "")
  ) {
    throw new Error("The Playwright run emitted an unexpected artifact.");
  }
  const video = path.join(runDirectory, runFiles[0]);
  const videoMetadata = await stat(video);
  if (videoMetadata.size === 0) {
    throw new Error("The Playwright run video is empty.");
  }
  paths.push(path.relative(repositoryRoot, video));
  for (const suffix of ["completed", "failed"]) {
    const screenshot = path.join(
      outputRoot,
      `T6-C07-run-${runIndex}-${suffix}.png`,
    );
    try {
      const metadata = await stat(screenshot);
      if (metadata.size > 0) {
        paths.push(path.relative(repositoryRoot, screenshot));
      }
    } catch {
      // A completed run has no failure capture and vice versa.
    }
  }
  return [...new Set(paths)].sort();
}

function validateControlJson(relativePath, value, expected, gateResult = "pass") {
  if (!isRecord(value) || FORBIDDEN_EVIDENCE.test(JSON.stringify(value))) {
    return { ok: false, reason: "invalid_or_sensitive_json" };
  }
  if (relativePath === "preflight.json") {
    const valid =
      hasExactKeys(value, [
        "candidate",
        "candidateStable",
        "completedAt",
        "environment",
        "environmentStable",
        "gates",
        "result",
        "seriesId",
        "startedAt",
        "version",
      ]) &&
      value.version === "geotutor_live_preflight.v1" &&
      value.seriesId === expected.seriesId &&
      value.result === "pass" &&
      value.candidateStable === true &&
      value.environmentStable === true &&
      stableJson(value.candidate) === stableJson(expected.candidate) &&
      stableJson(value.environment) === stableJson(expected.environment) &&
      Array.isArray(value.gates) &&
      value.gates.length === STATIC_GATES.length &&
      value.gates.every(
        (gate, index) =>
          hasExactKeys(gate, ["durationMs", "name", "status"]) &&
          gate.name === STATIC_GATES[index][0] &&
          gate.status === 0 &&
          Number.isFinite(gate.durationMs),
      );
    return { ok: valid, reason: valid ? "complete" : "preflight_schema" };
  }
  if (relativePath === "series-state.json") {
    const valid =
      hasExactKeys(value, [
        "candidate",
        "consecutiveSuccesses",
        "environment",
        "manifests",
        "reason",
        "required",
        "result",
        "seriesId",
        "version",
      ]) &&
      value.version === "geotutor_live_series.v1" &&
      value.seriesId === expected.seriesId &&
      value.result === "pass" &&
      value.required === 3 &&
      value.consecutiveSuccesses === 3 &&
      stableJson(value.candidate) === stableJson(expected.candidate) &&
      stableJson(value.environment) === stableJson(expected.environment) &&
      Array.isArray(value.manifests) &&
      value.manifests.length === 3 &&
      value.manifests.every(
        (manifest, index) =>
          hasExactKeys(manifest, [
            "candidateStable",
            "environmentStable",
            "file",
            "identityStable",
            "runIndex",
            "runnerStatus",
            "validation",
          ]) &&
          manifest.runIndex === index + 1 &&
          manifest.runnerStatus === 0 &&
          manifest.candidateStable === true &&
          manifest.environmentStable === true &&
          manifest.identityStable === true &&
          manifest.validation === "complete",
      );
    return { ok: valid, reason: valid ? "complete" : "series_schema" };
  }
  if (relativePath === "gate-verdict.json") {
    const valid =
      hasExactKeys(value, [
        "artifactAudit",
        "candidate",
        "completedAt",
        "consecutiveSuccesses",
        "environment",
        "manifests",
        "required",
        "result",
        "seriesId",
        "version",
      ]) &&
      value.version === "geotutor_live_gate_verdict.v1" &&
      value.seriesId === expected.seriesId &&
      value.result === gateResult &&
      value.required === 3 &&
      value.consecutiveSuccesses === 3 &&
      hasExactKeys(value.artifactAudit, [
        "fileCount",
        "jsonCount",
        "result",
      ]) &&
      value.artifactAudit.fileCount === 12 &&
      value.artifactAudit.jsonCount === 6 &&
      value.artifactAudit.result === gateResult &&
      stableJson(value.candidate) === stableJson(expected.candidate) &&
      stableJson(value.environment) === stableJson(expected.environment) &&
      Array.isArray(value.manifests) &&
      value.manifests.length === 3 &&
      value.manifests.every(
        (manifest, index) =>
          hasExactKeys(manifest, [
            "candidateStable",
            "environmentStable",
            "file",
            "identityStable",
            "runIndex",
            "runnerStatus",
            "validation",
          ]) &&
          manifest.runIndex === index + 1 &&
          manifest.runnerStatus === 0 &&
          manifest.candidateStable === true &&
          manifest.environmentStable === true &&
          manifest.identityStable === true &&
          manifest.validation === "complete",
      );
    return { ok: valid, reason: valid ? "complete" : "verdict_schema" };
  }
  const match = relativePath.match(/^run-([1-3])\.json$/);
  if (match) {
    return validateRunManifest(
      value,
      {
        runIndex: Number(match[1]),
        seriesId: expected.seriesId,
        candidateId: expected.candidate.id,
        environmentId: expected.environment.id,
      },
      true,
    );
  }
  return { ok: false, reason: "unexpected_json" };
}

async function auditFinalEvidence(expected, gateResult = "pass") {
  const files = await listRelativeFiles(outputRoot);
  const inventory = validateEvidenceFileList(files);
  if (!inventory.ok) return inventory;
  for (const relativePath of files.filter((file) => file.endsWith(".json"))) {
    const value = await loadManifest(path.join(outputRoot, relativePath));
    const validation = validateControlJson(
      relativePath,
      value,
      expected,
      gateResult,
    );
    if (!validation.ok) return validation;
  }
  return { ok: true, reason: "complete" };
}

async function runStaticGates(preflight) {
  for (const [name, args] of STATIC_GATES) {
    const result = runCommand("pnpm", args);
    preflight.gates.push({ name, ...result });
    if (result.status !== 0) return false;
  }
  return true;
}

async function loadManifest(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function main() {
  const candidate = await computeCandidateIdentity();
  const environment = await computeEnvironmentIdentity();
  if (identityOnly) {
    process.stdout.write(`${JSON.stringify({ candidate, environment }, null, 2)}\n`);
    return;
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const seriesId = `series_${sha256(
    `${candidate.id}:${environment.id}:${new Date().toISOString()}`,
  ).slice(0, 24)}`;
  const preflight = {
    version: "geotutor_live_preflight.v1",
    seriesId,
    startedAt: new Date().toISOString(),
    candidate,
    environment,
    gates: [],
    result: "running",
  };
  await writeJson(path.join(outputRoot, "preflight.json"), preflight);

  const staticPassed = await runStaticGates(preflight);
  const candidateAfterGates = await computeCandidateIdentity();
  const environmentAfterGates = await computeEnvironmentIdentity();
  const candidateStable = candidateAfterGates.id === candidate.id;
  const environmentStable = environmentAfterGates.id === environment.id;
  preflight.result =
    staticPassed && candidateStable && environmentStable ? "pass" : "fail";
  preflight.completedAt = new Date().toISOString();
  preflight.candidateStable = candidateStable;
  preflight.environmentStable = environmentStable;
  await writeJson(path.join(outputRoot, "preflight.json"), preflight);
  if (!staticPassed || !candidateStable || !environmentStable) {
    await writeJson(path.join(outputRoot, "series-state.json"), {
      version: "geotutor_live_series.v1",
      seriesId,
      candidate,
      environment,
      required: 3,
      consecutiveSuccesses: 0,
      result: "fail",
      reason: !staticPassed
        ? "preflight_failed"
        : !candidateStable
          ? "candidate_changed_during_preflight"
          : "environment_changed_during_preflight",
      manifests: [],
    });
    process.exitCode = 1;
    return;
  }

  let consecutiveSuccesses = 0;
  const manifests = [];
  for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
    const beforeRun = await computeCandidateIdentity();
    const environmentBeforeRun = await computeEnvironmentIdentity();
    if (
      !qualificationIdentityStable(
        { candidateId: candidate.id, environmentId: environment.id },
        beforeRun,
        environmentBeforeRun,
      )
    ) {
      consecutiveSuccesses = 0;
      await writeJson(path.join(outputRoot, "series-state.json"), {
        version: "geotutor_live_series.v1",
        seriesId,
        candidate,
        environment,
        required: 3,
        consecutiveSuccesses,
        result: "fail",
        reason:
          beforeRun.id !== candidate.id
            ? "candidate_changed_before_run"
            : "environment_changed_before_run",
        manifests,
      });
      process.exitCode = 1;
      return;
    }

    const manifestPath = path.join(outputRoot, `run-${runIndex}.json`);
    const run = runCommand(
      "pnpm",
      [
        "--dir",
        "apps/frontend",
        "exec",
        "playwright",
        "test",
        "--config",
        "playwright.t6-live.config.ts",
        "e2e/t6-live-gate.spec.ts",
      ],
      {
        ...process.env,
        T6_LIVE_GATE: "1",
        T6_GATE_RUN_INDEX: String(runIndex),
        T6_GATE_SERIES_ID: seriesId,
        T6_GATE_CANDIDATE: JSON.stringify(candidate),
        T6_GATE_ENVIRONMENT: JSON.stringify(environment),
      },
    );
    const afterRun = await computeCandidateIdentity();
    const environmentAfterRun = await computeEnvironmentIdentity();
    const candidateStableForRun = afterRun.id === candidate.id;
    const environmentStableForRun = environmentAfterRun.id === environment.id;
    const identityStable =
      candidateStableForRun && environmentStableForRun;
    const manifest = await loadManifest(manifestPath);
    if (manifest) {
      manifest.artifacts = await collectArtifacts(runIndex);
      await writeJson(manifestPath, manifest);
    }
    const validation = validateRunManifest(
      manifest,
      {
        runIndex,
        seriesId,
        candidateId: candidate.id,
        environmentId: environment.id,
      },
      true,
    );
    consecutiveSuccesses = nextConsecutiveCount(
      consecutiveSuccesses,
      validation,
      identityStable && run.status === 0,
    );
    manifests.push({
      runIndex,
      file: path.relative(repositoryRoot, manifestPath),
      runnerStatus: run.status,
      candidateStable: candidateStableForRun,
      environmentStable: environmentStableForRun,
      identityStable,
      validation: validation.reason,
    });
    const passed = consecutiveSuccesses === runIndex;
    await writeJson(path.join(outputRoot, "series-state.json"), {
      version: "geotutor_live_series.v1",
      seriesId,
      candidate,
      environment,
      required: 3,
      consecutiveSuccesses: passed ? consecutiveSuccesses : 0,
      result: passed && runIndex === 3 ? "pass" : passed ? "running" : "fail",
      reason: passed ? "complete_run" : validation.reason,
      manifests,
    });
    if (!passed) {
      process.exitCode = 1;
      return;
    }
  }

  const gateVerdictPath = path.join(outputRoot, "gate-verdict.json");
  const gateVerdict = {
    version: "geotutor_live_gate_verdict.v1",
    seriesId,
    candidate,
    environment,
    required: 3,
    consecutiveSuccesses: 3,
    result: "pending",
    manifests,
    artifactAudit: {
      result: "pending",
      fileCount: 12,
      jsonCount: 6,
    },
    completedAt: new Date().toISOString(),
  };
  await writeJson(gateVerdictPath, gateVerdict);
  const provisionalAudit = await auditFinalEvidence(
    { seriesId, candidate, environment },
    "pending",
  );
  if (!provisionalAudit.ok) {
    gateVerdict.result = "fail";
    gateVerdict.artifactAudit.result = "fail";
    await writeJson(gateVerdictPath, gateVerdict);
    process.exitCode = 1;
    return;
  }
  gateVerdict.result = "pass";
  gateVerdict.artifactAudit.result = "pass";
  await writeJson(gateVerdictPath, gateVerdict);
  const finalAudit = await auditFinalEvidence({
    seriesId,
    candidate,
    environment,
  });
  if (!finalAudit.ok) {
    gateVerdict.result = "fail";
    gateVerdict.artifactAudit.result = "fail";
    await writeJson(gateVerdictPath, gateVerdict);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (modulePath && invokedPath === modulePath) {
  main().catch(async (error) => {
    if (!identityOnly) {
      await mkdir(outputRoot, { recursive: true });
      await writeJson(path.join(outputRoot, "runner-failure.json"), {
        version: "geotutor_live_runner_failure.v1",
        result: "fail",
        reason: error instanceof Error ? error.name : "UnknownError",
        consecutiveSuccesses: 0,
        occurredAt: new Date().toISOString(),
      });
    }
    process.stderr.write("T6 live gate runner failed. Inspect the sanitized evidence files.\n");
    process.exitCode = 1;
  });
}

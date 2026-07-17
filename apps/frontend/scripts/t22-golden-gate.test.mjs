import { describe, expect, it } from "vitest";

import { validateT22Manifest } from "./t22-golden-gate.mjs";

const expected = {
  runIndex: 1,
  seriesId: "series_12345678",
  candidateId: "candidate_12345678",
  environmentId: "environment_12345678",
};

function completeManifest() {
  return {
    schemaVersion: "geotutor_geometry_golden_run.v1",
    ...expected,
    publicationId: "teacher_12345678",
    result: "pass",
    durationMs: 1000,
    steps: {
      publication: "exact_contract",
      scaffoldObjects: 8,
      midpointObjects: 4,
      learnerObjects: 8,
      captures: ["convex", "concave", "crossed"],
      parallelFacts: 6,
      conjecture: "completed",
      justificationSteps: 7,
      transfer: "completed",
      missions: "9/9",
      xp: 160,
    },
    restore: {
      status: "exact",
      targetHash: "hash-1",
      restoredHash: "hash-1",
      inventoryBefore: ["A", "B"],
      inventoryAfter: ["A", "B"],
      ownershipBefore: ["A:scaffold", "E:student"],
      ownershipAfter: ["A:scaffold", "E:student"],
      listenersBefore: 4,
      listenersAfter: 4,
    },
    resources: {
      captureCount: 3,
      evidenceBytes: 1024,
      evidenceMaxBytes: 12 * 1024 * 1024,
      helpersRemaining: 0,
      cleanupClosed: true,
      geometryGlobalsRemaining: 0,
    },
    quality: {
      realApplet: true,
      appletVersion: "5.4.920.0",
      geometryHarness: "v2",
      toolRuntime: "investigation",
      teacherPreviewReady: true,
      publicTeacherJourney: true,
      toolbarCanvasGestures: true,
      assistanceHighlightObserved: true,
      learnerCancellationObserved: true,
      consentedDemonstrationObserved: true,
      replayControlsObserved: true,
      replayStopRestored: true,
      restoreInputBarrierObserved: true,
      assistantDemoProvenanceObserved: true,
      l4LearnerDragPreserved: true,
      appletControlsAccessible: true,
      axeViolations: 0,
      viewportOverflow: false,
      consoleErrors: 0,
      reducedMotion: true,
    },
    artifact: "T22-C08-run-1.png",
  };
}

describe("T22 geometry golden gate manifest", () => {
  it("accepts only the complete closed T22 manifest", () => {
    expect(validateT22Manifest(completeManifest(), expected)).toEqual({
      ok: true,
      reason: "complete",
    });
  });

  it("rejects incomplete, mismatched and sensitive evidence", () => {
    const incomplete = completeManifest();
    incomplete.steps.parallelFacts = 5;
    expect(validateT22Manifest(incomplete, expected).ok).toBe(false);

    const mismatched = completeManifest();
    mismatched.environmentId = "environment_other";
    expect(validateT22Manifest(mismatched, expected).ok).toBe(false);

    const sensitive = completeManifest();
    sensitive.restore.targetHash = "data:image/png;base64,secret";
    sensitive.restore.restoredHash = sensitive.restore.targetHash;
    expect(validateT22Manifest(sensitive, expected).reason).toBe(
      "sensitive_evidence",
    );
  });
});

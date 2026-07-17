import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GeometryEvidenceCaptureV1 } from "@/lib/geometry-investigation/contracts";

import { GeometryEvidenceGallery } from "./geometry-evidence-gallery";

describe("GeometryEvidenceGallery", () => {
  it("labels configuration and provenance without relying on color", () => {
    render(<GeometryEvidenceGallery captures={[capture()]} locale="fr" />);
    expect(screen.getByText("Cas concave")).toBeVisible();
    expect(screen.getByText("Action de l’élève")).toBeVisible();
    expect(screen.getByLabelText("Nombre de captures")).toHaveTextContent("1/8");
  });

  it("requires a second keyboard-operable confirmation before restore", async () => {
    const onRestore = vi.fn(async () => undefined);
    render(
      <GeometryEvidenceGallery
        captures={[capture()]}
        locale="fr"
        onRestore={onRestore}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restaurer" }));
    expect(onRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith("checkpoint_concave"));
  });

  it("exposes pause, resume and stop controls for an active replay", () => {
    const onResume = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <GeometryEvidenceGallery
        captures={[]}
        locale="en"
        replayStatus="paused"
        onDemonstrate={vi.fn()}
        onResume={onResume}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop and restore" }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);

    const onPause = vi.fn();
    rerender(
      <GeometryEvidenceGallery
        captures={[]}
        locale="en"
        replayStatus="playing"
        onDemonstrate={vi.fn()}
        onPause={onPause}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

function capture(): GeometryEvidenceCaptureV1 {
  return {
    schemaVersion: "geometry_evidence_capture.v1",
    id: "capture_concave",
    activityId: "varignon_fr_v1",
    missionId: "V4",
    configuration: "concave",
    epoch: 1,
    revision: 4,
    snapshotHash: "hash-concave",
    checkpointId: "checkpoint_concave",
    objectNames: ["A", "B", "C", "D", "E", "F", "G", "H"],
    factIds: ["rel_configuration_concave"],
    createdAt: 1,
    actor: "learner",
  };
}

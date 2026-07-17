import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GeometrySessionStateV1 } from "@/lib/geometry-investigation/session";
import { VARIGNON_ACTIVITY_FR_V1 } from "@/lib/geometry-investigation/varignon";

import { GeometryInvestigationPanel } from "./geometry-investigation-panel";

const activity = VARIGNON_ACTIVITY_FR_V1;

afterEach(() => {
  cleanup();
});

describe("GeometryInvestigationPanel", () => {
  it("renders nine ordered missions and distinguishes completed from verified", () => {
    const { container } = renderPanel(stateAt("V6"));
    expect(
      screen.getByLabelText("Missions de l’investigation").querySelectorAll("li"),
    ).toHaveLength(9);
    expect(
      container.querySelectorAll('[data-mission-status="verified"]'),
    ).toHaveLength(5);
    expect(container.querySelector('[data-mission-id="V6"]')).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("keeps conjecture text inside React and emits only a completion boolean", () => {
    const onCompleteReflection = vi.fn();
    renderPanel(stateAt("V6"), { onCompleteReflection });
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "EFGH semble toujours parallèle" } });
    fireEvent.click(screen.getByRole("button", { name: "Conserver ma conjecture" }));
    expect(onCompleteReflection).toHaveBeenCalledWith("conjecture", true);
    expect(onCompleteReflection).not.toHaveBeenCalledWith(
      "conjecture",
      expect.stringContaining("EFGH"),
    );
  });

  it("exposes each justification step and a separate smallest-hint action", () => {
    const onCompleteJustificationStep = vi.fn();
    const onRequestHelp = vi.fn();
    renderPanel(stateAt("V8"), {
      onCompleteJustificationStep,
      onRequestHelp,
    });
    expect(
      screen.getAllByRole("button", { name: "J’ai expliqué cette étape" }),
    ).toHaveLength(7);
    fireEvent.click(
      screen.getAllByRole("button", { name: "J’ai expliqué cette étape" })[0],
    );
    expect(onCompleteJustificationStep).toHaveBeenCalledWith("demo_v8_1");
    fireEvent.click(
      screen.getByRole("button", { name: "Demander le plus petit indice" }),
    );
    expect(onRequestHelp).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit visible confirmation before a level-four demonstration", async () => {
    const onConfirmDirective = vi.fn(async () => true);
    renderPanel(stateAt("V8"), {
      directive: {
        id: "directive_v8_help_l4",
        missionId: "V8",
        source: "explicit",
        sourceId: "help_v8",
        level: 4,
        prompt: "Compass peut montrer une étape analogue.",
        hintId: "hint_v8_l4",
        objectNames: ["E", "F", "G", "H"],
        action: "demonstrate_geometry_step",
        requiresConsent: true,
      },
      onConfirmDirective,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "J’accepte de voir cette étape",
      }),
    );
    expect(onConfirmDirective).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Démonstration terminée" }),
      ).toBeDisabled(),
    );
  });
});

function renderPanel(
  state: GeometrySessionStateV1,
  overrides: Partial<React.ComponentProps<typeof GeometryInvestigationPanel>> = {},
) {
  return render(
    <GeometryInvestigationPanel
      activity={activity}
      state={state}
      onRequestHelp={vi.fn()}
      onCompleteReflection={vi.fn()}
      onCompleteJustificationStep={vi.fn()}
      {...overrides}
    />,
  );
}

function stateAt(activeMissionId: string): GeometrySessionStateV1 {
  const activeOrder = Number(activeMissionId.slice(1));
  return {
    activityId: activity.id,
    epoch: 1,
    revision: 2,
    phase: activeMissionId === "V6" ? "conjecturing" : "justifying",
    captures: [],
    missions: activity.missions.map((mission) => ({
      missionId: mission.id,
      order: mission.order,
      status:
        mission.order < activeOrder
          ? "verified"
          : mission.id === activeMissionId
            ? "active"
            : "locked",
      evidenceIds: [],
      missingEvidenceIds: [],
    })),
    activeMissionId,
    reflections: {
      conjectureCompleted: activeOrder > 6,
      transferCompleted: false,
      completedJustificationStepIds: [],
    },
    attempts: {},
    processedReflectionIds: [],
    demonstrationsViewed: [],
    assistance: { highestLevelUsed: 0, deliveredDirectiveIds: [] },
    xpLedger: Object.fromEntries(
      activity.missions
        .filter((mission) => mission.order < activeOrder)
        .map((mission) => [mission.id, 20 as const]),
    ),
    rejectionCount: 0,
  };
}

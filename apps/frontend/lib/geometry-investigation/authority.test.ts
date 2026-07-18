import { describe, expect, it } from "vitest";

import {
  authorizeGeometryActionC04,
  authorizeGeometryActionV1,
} from "./authority";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

const common = {
  activityId: VARIGNON_ACTIVITY_FR_V1.id,
  epoch: 1,
  revision: 2,
} as const;

describe("geometry action authority", () => {
  it("allows O0 in the active mission but rejects undeclared non-UI actions", () => {
    const allowed = authorizeGeometryActionC04(
      "inspect_geometry_workspace",
      { ...common, scope: "all", names: [] },
      VARIGNON_ACTIVITY_FR_V1,
      authority({ missionId: "V1", maxLevel: "O0" }),
    );
    const rejected = authorizeGeometryActionC04(
      "check_geometry_relation",
      {
        ...common,
        relationId: "rel_midpoint_e",
      },
      VARIGNON_ACTIVITY_FR_V1,
      authority({ missionId: "V2", maxLevel: "O0" }),
    );
    expect(allowed).toMatchObject({ ok: true, level: "O0" });
    expect(rejected).toMatchObject({ ok: false, code: "action_not_allowed" });
  });

  it("allows reversible O2 guidance without actor, approval or mission ceremony", () => {
    const tool = authorizeGeometryActionC04(
      "activate_geometry_tool",
      { ...common, tool: "midpoint" },
      VARIGNON_ACTIVITY_FR_V1,
      authority({
        actor: "system",
        missionId: "V6",
        maxLevel: "O2",
        uiGuidanceAllowed: false,
      }),
    );
    const focusAfterCompletion = authorizeGeometryActionC04(
      "focus_geometry_view",
      {
        ...common,
        target: { kind: "objects", names: ["A", "B"] },
        margin: 0.2,
      },
      VARIGNON_ACTIVITY_FR_V1,
      authority({
        actor: "system",
        phase: "completed",
        missionId: undefined,
        maxLevel: "O2",
        uiGuidanceAllowed: false,
      }),
    );
    expect(tool).toMatchObject({ ok: true, level: "O2" });
    expect(focusAfterCompletion).toMatchObject({ ok: true, level: "O2" });
  });

  it("still requires O2 authority for reversible UI guidance", () => {
    const result = authorizeGeometryActionC04(
      "activate_geometry_tool",
      { ...common, tool: "midpoint" },
      VARIGNON_ACTIVITY_FR_V1,
      authority({ actor: "system", missionId: "V6", maxLevel: "O1" }),
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_authority" });
  });

  it("requires an exact prior learner attempt before O3 variation", () => {
    const result = authorizeGeometryActionC04(
      "create_geometry_variation",
      {
        ...common,
        target: "concave",
        movingPoint: "A",
        consentToken: "ggb-consent:00000000-0000-0000-0000-000000000000",
      },
      VARIGNON_ACTIVITY_FR_V1,
      authority({ missionId: "V4", maxLevel: "O3" }),
    );
    expect(result).toMatchObject({ ok: false, code: "attempt_required" });
  });

  it("keeps initialization system-only and rejects stale epoch", () => {
    const assistant = authorizeGeometryActionC04(
      "initialize_geometry_activity",
      { ...common, scaffoldVersion: "varignon-scaffold.v1" },
      VARIGNON_ACTIVITY_FR_V1,
      authority({ phase: "confirmed", actor: "assistant", maxLevel: "O5" }),
    );
    const stale = authorizeGeometryActionC04(
      "inspect_geometry_workspace",
      { ...common, epoch: 0, scope: "all", names: [] },
      VARIGNON_ACTIVITY_FR_V1,
      authority({ missionId: "V1", maxLevel: "O0" }),
    );
    expect(assistant).toMatchObject({ ok: false, code: "invalid_authority" });
    expect(stale).toMatchObject({ ok: false, code: "rejected_stale" });
  });

  it("requires a current learner action before an O2 evidence capture", () => {
    const arguments_ = {
      ...common,
      missionId: "V3",
      configuration: "convex" as const,
      requiredFactIds: ["rel_configuration_convex"],
    };
    expect(
      authorizeGeometryActionV1(
        "capture_geometry_evidence",
        arguments_,
        VARIGNON_ACTIVITY_FR_V1,
        authority({ missionId: "V3", maxLevel: "O2" }),
      ),
    ).toMatchObject({ ok: false, code: "invalid_authority" });
    expect(
      authorizeGeometryActionV1(
        "capture_geometry_evidence",
        arguments_,
        VARIGNON_ACTIVITY_FR_V1,
        authority({
          missionId: "V3",
          maxLevel: "O2",
          learnerActionCurrent: true,
        }),
      ),
    ).toMatchObject({ ok: true, level: "O2" });
  });

  it("gates exact restoration at O4 and demonstration after an O5 attempt", () => {
    const restoreArguments = {
      ...common,
      checkpointId: "checkpoint_convex",
      confirmationId:
        "ggb-privileged:00000000-0000-0000-0000-000000000000",
    };
    expect(
      authorizeGeometryActionV1(
        "restore_geometry_checkpoint",
        restoreArguments,
        VARIGNON_ACTIVITY_FR_V1,
        authority({ missionId: "V7", maxLevel: "O3" }),
      ),
    ).toMatchObject({ ok: false, code: "invalid_authority" });
    expect(
      authorizeGeometryActionV1(
        "restore_geometry_checkpoint",
        restoreArguments,
        VARIGNON_ACTIVITY_FR_V1,
        authority({ missionId: "V7", maxLevel: "O4" }),
      ),
    ).toMatchObject({ ok: true, level: "O4" });

    const demonstrationArguments = {
      ...common,
      stepId: "demo_v8_7",
      consentToken:
        "ggb-privileged:00000000-0000-0000-0000-000000000000",
      speed: "reduced" as const,
    };
    expect(
      authorizeGeometryActionV1(
        "demonstrate_geometry_step",
        demonstrationArguments,
        VARIGNON_ACTIVITY_FR_V1,
        authority({ missionId: "V8", maxLevel: "O5" }),
      ),
    ).toMatchObject({ ok: false, code: "attempt_required" });
    expect(
      authorizeGeometryActionV1(
        "demonstrate_geometry_step",
        demonstrationArguments,
        VARIGNON_ACTIVITY_FR_V1,
        authority({
          missionId: "V8",
          maxLevel: "O5",
          attemptedDemonstrationStepIds: ["demo_v8_7"],
        }),
      ),
    ).toMatchObject({ ok: true, level: "O5" });
  });
});

function authority(
  overrides: Partial<Parameters<typeof authorizeGeometryActionC04>[3]> = {},
): Parameters<typeof authorizeGeometryActionC04>[3] {
  return {
    activityId: VARIGNON_ACTIVITY_FR_V1.id,
    epoch: 1,
    revision: 2,
    phase: "investigating",
    actor: "assistant",
    maxLevel: "O5",
    missionId: "V1",
    uiGuidanceAllowed: true,
    attemptedVariationTargets: [],
    ...overrides,
  };
}

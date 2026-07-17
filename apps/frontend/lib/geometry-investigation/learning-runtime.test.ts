import { describe, expect, it, vi } from "vitest";

import { GeometryWorldV2, type GeometryWorldObjectV2 } from "./contracts";
import { GeometryLearningRuntimeV1 } from "./learning-runtime";
import { VARIGNON_ACTIVITY_FR_V1 } from "./varignon";

const activity = VARIGNON_ACTIVITY_FR_V1;

describe("GeometryLearningRuntimeV1", () => {
  it("commits local progress before returning a policy decision", () => {
    const order: string[] = [];
    const runtime = new GeometryLearningRuntimeV1(activity, {
      onState: (state) => order.push(`state:${state.phase}`),
      onDecision: (decision) => order.push(`decision:${decision.type}`),
    });
    runtime.commitWorld(scaffoldWorld());
    expect(runtime.state).toMatchObject({
      phase: "constructing",
      activeMissionId: "V1",
    });

    const first = runtime.recordAttempt("attempt_1");
    const repeated = runtime.recordAttempt("attempt_2");
    expect(first).toEqual({ type: "SILENT", reason: "first_block" });
    expect(repeated).toMatchObject({
      type: "SPEAK",
      directive: { missionId: "V1", level: 1 },
    });
    expect(order.indexOf("state:constructing")).toBeLessThan(
      order.indexOf("decision:SPEAK"),
    );
  });

  it("records delivered help before allowing exactly one level of escalation", () => {
    const runtime = new GeometryLearningRuntimeV1(activity);
    runtime.commitWorld(scaffoldWorld());
    const first = runtime.requestHelp("help_1");
    expect(first).toMatchObject({
      type: "SPEAK",
      directive: { level: 1 },
    });
    if (first?.type !== "SPEAK") throw new Error("Expected help directive.");
    runtime.markAssistanceDelivered(first.directive);
    const second = runtime.requestHelp("help_2");
    expect(second).toMatchObject({
      type: "SPEAK",
      directive: { level: 2 },
    });
    expect(runtime.state.assistance.highestLevelUsed).toBe(1);
  });

  it("exports a bounded Realtime context without learner text or coordinates", () => {
    const runtime = new GeometryLearningRuntimeV1(activity);
    runtime.commitWorld(scaffoldWorld());
    runtime.recordAttempt("attempt_1");
    runtime.requestHelp("help_1");
    const context = runtime.realtimeContext();
    expect(context).toMatchObject({
      schemaVersion: "geometry_realtime_pedagogy_context.v1",
      activityId: activity.id,
      phase: "constructing",
      activeMissionId: "V1",
      attemptCount: 1,
      explicitHelpRequestCount: 1,
      maxHelpLevel: 3,
    });
    expect(context).not.toHaveProperty("learnerText");
    expect(context).not.toHaveProperty("coordinates");
    expect(context).not.toHaveProperty("transcript");
  });

  it("keeps the full path local when no network callback exists", () => {
    const onDecision = vi.fn();
    const runtime = new GeometryLearningRuntimeV1(activity, { onDecision });
    runtime.commitWorld(scaffoldWorld());
    runtime.recordAttempt("attempt_1");
    runtime.recordAttempt("attempt_2");
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "SPEAK" }),
    );
  });
});

function scaffoldWorld() {
  const objects: GeometryWorldObjectV2[] = [
    point("A", -4, -1),
    point("B", -1, -3),
    point("C", 4, -1),
    point("D", 1, 3),
    segment("AB", "A", "B"),
    segment("BC", "B", "C"),
    segment("CD", "C", "D"),
    segment("DA", "D", "A"),
  ];
  return GeometryWorldV2.parse({
    schemaVersion: "geometry_world.v2",
    activityId: activity.id,
    epoch: 1,
    revision: 1,
    snapshotHash: "scaffold-hash",
    objectCount: objects.length,
    truncated: false,
    objects,
    facts: [],
    change: {
      kind: "initial",
      objectNames: objects.map(({ name }) => name),
      terminal: true,
      actor: "system",
      occurredAt: 1,
    },
  });
}

function point(name: string, x: number, y: number): GeometryWorldObjectV2 {
  return {
    name,
    type: "point",
    command: `${name}=(${x},${y})`,
    parents: [],
    dependencyStatus: "known",
    owner: "scaffold",
    x,
    y,
    visible: true,
  };
}

function segment(
  name: string,
  from: string,
  to: string,
): GeometryWorldObjectV2 {
  return {
    name,
    type: "segment",
    command: `${name}=Segment(${from},${to})`,
    parents: [from, to],
    dependencyStatus: "known",
    owner: "scaffold",
    visible: true,
  };
}

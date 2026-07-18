import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GeometryWorldV2 } from "@/lib/geometry-investigation/contracts";

import { GeometryGuidanceOverlay } from "./geometry-guidance-overlay";

afterEach(() => {
  document.body.replaceChildren();
});

describe("GeometryGuidanceOverlay", () => {
  it("opens the compact tool list and resolves the real mode button", async () => {
    const { shell, root } = appletShell(287);
    const more = document.createElement("button");
    more.className = "materialTextButton";
    more.textContent = "More";
    more.getBoundingClientRect = () => rect(80, 120, 80, 40);
    more.addEventListener("click", () => {
      const midpoint = document.createElement("button");
      midpoint.className = "toolButton";
      midpoint.id = "mode19";
      midpoint.setAttribute("mode", "19");
      midpoint.setAttribute("selected", "true");
      midpoint.textContent = "Midpoint or Center";
      midpoint.getBoundingClientRect = () => rect(90, 200, 80, 72);
      midpoint.scrollIntoView = vi.fn();
      root.append(midpoint);
    });
    root.append(more);

    const result = render(
      <GeometryGuidanceOverlay
        presentation={{
          cue: {
            id: 1,
            kind: "toolbar",
            action: "activate_geometry_tool",
            tool: "midpoint",
            mode: 19,
            label: "Midpoint or Center",
            clickOrder: "Click the two endpoints.",
            durationMs: 10_000,
          },
        }}
        appletRootRef={{ current: root }}
        locale="en"
      />,
    );

    await waitFor(() =>
      expect(
        result.container.querySelector("[data-guidance-resolved='true']"),
      ).not.toBeNull(),
    );
    expect(root.querySelector("#mode19")?.getAttribute("selected")).toBe("true");
    expect(
      result.container.querySelector("[data-target-mode='19']"),
    ).not.toBeNull();
    expect(result.getByText("Tool ready: Midpoint or Center")).toBeTruthy();
    const callout = result.container.querySelector<HTMLElement>(
      ".geometry-guidance-target__callout",
    );
    expect(callout?.style.width).toBe("180px");
    expect(callout?.style.left).toBe("64px");
    shell.remove();
  });

  it("projects a named segment to the center of its parent points", async () => {
    const { shell, root } = appletShell();
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => rect(300, 100, 500, 300);
    root.append(canvas);
    const world = segmentWorld();

    const result = render(
      <GeometryGuidanceOverlay
        presentation={{
          cue: {
            id: 2,
            kind: "objects",
            action: "highlight_geometry_objects",
            names: ["AB"],
            style: "hint",
            durationMs: 4_000,
          },
          world,
          view: {
            xMin: -5,
            yMin: -3,
            invXscale: 0.02,
            invYscale: 0.02,
            width: 500,
            height: 300,
          },
        }}
        appletRootRef={{ current: root }}
        locale="fr"
      />,
    );

    await waitFor(() =>
      expect(
        result.container.querySelector("[data-guidance-resolved='true']"),
      ).not.toBeNull(),
    );
    const target = result.container.querySelector<HTMLElement>(
      ".geometry-guidance-target",
    );
    expect(target?.style.left).toBe("485px");
    expect(target?.style.top).toBe("185px");
    expect(result.getByText("Regarde AB")).toBeTruthy();
    expect(shell.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
      inline: "nearest",
    });
    shell.remove();
  });
});

function appletShell(width = 900) {
  const shell = document.createElement("div");
  const root = document.createElement("div");
  shell.getBoundingClientRect = () => rect(50, 50, width, 650);
  root.getBoundingClientRect = () => rect(50, 50, width, 650);
  shell.scrollIntoView = vi.fn();
  shell.append(root);
  document.body.append(shell);
  return { shell, root };
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function segmentWorld(): GeometryWorldV2 {
  return {
    schemaVersion: "geometry_world.v2",
    activityId: "varignon_fr_v1",
    epoch: 1,
    revision: 1,
    snapshotHash: "hash:segment",
    objectCount: 3,
    truncated: false,
    objects: [
      {
        name: "A",
        type: "point",
        command: "A=(-2,0)",
        parents: [],
        dependencyStatus: "unknown",
        owner: "scaffold",
        x: -2,
        y: 0,
        visible: true,
      },
      {
        name: "B",
        type: "point",
        command: "B=(2,0)",
        parents: [],
        dependencyStatus: "unknown",
        owner: "scaffold",
        x: 2,
        y: 0,
        visible: true,
      },
      {
        name: "AB",
        type: "segment",
        command: "Segment(A,B)",
        parents: ["A", "B"],
        dependencyStatus: "known",
        owner: "scaffold",
        visible: true,
      },
    ],
    facts: [],
    change: {
      kind: "initial",
      objectNames: [],
      terminal: true,
      actor: "system",
      occurredAt: 0,
    },
  };
}

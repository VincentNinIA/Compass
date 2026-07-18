"use client";

import {
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";

import type { GeometryWorldV2 } from "@/lib/geometry-investigation/contracts";
import {
  findGeoGebraMoreButtonV1,
  findGeoGebraToolButtonV1,
  geometryAnchorForNamesV1,
  projectGeometryBoxV1,
  projectGeometryPointV1,
  type GeometryViewPropertiesV1,
  type GeometryVisualGuidanceCueV1,
} from "@/lib/geometry-investigation/visual-guidance";

type GuidanceTarget = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  side: "before" | "after";
  compactCallout?: Readonly<{
    left: number;
    width: number;
  }>;
}>;

type ResolvedGuidanceTarget = GuidanceTarget & Readonly<{ cueId: number }>;

export type GeometryGuidancePresentationV1 = Readonly<{
  cue: GeometryVisualGuidanceCueV1;
  world?: GeometryWorldV2;
  view?: GeometryViewPropertiesV1;
}>;

export function GeometryGuidanceOverlay({
  presentation,
  appletRootRef,
  locale,
  onDismiss,
}: Readonly<{
  presentation?: GeometryGuidancePresentationV1;
  appletRootRef: RefObject<HTMLDivElement | null>;
  locale: "fr" | "en";
  onDismiss?(cueId: number): void;
}>) {
  const [target, setTarget] = useState<ResolvedGuidanceTarget>();
  const cue = presentation?.cue;

  useEffect(() => {
    if (!cue) return;
    const timer = window.setTimeout(() => onDismiss?.(cue.id), cue.durationMs);
    return () => window.clearTimeout(timer);
  }, [cue, onDismiss]);

  useEffect(() => {
    const root = appletRootRef.current;
    const shell = root?.parentElement;
    if (!cue || !root || !shell) return;

    let disposed = false;
    let targetElement: HTMLElement | undefined;
    let resizeObserver: ResizeObserver | undefined;

    const update = () => {
      if (disposed) return;
      const next = resolveGuidanceTarget(
        presentation,
        root,
        shell,
        targetElement,
      );
      setTarget(next ? { ...next, cueId: cue.id } : undefined);
    };

    const observe = () => {
      resizeObserver?.disconnect();
      if (typeof ResizeObserver === "undefined") return;
      resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(shell);
      resizeObserver.observe(root);
      if (targetElement) resizeObserver.observe(targetElement);
    };

    const prepare = async () => {
      await nextAnimationFrame();
      if (disposed) return;
      if (cue.kind === "toolbar") {
        targetElement = findGeoGebraToolButtonV1(root, cue.mode);
        if (!targetElement) {
          findGeoGebraMoreButtonV1(root)?.click();
          targetElement = await waitForToolButton(root, cue.mode);
        }
        if (disposed) return;
        targetElement?.scrollIntoView({
          behavior: "auto",
          block: "center",
          inline: "nearest",
        });
        await nextAnimationFrame();
      } else {
        shell.scrollIntoView?.({
          behavior: "auto",
          block: "center",
          inline: "nearest",
        });
        await nextAnimationFrame();
      }
      if (disposed) return;
      update();
      observe();
    };

    void prepare();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [appletRootRef, cue, presentation]);

  const copy = useMemo(
    () => guidanceCopy(cue, locale),
    [cue, locale],
  );
  const activeTarget = target?.cueId === cue?.id ? target : undefined;

  if (!cue) return null;

  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite">
        {copy.title}. {copy.detail}
      </div>
      <div
        className="geometry-guidance-layer"
        data-geometry-guidance={cue.kind}
        data-guidance-resolved={activeTarget ? "true" : "false"}
        data-target-mode={cue.kind === "toolbar" ? cue.mode : undefined}
        data-target-names={cue.kind === "objects" ? cue.names.join(",") : undefined}
        aria-hidden="true"
      >
        {activeTarget ? (
          <div
            className="geometry-guidance-target"
            data-kind={cue.kind}
            data-side={activeTarget.side}
            style={{
              left: activeTarget.left,
              top: activeTarget.top,
              width: activeTarget.width,
              height: activeTarget.height,
            }}
          >
            <span className="geometry-guidance-target__pulse" />
            <span className="geometry-guidance-target__pointer" />
            <p
              className="geometry-guidance-target__callout"
              style={
                activeTarget.compactCallout
                  ? {
                      left: activeTarget.compactCallout.left,
                      right: "auto",
                      width: activeTarget.compactCallout.width,
                      textAlign: "left",
                    }
                  : undefined
              }
            >
              <strong>{copy.title}</strong>
              <span>{copy.detail}</span>
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

function resolveGuidanceTarget(
  presentation: GeometryGuidancePresentationV1 | undefined,
  root: HTMLElement,
  shell: HTMLElement,
  targetElement?: HTMLElement,
): GuidanceTarget | undefined {
  if (!presentation) return undefined;
  const { cue, world, view } = presentation;
  const shellRect = shell.getBoundingClientRect();

  if (cue.kind === "toolbar") {
    const element = targetElement ?? findGeoGebraToolButtonV1(root, cue.mode);
    if (!element) return undefined;
    return paddedTarget(element.getBoundingClientRect(), shellRect, 7);
  }

  if (!view) return undefined;
  const canvas = findGraphicsCanvas(root, view);
  if (!canvas) return undefined;
  const canvasRect = canvas.getBoundingClientRect();

  if (cue.kind === "objects") {
    if (!world) return undefined;
    const logical = geometryAnchorForNamesV1(world, cue.names);
    if (!logical) return undefined;
    const projected = projectGeometryPointV1(logical, view);
    const size = 30;
    return withSide(
      {
        left: canvasRect.left - shellRect.left + projected.x - size / 2,
        top: canvasRect.top - shellRect.top + projected.y - size / 2,
        width: size,
        height: size,
      },
      shellRect.width,
    );
  }

  const projected = projectGeometryBoxV1(cue.box, view);
  return withSide(
    {
      left: canvasRect.left - shellRect.left + projected.left,
      top: canvasRect.top - shellRect.top + projected.top,
      width: projected.width,
      height: projected.height,
    },
    shellRect.width,
  );
}

function paddedTarget(
  target: DOMRect,
  shell: DOMRect,
  padding: number,
): GuidanceTarget {
  return withSide(
    {
      left: target.left - shell.left - padding,
      top: target.top - shell.top - padding,
      width: target.width + padding * 2,
      height: target.height + padding * 2,
    },
    shell.width,
  );
}

function withSide(
  target: Omit<GuidanceTarget, "side">,
  shellWidth: number,
): GuidanceTarget {
  const side = target.left + target.width / 2 > shellWidth * 0.6
    ? "before"
    : "after";
  const calloutWidth = Math.min(180, shellWidth - 20);
  const desiredCalloutLeft = side === "before"
    ? target.left - 38 - calloutWidth
    : target.left + target.width + 38;
  const compactCallout = shellWidth <= 640
    ? {
        left:
          Math.min(
            Math.max(10, desiredCalloutLeft),
            shellWidth - calloutWidth - 10,
          ) - target.left,
        width: calloutWidth,
      }
    : undefined;
  return {
    ...target,
    side,
    compactCallout,
  };
}

function findGraphicsCanvas(
  root: HTMLElement,
  view: GeometryViewPropertiesV1,
): HTMLCanvasElement | undefined {
  return [...root.querySelectorAll<HTMLCanvasElement>("canvas")].find((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      Math.abs(rect.width - view.width) <= 2 &&
      Math.abs(rect.height - view.height) <= 2
    );
  });
}

async function waitForToolButton(
  root: HTMLElement,
  mode: number,
): Promise<HTMLButtonElement | undefined> {
  const immediate = findGeoGebraToolButtonV1(root, mode);
  if (immediate) return immediate;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (button?: HTMLButtonElement) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve(button);
    };
    const observer = new MutationObserver(() => {
      const button = findGeoGebraToolButtonV1(root, mode);
      if (button) finish(button);
    });
    observer.observe(root, { childList: true, subtree: true });
    const timeout = window.setTimeout(
      () => finish(findGeoGebraToolButtonV1(root, mode)),
      800,
    );
  });
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function guidanceCopy(
  cue: GeometryVisualGuidanceCueV1 | undefined,
  locale: "fr" | "en",
): Readonly<{ title: string; detail: string }> {
  if (!cue) return { title: "", detail: "" };
  if (cue.kind === "toolbar") {
    return locale === "fr"
      ? { title: `Outil prêt : ${cue.label}`, detail: cue.clickOrder }
      : { title: `Tool ready: ${cue.label}`, detail: cue.clickOrder };
  }
  if (cue.kind === "objects") {
    const names = cue.names.join(" · ");
    return locale === "fr"
      ? { title: `Regarde ${names}`, detail: "Compass met cette cible en évidence." }
      : { title: `Look at ${names}`, detail: "Compass is highlighting this target." };
  }
  return locale === "fr"
    ? { title: "Zone à observer", detail: "Compass a cadré cette partie du plan." }
    : { title: "Area to inspect", detail: "Compass framed this part of the board." };
}

import { afterEach, describe, expect, it } from "vitest";

import { GeoGebraAccessibilityGuard } from "./accessibility";

describe("GeoGebraAccessibilityGuard", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("makes third-party aria-hidden subtrees inert and restores them when visible", async () => {
    const root = document.createElement("div");
    const hiddenToolbar = document.createElement("div");
    hiddenToolbar.setAttribute("aria-hidden", "true");
    hiddenToolbar.style.display = "none";
    hiddenToolbar.innerHTML = "<button type='button'>Hidden tool</button>";
    root.append(hiddenToolbar);
    document.body.append(root);

    const guard = new GeoGebraAccessibilityGuard(root);
    guard.start();
    expect(hiddenToolbar).toHaveAttribute("inert");

    hiddenToolbar.setAttribute("aria-hidden", "false");
    hiddenToolbar.style.display = "block";
    await Promise.resolve();
    expect(hiddenToolbar).not.toHaveAttribute("inert");
    guard.stop();
  });

  it("guards hidden subtrees inserted after the applet starts", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const guard = new GeoGebraAccessibilityGuard(root);
    guard.start();

    const hiddenMenu = document.createElement("div");
    hiddenMenu.setAttribute("aria-hidden", "true");
    hiddenMenu.hidden = true;
    root.append(hiddenMenu);
    await Promise.resolve();
    expect(hiddenMenu).toHaveAttribute("inert");

    guard.stop();
    expect(hiddenMenu).not.toHaveAttribute("inert");
  });

  it("keeps a visible GeoGebra tool interactive even when the applet marks it aria-hidden", () => {
    const root = document.createElement("div");
    const tool = document.createElement("button");
    tool.className = "toolButton";
    tool.setAttribute("aria-hidden", "true");
    Object.defineProperty(tool, "offsetParent", { value: root });
    tool.getClientRects = () =>
      ({
        0: tool.getBoundingClientRect(),
        length: 1,
        item: () => null,
      }) as unknown as DOMRectList;
    root.append(tool);
    document.body.append(root);

    const guard = new GeoGebraAccessibilityGuard(root);
    guard.start();

    expect(tool).not.toHaveAttribute("inert");
    expect(tool).not.toHaveAttribute("aria-hidden");
    guard.stop();
    expect(tool).toHaveAttribute("aria-hidden", "true");
  });

  it("makes the pinned applet scroll panel keyboard reachable and restores it", () => {
    const root = document.createElement("div");
    const scrollable = document.createElement("div");
    scrollable.className = "customScrollbar";
    root.append(scrollable);
    document.body.append(root);

    const guard = new GeoGebraAccessibilityGuard(root);
    guard.start();
    expect(scrollable).toHaveAttribute("tabindex", "0");
    expect(scrollable).toHaveAttribute("role", "region");
    expect(scrollable).toHaveAccessibleName("GeoGebra scrollable panel");

    guard.stop();
    expect(scrollable).not.toHaveAttribute("tabindex");
    expect(scrollable).not.toHaveAttribute("role");
    expect(scrollable).not.toHaveAttribute("aria-label");
  });

  it("normalizes pinned applet tab order, disabled controls and decorative icons", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button aria-disabled="true" tabindex="122">
        <img alt="" tabindex="-1" />
      </button>
    `;
    document.body.append(root);
    const button = root.querySelector("button")!;
    const image = root.querySelector("img")!;

    const guard = new GeoGebraAccessibilityGuard(root);
    guard.start();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("tabindex", "0");
    expect(image).not.toHaveAttribute("tabindex");

    button.setAttribute("aria-disabled", "false");
    guard.sync();
    expect(button).not.toBeDisabled();

    guard.stop();
    expect(button).toHaveAttribute("tabindex", "122");
    expect(image).toHaveAttribute("tabindex", "-1");
  });
});

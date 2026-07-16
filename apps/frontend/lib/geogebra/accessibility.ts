export class GeoGebraAccessibilityGuard {
  private readonly previousInert = new Map<HTMLElement, boolean>();
  private readonly scrollableAttributes = new Map<
    HTMLElement,
    { ariaLabel: string | null; role: string | null; tabIndex: string | null }
  >();
  private readonly disabledControls = new Map<HTMLButtonElement, boolean>();
  private readonly positiveTabIndexes = new Map<HTMLElement, string>();
  private readonly decorativeImageTabIndexes = new Map<HTMLImageElement, string>();
  private observer?: MutationObserver;

  constructor(private readonly root: HTMLElement) {}

  start() {
    if (this.observer) return;
    this.sync();
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(this.root, {
      attributes: true,
      attributeFilter: ["aria-disabled", "aria-hidden", "class", "hidden", "style"],
      childList: true,
      subtree: true,
    });
  }

  stop() {
    this.observer?.disconnect();
    this.observer = undefined;
    for (const [element, inert] of this.previousInert) {
      if (element.isConnected) this.restoreInert(element, inert);
    }
    this.previousInert.clear();
    for (const [element, attributes] of this.scrollableAttributes) {
      if (!element.isConnected) continue;
      this.restoreAttribute(element, "aria-label", attributes.ariaLabel);
      this.restoreAttribute(element, "role", attributes.role);
      this.restoreAttribute(element, "tabindex", attributes.tabIndex);
    }
    this.scrollableAttributes.clear();
    for (const [element, disabled] of this.disabledControls) {
      if (element.isConnected) element.disabled = disabled;
    }
    this.disabledControls.clear();
    for (const [element, tabIndex] of this.positiveTabIndexes) {
      if (element.isConnected) element.setAttribute("tabindex", tabIndex);
    }
    this.positiveTabIndexes.clear();
    for (const [element, tabIndex] of this.decorativeImageTabIndexes) {
      if (element.isConnected) element.setAttribute("tabindex", tabIndex);
    }
    this.decorativeImageTabIndexes.clear();
  }

  sync() {
    const hidden = new Set(
      [...this.root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].filter(
        (element) => this.isActuallyHidden(element),
      ),
    );
    for (const element of hidden) {
      if (!this.previousInert.has(element)) {
        this.previousInert.set(element, element.hasAttribute("inert"));
      }
      element.setAttribute("inert", "");
    }
    for (const [element, inert] of this.previousInert) {
      if (hidden.has(element)) continue;
      if (element.isConnected) this.restoreInert(element, inert);
      this.previousInert.delete(element);
    }

    const scrollableRegions = new Set(
      this.root.querySelectorAll<HTMLElement>(".customScrollbar"),
    );
    for (const element of scrollableRegions) {
      if (!this.scrollableAttributes.has(element)) {
        this.scrollableAttributes.set(element, {
          ariaLabel: element.getAttribute("aria-label"),
          role: element.getAttribute("role"),
          tabIndex: element.getAttribute("tabindex"),
        });
      }
      element.setAttribute("aria-label", "GeoGebra scrollable panel");
      element.setAttribute("role", "region");
      element.setAttribute("tabindex", "0");
    }
    for (const [element, attributes] of this.scrollableAttributes) {
      if (scrollableRegions.has(element)) continue;
      if (element.isConnected) {
        this.restoreAttribute(element, "aria-label", attributes.ariaLabel);
        this.restoreAttribute(element, "role", attributes.role);
        this.restoreAttribute(element, "tabindex", attributes.tabIndex);
      }
      this.scrollableAttributes.delete(element);
    }

    for (const element of this.root.querySelectorAll<HTMLElement>("[tabindex]")) {
      const tabIndex = element.getAttribute("tabindex");
      if (tabIndex !== null && Number.parseInt(tabIndex, 10) > 0) {
        if (!this.positiveTabIndexes.has(element)) {
          this.positiveTabIndexes.set(element, tabIndex);
        }
        element.setAttribute("tabindex", "0");
      }
    }

    for (const element of this.root.querySelectorAll<HTMLImageElement>(
      'img[alt=""][tabindex="-1"]',
    )) {
      if (!this.decorativeImageTabIndexes.has(element)) {
        this.decorativeImageTabIndexes.set(element, "-1");
      }
      element.removeAttribute("tabindex");
    }

    const disabledControls = new Set(
      this.root.querySelectorAll<HTMLButtonElement>('button[aria-disabled="true"]'),
    );
    for (const element of disabledControls) {
      if (!this.disabledControls.has(element)) {
        this.disabledControls.set(element, element.disabled);
      }
      element.disabled = true;
    }
    for (const [element, disabled] of this.disabledControls) {
      if (disabledControls.has(element)) continue;
      if (element.isConnected) element.disabled = disabled;
      this.disabledControls.delete(element);
    }
  }

  private isActuallyHidden(element: HTMLElement) {
    if (element.hidden) return true;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.contentVisibility === "hidden"
    ) {
      return true;
    }
    return element.getClientRects().length === 0 && element.offsetParent === null;
  }

  private restoreInert(element: HTMLElement, inert: boolean) {
    if (inert) element.setAttribute("inert", "");
    else element.removeAttribute("inert");
  }

  private restoreAttribute(
    element: HTMLElement,
    name: string,
    value: string | null,
  ) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
}

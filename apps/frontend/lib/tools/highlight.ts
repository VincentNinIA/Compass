import type { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import type { SceneRegistry } from "@/lib/geogebra/scene";
import type { HighlightStyle } from "./contracts";
import { ToolHandlerError } from "./gateway";

type TimerDependencies = {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};

type ActiveHighlight = {
  color: [number, number, number];
  timer: ReturnType<typeof setTimeout>;
};

const COLORS: Record<HighlightStyle, [number, number, number]> = {
  focus: [24, 107, 255],
  hint: [245, 158, 11],
};

export class HighlightManager {
  private readonly active = new Map<string, ActiveHighlight>();

  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly registry: SceneRegistry,
    private readonly timers: TimerDependencies = { setTimeout, clearTimeout },
  ) {}

  apply(names: string[], style: HighlightStyle, ttlMs: number) {
    if (names.some((name) => this.active.has(name))) {
      throw new ToolHandlerError("highlight_active", "An object is already highlighted.");
    }
    const missing = names.filter((name) => !this.registry.get(name));
    if (missing.length > 0) {
      throw new ToolHandlerError("object_missing", "A requested object does not exist.");
    }
    const highlighted = this.adapter.withApi((api) => {
      if (!api.getColor || !api.setColor) {
        throw new Error("GeoGebra color methods are unavailable.");
      }
      const originals = new Map<string, [number, number, number]>();
      for (const name of names) {
        if (!api.exists(name) || !api.isDefined(name)) {
          throw new ToolHandlerError("object_missing", "A requested object does not exist.");
        }
        const color = parseColor(api.getColor(name));
        if (!color) throw new Error("GeoGebra returned an invalid object color.");
        originals.set(name, color);
      }
      const changed: string[] = [];
      try {
        for (const name of names) {
          api.setColor(name, ...COLORS[style]);
          changed.push(name);
        }
      } catch (error) {
        for (const name of changed.toReversed()) {
          const color = originals.get(name);
          if (color) api.setColor(name, ...color);
        }
        throw error;
      }
      return originals;
    });
    if (!highlighted.ok) throw new Error(highlighted.error.message);

    for (const [name, color] of highlighted.value) {
      const timer = this.timers.setTimeout(() => {
        this.restore(name);
      }, ttlMs);
      this.active.set(name, { color, timer });
    }
    return { names: [...names], style, ttlMs };
  }

  cleanup(names?: readonly string[]): boolean {
    let restored = true;
    const selected = names ? new Set(names) : null;
    for (const [name, highlight] of [...this.active]) {
      if (selected && !selected.has(name)) continue;
      this.timers.clearTimeout(highlight.timer);
      restored = this.restore(name) && restored;
    }
    return restored;
  }

  reconcileAfterExternalRestore(names?: readonly string[]): void {
    const selected = names ? new Set(names) : null;
    for (const [name, highlight] of [...this.active]) {
      if (selected && !selected.has(name)) continue;
      this.timers.clearTimeout(highlight.timer);
      this.active.delete(name);
    }
  }

  private restore(name: string): boolean {
    const highlight = this.active.get(name);
    if (!highlight) return true;
    try {
      const restored = this.adapter.withApi((api) => {
        if (!api.setColor || !api.getColor || !api.exists(name)) return false;
        api.setColor(name, ...highlight.color);
        return sameColor(parseColor(api.getColor(name)), highlight.color);
      });
      if (!restored.ok || !restored.value) return false;
      this.active.delete(name);
      return true;
    } catch {
      return false;
    }
  }
}

function parseColor(value: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  return match
    ? [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)]
    : undefined;
}

function sameColor(
  left: [number, number, number] | undefined,
  right: [number, number, number],
): boolean {
  return Boolean(left?.every((value, index) => value === right[index]));
}

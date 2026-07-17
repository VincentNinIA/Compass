import {
  GEOGEBRA_CODEBASE_URL,
  loadGeoGebraScript,
} from "@/lib/geogebra";
import type {
  GeoGebraApi,
  GeoGebraAppletController,
  GeoGebraAppletParameters,
  GeoGebraClientListener,
  GeoGebraLifecycle,
  GeoGebraObjectListener,
  GeoGebraObjectListenerKind,
  GeoGebraResult,
} from "@/types/geogebra";

type AdapterDependencies = {
  loadScript: () => Promise<void>;
  createApplet: (
    parameters: GeoGebraAppletParameters,
  ) => GeoGebraAppletController;
};

type AdapterLoadOptions = {
  id?: string;
  width?: number;
  height?: number;
};

const defaultDependencies = (): AdapterDependencies => ({
  loadScript: loadGeoGebraScript,
  createApplet(parameters) {
    if (typeof window === "undefined" || !window.GGBApplet) {
      throw new Error("GeoGebra did not expose GGBApplet.");
    }
    return new window.GGBApplet(parameters, true);
  },
});

export class GeoGebraAdapter {
  private phaseValue: GeoGebraLifecycle = "idle";
  private epochValue = 0;
  private api?: GeoGebraApi;
  private applet?: GeoGebraAppletController;
  private target?: HTMLElement | string;
  private readonly listeners = new Set<GeoGebraClientListener>();
  private readonly objectListeners = new Map<GeoGebraObjectListenerKind, Set<GeoGebraObjectListener>>();
  private readonly dependencies: AdapterDependencies;

  constructor(dependencies: Partial<AdapterDependencies> = {}) {
    this.dependencies = { ...defaultDependencies(), ...dependencies };
  }

  get phase() {
    return this.phaseValue;
  }

  get epoch() {
    return this.epochValue;
  }

  get listenerCount() {
    return this.listeners.size + [...this.objectListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }

  advanceEpoch() {
    this.epochValue += 1;
    return this.epochValue;
  }

  async load(
    target: HTMLElement | string,
    options: AdapterLoadOptions = {},
  ): Promise<GeoGebraResult<void>> {
    if (this.phaseValue !== "idle") {
      return this.error("invalid_state", `Cannot load while ${this.phaseValue}.`);
    }

    this.phaseValue = "loading";
    this.target = target;
    const epoch = ++this.epochValue;

    try {
      await this.dependencies.loadScript();
    } catch (cause) {
      if (this.isCurrent(epoch, "loading")) {
        this.phaseValue = "idle";
      }
      return this.error(
        "script_unavailable",
        cause instanceof Error ? cause.message : "GeoGebra script unavailable.",
      );
    }

    if (!this.isCurrent(epoch, "loading")) {
      return this.error("stale_epoch", "GeoGebra load completed for a stale epoch.");
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: GeoGebraResult<void>) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      try {
        const applet = this.dependencies.createApplet({
          id: options.id ?? "geotutor-ggb",
          appName: "geometry",
          width: options.width ?? 860,
          height: options.height ?? 520,
          showToolBar: true,
          showAlgebraInput: false,
          showMenuBar: false,
          enableRightClick: false,
          enableShiftDragZoom: true,
          errorDialogsActive: false,
          appletOnLoad: (api) => {
            if (!this.isCurrent(epoch, "loading")) {
              api.remove?.();
              finish(this.error("stale_epoch", "Ignored a stale applet callback."));
              return;
            }
            this.api = api;
            this.phaseValue = "ready";
            finish({ ok: true, value: undefined });
          },
          onError: () => {
            if (this.isCurrent(epoch, "loading")) {
              this.phaseValue = "idle";
            }
            finish(this.error("applet_load_failed", "GeoGebra applet failed to load."));
          },
        });
        this.applet = applet;
        applet.setHTML5Codebase(GEOGEBRA_CODEBASE_URL);
        applet.inject(target);
      } catch (cause) {
        this.phaseValue = "idle";
        finish(
          this.error(
            "applet_load_failed",
            cause instanceof Error ? cause.message : "GeoGebra applet failed to load.",
          ),
        );
      }
    });
  }

  withApi<T>(operation: (api: GeoGebraApi) => T): GeoGebraResult<T> {
    if (this.phaseValue !== "ready" || !this.api) {
      return this.error("invalid_state", `API unavailable while ${this.phaseValue}.`);
    }
    try {
      return { ok: true, value: operation(this.api) };
    } catch (cause) {
      if (cause instanceof MissingApiMethodError) {
        return this.error("api_method_missing", cause.message);
      }
      throw cause;
    }
  }

  registerClientListener(listener: GeoGebraClientListener): GeoGebraResult<void> {
    if (this.listeners.has(listener)) {
      return { ok: true, value: undefined };
    }
    const result = this.withApi((api) => {
      if (!api.registerClientListener) {
        throw new MissingApiMethodError("registerClientListener");
      }
      api.registerClientListener(listener);
    });
    if (!result.ok) return result;
    this.listeners.add(listener);
    return result;
  }

  unregisterClientListener(listener: GeoGebraClientListener): GeoGebraResult<void> {
    if (!this.listeners.has(listener)) {
      return { ok: true, value: undefined };
    }
    const result = this.withApi((api) => {
      api.unregisterClientListener?.(listener);
    });
    if (!result.ok) return result;
    this.listeners.delete(listener);
    return result;
  }

  registerObjectListener(
    kind: GeoGebraObjectListenerKind,
    listener: GeoGebraObjectListener,
  ): GeoGebraResult<void> {
    const listeners = this.objectListeners.get(kind) ?? new Set<GeoGebraObjectListener>();
    if (listeners.has(listener)) return { ok: true, value: undefined };
    const result = this.withApi((api) => {
      const method = objectListenerMethod(api, "register", kind);
      if (!method) throw new MissingApiMethodError(`register${capitalize(kind)}Listener`);
      method(listener);
    });
    if (!result.ok) return result;
    listeners.add(listener);
    this.objectListeners.set(kind, listeners);
    return result;
  }

  unregisterObjectListener(
    kind: GeoGebraObjectListenerKind,
    listener: GeoGebraObjectListener,
  ): GeoGebraResult<void> {
    const listeners = this.objectListeners.get(kind);
    if (!listeners?.has(listener)) return { ok: true, value: undefined };
    const result = this.withApi((api) => objectListenerMethod(api, "unregister", kind)?.(listener));
    if (!result.ok) return result;
    listeners.delete(listener);
    return result;
  }

  reconcileClientListeners(): GeoGebraResult<void> {
    return this.withApi((api) => {
      if (!api.registerClientListener) {
        throw new MissingApiMethodError("registerClientListener");
      }
      for (const listener of this.listeners) {
        api.unregisterClientListener?.(listener);
        api.registerClientListener(listener);
      }
      for (const [kind, listeners] of this.objectListeners) {
        const unregister = objectListenerMethod(api, "unregister", kind);
        const register = objectListenerMethod(api, "register", kind);
        if (!register) throw new MissingApiMethodError(`register${capitalize(kind)}Listener`);
        for (const listener of listeners) {
          unregister?.(listener);
          register(listener);
        }
      }
    });
  }

  suspendListeners(): GeoGebraResult<{
    listenerCountBefore: number;
    resume(): number;
  }> {
    const listenerCountBefore = this.listenerCount;
    const suspended = this.withApi((api) => {
      for (const listener of this.listeners) {
        api.unregisterClientListener?.(listener);
      }
      for (const [kind, listeners] of this.objectListeners) {
        const unregister = objectListenerMethod(api, "unregister", kind);
        for (const listener of listeners) unregister?.(listener);
      }
    });
    if (!suspended.ok) return suspended;
    let resumed = false;
    return {
      ok: true,
      value: {
        listenerCountBefore,
        resume: () => {
          if (!resumed) {
            resumed = true;
            this.reconcileClientListeners();
          }
          return this.listenerCount;
        },
      },
    };
  }

  dispose(): GeoGebraResult<void> {
    if (this.phaseValue === "disposed") {
      return { ok: true, value: undefined };
    }

    this.epochValue += 1;
    if (this.api?.unregisterClientListener) {
      for (const listener of this.listeners) {
        this.api.unregisterClientListener(listener);
      }
    }
    this.listeners.clear();
    if (this.api) {
      for (const [kind, listeners] of this.objectListeners) {
        const unregister = objectListenerMethod(this.api, "unregister", kind);
        for (const listener of listeners) unregister?.(listener);
      }
    }
    this.objectListeners.clear();
    if (this.applet && this.target) {
      this.applet.removeExistingApplet(this.target, false);
    } else {
      this.api?.remove?.();
    }
    this.api = undefined;
    this.applet = undefined;
    this.phaseValue = "disposed";
    return { ok: true, value: undefined };
  }

  private isCurrent(epoch: number, phase: GeoGebraLifecycle) {
    return this.epochValue === epoch && this.phaseValue === phase;
  }

  private error<T>(
    code: "invalid_state" | "script_unavailable" | "applet_load_failed" | "api_method_missing" | "stale_epoch",
    message: string,
  ): GeoGebraResult<T> {
    return { ok: false, error: { code, message, phase: this.phaseValue } };
  }
}

function objectListenerMethod(
  api: GeoGebraApi,
  operation: "register" | "unregister",
  kind: GeoGebraObjectListenerKind,
): ((listener: GeoGebraObjectListener) => void) | undefined {
  const methods = {
    register: {
      add: api.registerAddListener,
      remove: api.registerRemoveListener,
      update: api.registerUpdateListener,
    },
    unregister: {
      add: api.unregisterAddListener,
      remove: api.unregisterRemoveListener,
      update: api.unregisterUpdateListener,
    },
  };
  return methods[operation][kind]?.bind(api);
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

export class MissingApiMethodError extends Error {
  constructor(method: string) {
    super(`GeoGebra API method ${method} is unavailable.`);
  }
}

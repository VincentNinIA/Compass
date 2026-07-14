import type {
  GeoGebraApi,
  GeoGebraEvidence,
  GeoGebraObjectEvidence,
} from "@/types/geogebra";

export const GEOGEBRA_VERSION = "5.4.920.0";
export const GEOGEBRA_DEPLOY_URL = "https://www.geogebra.org/apps/deployggb.js";
export const GEOGEBRA_CODEBASE_URL = `https://www.geogebra.org/apps/${GEOGEBRA_VERSION}/web3d`;

const GIVEN_LABELS = ["A", "B", "AB"] as const;
const INITIAL_CONSTRUCTION = [
  "A = (-2, 0)",
  "B = (2, 0)",
  "AB = Segment(A, B)",
].join("\n");

let scriptPromise: Promise<void> | undefined;

export function loadGeoGebraScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("GeoGebra requires a browser environment."));
  }

  if (window.GGBApplet) {
    return Promise.resolve();
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GEOGEBRA_DEPLOY_URL}"]`,
    );
    const script = existing ?? document.createElement("script");

    const removeListeners = () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      removeListeners();
      if (window.GGBApplet) {
        resolve();
      } else {
        scriptPromise = undefined;
        reject(new Error("GeoGebra loaded without exposing GGBApplet."));
      }
    };
    const handleError = () => {
      removeListeners();
      scriptPromise = undefined;
      reject(new Error("GeoGebra deploy script could not be loaded."));
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    if (!existing) {
      script.src = GEOGEBRA_DEPLOY_URL;
      script.async = true;
      script.dataset.geotutor = "geogebra-deploy";
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
}

export function initializeSpikeConstruction(api: GeoGebraApi): GeoGebraEvidence {
  const commandAccepted = api.evalCommand(INITIAL_CONSTRUCTION);
  if (!commandAccepted) {
    throw new Error("GeoGebra rejected the initial A/B/AB construction.");
  }

  api.setCoordSystem(-5, 5, -3, 3);
  GIVEN_LABELS.forEach((label) => api.setLabelVisible(label, true));

  return collectGeoGebraEvidence(api);
}

export function collectGeoGebraEvidence(api: GeoGebraApi): GeoGebraEvidence {

  const objects: GeoGebraObjectEvidence[] = GIVEN_LABELS.map((label) => ({
    label,
    exists: api.exists(label),
    defined: api.isDefined(label),
    command: String(api.getCommandString(label, false)),
  }));

  if (objects.some((object) => !object.exists || !object.defined)) {
    throw new Error("GeoGebra did not expose every expected object through its API.");
  }

  return {
    version: GEOGEBRA_VERSION,
    objects,
  };
}

export function resetGeoGebraScriptForTests() {
  scriptPromise = undefined;
}

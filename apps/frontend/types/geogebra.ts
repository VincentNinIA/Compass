import type { ValidationResult } from "@/lib/geogebra/validator";
import type { ResetResult } from "@/lib/geogebra/checkpoint";
import type { InitializationResultV1 } from "@/lib/geogebra/exercise-initialization";

export type GeoGebraApi = {
  deleteObject?(label: string): void;
  evalCommand(command: string): boolean;
  exists(label: string): boolean;
  getAllObjectNames?(): string[];
  getBase64?(callback: (base64: string) => void): void;
  getCommandString(label: string, useLocalizedInput?: boolean): string;
  getColor?(label: string): string;
  getObjectType?(label: string): string;
  getObjectName?(index: number): string;
  getObjectNumber?(): number;
  getValue?(label: string): number;
  getXcoord?(label: string): number;
  getYcoord?(label: string): number;
  isDefined(label: string): boolean;
  newConstruction?(): void;
  registerAddListener?(listener: GeoGebraObjectListener): void;
  registerClientListener?(listener: GeoGebraClientListener): void;
  registerRemoveListener?(listener: GeoGebraObjectListener): void;
  registerUpdateListener?(listener: GeoGebraObjectListener): void;
  renameObject?(oldLabel: string, newLabel: string): boolean;
  remove?(): void;
  setBase64?(base64: string, callback?: () => void): void;
  setCoordSystem(xMin: number, xMax: number, yMin: number, yMax: number): void;
  setColor?(label: string, red: number, green: number, blue: number): void;
  setCoords?(label: string, x: number, y: number): void;
  setFixed?(label: string, fixed: boolean, selectionAllowed: boolean): void;
  setLabelVisible(label: string, visible: boolean): void;
  unregisterClientListener?(listener: GeoGebraClientListener): void;
  unregisterAddListener?(listener: GeoGebraObjectListener): void;
  unregisterRemoveListener?(listener: GeoGebraObjectListener): void;
  unregisterUpdateListener?(listener: GeoGebraObjectListener): void;
};

export type GeoGebraClientEvent = {
  type: string;
  target?: unknown;
  argument?: unknown;
};

export type GeoGebraClientListener = (event: GeoGebraClientEvent) => void;
export type GeoGebraObjectListener = (name: string) => void;
export type GeoGebraObjectListenerKind = "add" | "remove" | "update";

export type GeoGebraLifecycle = "idle" | "loading" | "ready" | "disposed";

export type GeoGebraAdapterErrorCode =
  | "invalid_state"
  | "script_unavailable"
  | "applet_load_failed"
  | "api_method_missing"
  | "stale_epoch";

export type GeoGebraAdapterError = {
  code: GeoGebraAdapterErrorCode;
  message: string;
  phase: GeoGebraLifecycle;
};

export type GeoGebraResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GeoGebraAdapterError };

export type SceneObjectOwner =
  | "system"
  | "exercise"
  | "student"
  | "temporary"
  | "hint";
export type SceneObjectKind = "point" | "segment" | "line" | "boolean" | "number" | "other";

export type SceneObject = {
  name: string;
  owner: SceneObjectOwner;
  kind: SceneObjectKind;
};

export type SnapshotObject = SceneObject & {
  command: string;
};

export type ConstructionSnapshot = {
  revision: number;
  objects: SnapshotObject[];
  hash: string;
  complete: boolean;
};

export type CompletedConstructionAction = {
  id: string;
  kind: "add" | "remove" | "update" | "drag";
  affectedNames: string[];
  studentAffectedNames: string[];
  revision: number;
  snapshotHash: string;
};

export type RelationEvidence = {
  id: string;
  relation: "perpendicular" | "passes_midpoint";
  pass: boolean;
  observed: number;
  tolerance: number;
  revision: number;
  objects: string[];
};

export type BisectorValidation = {
  candidate: string;
  revision: number;
  score: 0 | 1 | 2;
  evidence: [RelationEvidence, RelationEvidence];
};

export type ProgressState = {
  score: 0 | 1 | 2;
  criteria: {
    perpendicular: boolean;
    passesMidpoint: boolean;
  };
  revision: number;
  evidenceIds: string[];
  verifying: boolean;
};

export type Checkpoint = {
  base64: string;
  initialHash: string;
  initialObjectNames: string[];
  initialObjects: SceneObject[];
};

export type GeoGebraAppletParameters = {
  id: string;
  appName: "geometry";
  width: number;
  height: number;
  showToolBar: boolean;
  showAlgebraInput: boolean;
  showMenuBar: boolean;
  enableRightClick: boolean;
  enableShiftDragZoom: boolean;
  errorDialogsActive: boolean;
  appletOnLoad(api: GeoGebraApi): void;
  onError(): void;
};

export type GeoGebraAppletController = {
  inject(target: HTMLElement | string): void;
  removeExistingApplet(target: HTMLElement | string, showScreenshot: boolean): void;
  setHTML5Codebase(url: string): void;
};

export type GeoGebraAppletConstructor = new (
  parameters: GeoGebraAppletParameters,
  html5NoWebSimple: boolean,
) => GeoGebraAppletController;

export type GeoGebraObjectEvidence = {
  label: "A" | "B" | "AB";
  exists: boolean;
  defined: boolean;
  command: string;
};

export type GeoGebraEvidence = {
  version: string;
  objects: GeoGebraObjectEvidence[];
};

declare global {
  interface Window {
    GGBApplet?: GeoGebraAppletConstructor;
    __GEOTUTOR_GGB_EVIDENCE__?: GeoGebraEvidence;
    __GEOTUTOR_LAST_ACTION__?: CompletedConstructionAction;
    __GEOTUTOR_VALIDATION__?: ValidationResult;
    __GEOTUTOR_PROGRESS__?: ProgressState;
    __GEOTUTOR_RESET__?: ResetResult;
    __GEOTUTOR_INITIALIZATION__?: InitializationResultV1;
  }
}

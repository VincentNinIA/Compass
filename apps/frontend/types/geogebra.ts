export type GeoGebraApi = {
  evalCommand(command: string): boolean;
  exists(label: string): boolean;
  getCommandString(label: string, useLocalizedInput?: boolean): string;
  isDefined(label: string): boolean;
  setCoordSystem(xMin: number, xMax: number, yMin: number, yMax: number): void;
  setLabelVisible(label: string, visible: boolean): void;
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
  }
}

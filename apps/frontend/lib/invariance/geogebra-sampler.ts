import type { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import type { GeoGebraApi } from "@/types/geogebra";
import {
  INVARIANCE_DISTANCE_TOLERANCE,
  INVARIANCE_DISTANCE_TOLERANCE_VERSION,
  INVARIANCE_POSITION_VERSION,
  type InvarianceSampleEvidence,
  type InvarianceSampleRequest,
} from "./contracts";

export const INVARIANCE_STABILITY_VERSION = "two-consecutive-reads-v1" as const;
export const INVARIANCE_STABILITY_TOLERANCE = 1e-9 as const;
export const INVARIANCE_MAX_STABILITY_READS = 8 as const;

export type InvarianceSamplingErrorCode =
  | "api_unavailable"
  | "api_method_missing"
  | "helper_unavailable"
  | "authority_expired"
  | "invalid_measurement"
  | "point_off_line"
  | "unstable";

export class InvarianceSamplingError extends Error {
  readonly name = "InvarianceSamplingError";

  constructor(readonly code: InvarianceSamplingErrorCode) {
    super(`Invariance sampling failed: ${code}.`);
  }
}

type SamplerOptions = Readonly<{
  maxStabilityReads?: number;
  waitForNextRead?(signal: AbortSignal): Promise<void>;
}>;

type SampleHelpers = Readonly<{
  point: string;
  distanceA: string;
  distanceB: string;
  distanceToCandidate: string;
  origin: string;
  direction: string;
  scale: string;
}>;

type Measurement = Readonly<{
  coords: readonly [number, number];
  pa: number;
  pb: number;
  distanceToCandidate: number;
}>;

/**
 * Closed GeoGebra delegate for the five C01 requests. It creates only helpers
 * owned by the C02 scope and never exposes an arbitrary command surface.
 */
export class GeoGebraInvarianceSampler {
  private readonly maxStabilityReads: number;
  private readonly waitForNextRead: (signal: AbortSignal) => Promise<void>;

  constructor(
    private readonly adapter: GeoGebraAdapter,
    options: SamplerOptions = {},
  ) {
    this.maxStabilityReads = normalizeMaxReads(options.maxStabilityReads);
    this.waitForNextRead = options.waitForNextRead ?? waitForAnimationFrame;
  }

  async sample(
    request: InvarianceSampleRequest,
  ): Promise<InvarianceSampleEvidence> {
    assertCurrent(request);
    if (request.index === 0) this.createHelpers(request);
    const helpers = helperNames(request);
    const target = this.readTarget(request, helpers);
    assertCurrent(request);
    this.movePoint(helpers.point, target);

    const measurement = await this.readStableMeasurement(request, helpers);
    assertCurrent(request);
    if (
      !sameCoordinate(measurement.coords[0], target[0]) ||
      !sameCoordinate(measurement.coords[1], target[1])
    ) {
      throw new InvarianceSamplingError("point_off_line");
    }
    if (measurement.distanceToCandidate > INVARIANCE_DISTANCE_TOLERANCE) {
      throw new InvarianceSamplingError("point_off_line");
    }

    const delta = Math.abs(measurement.pa - measurement.pb);
    if (!Number.isFinite(delta)) {
      throw new InvarianceSamplingError("invalid_measurement");
    }
    return Object.freeze({
      id: `invariance:${request.runId}:${request.revision}:${request.index}`,
      index: request.index,
      parameter: request.parameter,
      coords: Object.freeze([
        measurement.coords[0],
        measurement.coords[1],
      ]) as readonly [number, number],
      pa: measurement.pa,
      pb: measurement.pb,
      delta,
      tolerance: INVARIANCE_DISTANCE_TOLERANCE,
      toleranceVersion: INVARIANCE_DISTANCE_TOLERANCE_VERSION,
      positionVersion: INVARIANCE_POSITION_VERSION,
      pass: delta <= INVARIANCE_DISTANCE_TOLERANCE,
      revision: request.revision,
    });
  }

  private createHelpers(request: InvarianceSampleRequest): void {
    const point = request.scene.createHelper(
      "P",
      `Point(${request.candidateLine})`,
      "point",
    );
    request.scene.createHelper("PA", `Distance(${point}, A)`, "number");
    request.scene.createHelper("PB", `Distance(${point}, B)`, "number");
    request.scene.createHelper(
      "PCandidate",
      `Distance(${point}, ${request.candidateLine})`,
      "number",
    );
    request.scene.createHelper(
      "Origin",
      `ClosestPoint(${request.candidateLine}, Midpoint(A, B))`,
      "point",
    );
    request.scene.createHelper(
      "Direction",
      `UnitVector(${request.candidateLine})`,
      "other",
    );
    request.scene.createHelper("Scale", "Distance(A, B)", "number");
  }

  private readTarget(
    request: InvarianceSampleRequest,
    helpers: SampleHelpers,
  ): readonly [number, number] {
    try {
      const result = this.adapter.withApi((api) => {
        requireCoordinateReaders(api);
        if (!api.getValue) {
          throw new InvarianceSamplingError("api_method_missing");
        }
        for (const name of [helpers.origin, helpers.direction, helpers.scale]) {
          requireDefined(api, name);
        }
        if (
          api.getObjectType(helpers.origin) !== "point" ||
          api.getObjectType(helpers.direction) !== "vector"
        ) {
          throw new InvarianceSamplingError("helper_unavailable");
        }
        const origin = [
          api.getXcoord(helpers.origin),
          api.getYcoord(helpers.origin),
        ] as const;
        const direction = [
          api.getXcoord(helpers.direction),
          api.getYcoord(helpers.direction),
        ] as const;
        const scale = api.getValue(helpers.scale);
        const directionLength = Math.hypot(direction[0], direction[1]);
        const coords = [
          origin[0] + request.parameter * scale * direction[0],
          origin[1] + request.parameter * scale * direction[1],
        ] as const;
        if (
          !origin.every(Number.isFinite) ||
          !direction.every(Number.isFinite) ||
          !Number.isFinite(scale) ||
          scale <= 0 ||
          !sameCoordinate(directionLength, 1) ||
          !coords.every(Number.isFinite)
        ) {
          throw new InvarianceSamplingError("invalid_measurement");
        }
        return coords;
      });
      if (!result.ok) throw new InvarianceSamplingError("api_unavailable");
      return result.value;
    } catch (error) {
      throw samplingError(error);
    }
  }

  private movePoint(
    point: string,
    coords: readonly [number, number],
  ): void {
    try {
      const result = this.adapter.withApi((api) => {
        requireDefined(api, point);
        if (!api.setCoords) {
          throw new InvarianceSamplingError("api_method_missing");
        }
        api.setCoords(point, coords[0], coords[1]);
      });
      if (!result.ok) throw new InvarianceSamplingError("api_unavailable");
    } catch (error) {
      throw samplingError(error);
    }
  }

  private async readStableMeasurement(
    request: InvarianceSampleRequest,
    helpers: SampleHelpers,
  ): Promise<Measurement> {
    let previous: Measurement | undefined;
    for (let attempt = 0; attempt < this.maxStabilityReads; attempt += 1) {
      assertCurrent(request);
      const current = this.readMeasurement(helpers);
      if (previous && sameMeasurement(previous, current)) return current;
      previous = current;
      if (attempt + 1 < this.maxStabilityReads) {
        try {
          await this.waitForNextRead(request.signal);
        } catch (error) {
          if (isAbortError(error) || request.signal.aborted) throw abortError();
          throw new InvarianceSamplingError("unstable");
        }
      }
    }
    throw new InvarianceSamplingError("unstable");
  }

  private readMeasurement(helpers: SampleHelpers): Measurement {
    try {
      const result = this.adapter.withApi((api) => {
        requireCoordinateReaders(api);
        if (!api.getValue) {
          throw new InvarianceSamplingError("api_method_missing");
        }
        for (const name of [
          helpers.point,
          helpers.distanceA,
          helpers.distanceB,
          helpers.distanceToCandidate,
        ]) {
          requireDefined(api, name);
        }
        if (api.getObjectType?.(helpers.point) !== "point") {
          throw new InvarianceSamplingError("helper_unavailable");
        }
        const measurement: Measurement = Object.freeze({
          coords: Object.freeze([
            api.getXcoord(helpers.point),
            api.getYcoord(helpers.point),
          ]) as readonly [number, number],
          pa: api.getValue(helpers.distanceA),
          pb: api.getValue(helpers.distanceB),
          distanceToCandidate: api.getValue(helpers.distanceToCandidate),
        });
        if (!validMeasurement(measurement)) {
          throw new InvarianceSamplingError("invalid_measurement");
        }
        return measurement;
      });
      if (!result.ok) throw new InvarianceSamplingError("api_unavailable");
      return result.value;
    } catch (error) {
      throw samplingError(error);
    }
  }
}

function helperNames(request: InvarianceSampleRequest): SampleHelpers {
  return Object.freeze({
    point: request.scene.helperName("P"),
    distanceA: request.scene.helperName("PA"),
    distanceB: request.scene.helperName("PB"),
    distanceToCandidate: request.scene.helperName("PCandidate"),
    origin: request.scene.helperName("Origin"),
    direction: request.scene.helperName("Direction"),
    scale: request.scene.helperName("Scale"),
  });
}

function requireCoordinateReaders(
  api: GeoGebraApi,
): asserts api is GeoGebraApi & {
  getXcoord(label: string): number;
  getYcoord(label: string): number;
  getObjectType(label: string): string;
} {
  if (!api.getXcoord || !api.getYcoord || !api.getObjectType) {
    throw new InvarianceSamplingError("api_method_missing");
  }
}

function requireDefined(api: GeoGebraApi, name: string): void {
  if (!api.exists(name) || !api.isDefined(name)) {
    throw new InvarianceSamplingError("helper_unavailable");
  }
}

function validMeasurement(measurement: Measurement): boolean {
  return (
    measurement.coords.every(Number.isFinite) &&
    Number.isFinite(measurement.pa) &&
    measurement.pa >= 0 &&
    Number.isFinite(measurement.pb) &&
    measurement.pb >= 0 &&
    Number.isFinite(measurement.distanceToCandidate) &&
    measurement.distanceToCandidate >= 0
  );
}

function sameMeasurement(left: Measurement, right: Measurement): boolean {
  return (
    sameCoordinate(left.coords[0], right.coords[0]) &&
    sameCoordinate(left.coords[1], right.coords[1]) &&
    sameCoordinate(left.pa, right.pa) &&
    sameCoordinate(left.pb, right.pb) &&
    sameCoordinate(left.distanceToCandidate, right.distanceToCandidate)
  );
}

function sameCoordinate(left: number, right: number): boolean {
  return Math.abs(left - right) <= INVARIANCE_STABILITY_TOLERANCE;
}

function normalizeMaxReads(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 2
    ? Math.min(value, 32)
    : INVARIANCE_MAX_STABILITY_READS;
}

function assertCurrent(request: InvarianceSampleRequest): void {
  if (request.signal.aborted) throw abortError();
  if (!request.isAuthorityCurrent()) {
    throw new InvarianceSamplingError("authority_expired");
  }
}

function abortError(): DOMException {
  return new DOMException("Invariance sampling cancelled.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function samplingError(error: unknown): InvarianceSamplingError {
  return error instanceof InvarianceSamplingError
    ? error
    : new InvarianceSamplingError("api_unavailable");
}

function waitForAnimationFrame(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      if (frame !== undefined && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame);
      }
      if (timer !== undefined) clearTimeout(timer);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(done);
    } else {
      timer = setTimeout(done, 16);
    }
  });
}

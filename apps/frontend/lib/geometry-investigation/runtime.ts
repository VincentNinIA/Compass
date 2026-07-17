import {
  parseGeometryInvestigationV1,
  type GeometryFactV1,
  type GeometryInvestigationV1,
  type GeometryWorldV2,
} from "./contracts";

export type GeometryInvestigationRuntimeCallbacks = Readonly<{
  onWorld?(world: GeometryWorldV2): void;
  onFacts?(facts: readonly GeometryFactV1[]): void;
  onError?(error: GeometryInvestigationRuntimeError): void;
}>;

export type GeometryInvestigationRuntimeError = Readonly<{
  code:
    | "activity_invalid"
    | "workspace_unavailable"
    | "stale_revision"
    | "operation_failed";
  message: string;
}>;

export type GeometryInvestigationRuntimeServices<
  TAdapter,
  TObservation,
  TEngine,
  TGateway,
  TCheckpoints,
  TPolicy,
> = Readonly<{
  adapter: TAdapter;
  observation: TObservation;
  engine: TEngine;
  gateway: TGateway;
  checkpoints: TCheckpoints;
  policy: TPolicy;
  callbacks: GeometryInvestigationRuntimeCallbacks;
}>;

export type GeometryInvestigationRuntimeDependencies<
  TAdapter,
  TObservation,
  TEngine,
  TGateway,
  TCheckpoints,
  TPolicy,
> = Omit<
  GeometryInvestigationRuntimeServices<
    TAdapter,
    TObservation,
    TEngine,
    TGateway,
    TCheckpoints,
    TPolicy
  >,
  "callbacks"
> & {
  callbacks?: GeometryInvestigationRuntimeCallbacks;
};

/**
 * Composition boundary for the public investigation harness.
 *
 * T22-C01 deliberately exposes no start, mutation, restore or demonstration
 * method. Later cards attach those operations while reusing the injected
 * authorities instead of creating parallel implementations.
 */
export class GeometryInvestigationRuntime<
  TAdapter,
  TObservation,
  TEngine,
  TGateway,
  TCheckpoints,
  TPolicy,
> {
  readonly activity: Readonly<GeometryInvestigationV1>;
  readonly services: GeometryInvestigationRuntimeServices<
    TAdapter,
    TObservation,
    TEngine,
    TGateway,
    TCheckpoints,
    TPolicy
  >;

  constructor(
    activityInput: unknown,
    dependencies: GeometryInvestigationRuntimeDependencies<
      TAdapter,
      TObservation,
      TEngine,
      TGateway,
      TCheckpoints,
      TPolicy
    >,
  ) {
    this.activity = deepFreeze(parseGeometryInvestigationV1(activityInput));
    this.services = Object.freeze({
      adapter: dependencies.adapter,
      observation: dependencies.observation,
      engine: dependencies.engine,
      gateway: dependencies.gateway,
      checkpoints: dependencies.checkpoints,
      policy: dependencies.policy,
      callbacks: Object.freeze({ ...dependencies.callbacks }),
    });
    Object.freeze(this);
  }
}

export function createGeometryInvestigationRuntime<
  TAdapter,
  TObservation,
  TEngine,
  TGateway,
  TCheckpoints,
  TPolicy,
>(
  activityInput: unknown,
  dependencies: GeometryInvestigationRuntimeDependencies<
    TAdapter,
    TObservation,
    TEngine,
    TGateway,
    TCheckpoints,
    TPolicy
  >,
): GeometryInvestigationRuntime<
  TAdapter,
  TObservation,
  TEngine,
  TGateway,
  TCheckpoints,
  TPolicy
> {
  return new GeometryInvestigationRuntime(activityInput, dependencies);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

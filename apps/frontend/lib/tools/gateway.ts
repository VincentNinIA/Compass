import { isToolName, type ToolArguments, type ToolName } from "./contracts";

export type ToolPhase = "idle" | "exercise_confirmed" | "constructing" | "completed";

export type GatewayCall = {
  callId: string;
  name: string;
  arguments: string;
};

export type GatewayContext = {
  turnId: string;
  phase: ToolPhase;
  epoch?: number;
  revision: number;
  directive?: {
    directiveId: string;
    sourceActionId?: string | null;
    evidenceIds?: readonly string[];
    authorize(call: {
      callId: string;
      name: ToolName;
      revision: number;
    }): boolean;
  };
};

export type ToolHandlerResult = {
  data: unknown;
  evidenceIds?: string[];
};

export type GatewayErrorCode =
  | "unknown_tool"
  | "invalid_arguments"
  | "invalid_phase"
  | "stale_revision"
  | "rejected_stale"
  | "budget_exceeded"
  | "object_missing"
  | "plan_unconfirmed"
  | "highlight_active"
  | "rollback_failed"
  | "execution_failed";

export type GatewayEnvelope =
  | {
      ok: true;
      callId: string;
      revision: number;
      data: unknown;
      evidenceIds: string[];
    }
  | {
      ok: false;
      callId: string;
      revision: number;
      error: { code: GatewayErrorCode; message: string };
      evidenceIds: string[];
    };

export type ToolHandlers = {
  [Name in ToolName]: (
    arguments_: ToolArguments[Name],
    context: GatewayContext,
  ) => Promise<ToolHandlerResult> | ToolHandlerResult;
};

export class ToolHandlerError extends Error {
  constructor(
    readonly code: Extract<
      GatewayErrorCode,
      "object_missing" | "plan_unconfirmed" | "highlight_active" | "rollback_failed" | "stale_revision"
    >,
    message: string,
  ) {
    super(message);
    this.name = "ToolHandlerError";
  }
}

type GatewayLimits = {
  maxArgumentBytes: number;
  maxCallsPerTurn: number;
  maxMutationsPerTurn: number;
};

const DEFAULT_LIMITS: GatewayLimits = {
  maxArgumentBytes: 8 * 1024,
  maxCallsPerTurn: 4,
  maxMutationsPerTurn: 1,
};

const MUTATING_TOOLS = new Set<ToolName>(["initialize_exercise", "highlight_objects"]);
const ALLOWED_PHASES: Record<ToolName, readonly ToolPhase[]> = {
  read_construction: ["constructing", "completed"],
  initialize_exercise: ["exercise_confirmed"],
  check_relation: ["constructing", "completed"],
  highlight_objects: ["constructing"],
};

export class ToolGateway {
  private readonly results = new Map<string, Promise<GatewayEnvelope>>();
  private readonly usage = new Map<string, { calls: number; mutations: number }>();
  private readonly limits: GatewayLimits;

  constructor(
    private readonly handlers: ToolHandlers,
    limits: Partial<GatewayLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  execute(call: GatewayCall, context: GatewayContext): Promise<GatewayEnvelope> {
    const cached = this.results.get(call.callId);
    if (cached) return cached;
    const pending = this.executeOnce(call, context);
    this.results.set(call.callId, pending);
    return pending;
  }

  private async executeOnce(
    call: GatewayCall,
    context: GatewayContext,
  ): Promise<GatewayEnvelope> {
    if (!validId(call.callId) || !isToolName(call.name)) {
      return failure(call.callId, context.revision, "unknown_tool", "Tool is not allowed.");
    }
    const name = call.name;
    if (
      context.directive &&
      !context.directive.authorize({
        callId: call.callId,
        name,
        revision: context.revision,
      })
    ) {
      return failure(
        call.callId,
        context.revision,
        "rejected_stale",
        "Directive is stale or the tool call is not correlated.",
      );
    }
    const parsed = parseArguments(name, call.arguments, this.limits.maxArgumentBytes);
    if (!parsed.ok) {
      return failure(call.callId, context.revision, "invalid_arguments", parsed.message);
    }
    if (!ALLOWED_PHASES[name].includes(context.phase)) {
      return failure(call.callId, context.revision, "invalid_phase", "Tool is not allowed in this phase.");
    }
    if (expectedRevision(name, parsed.value) !== context.revision) {
      return failure(call.callId, context.revision, "stale_revision", "Construction revision is stale.");
    }
    if (!this.consumeBudget(name, context.turnId)) {
      return failure(call.callId, context.revision, "budget_exceeded", "Tool budget is exhausted.");
    }
    try {
      const handler = this.handlers[name] as (
        arguments_: ToolArguments[ToolName],
        context: GatewayContext,
      ) => Promise<ToolHandlerResult> | ToolHandlerResult;
      const result = await handler(parsed.value, context);
      return {
        ok: true,
        callId: call.callId,
        revision: context.revision,
        data: result.data,
        evidenceIds: [...(result.evidenceIds ?? [])],
      };
    } catch (error) {
      if (error instanceof ToolHandlerError) {
        return failure(call.callId, context.revision, error.code, error.message);
      }
      return failure(
        call.callId,
        context.revision,
        "execution_failed",
        "Tool execution failed safely.",
      );
    }
  }

  private consumeBudget(name: ToolName, turnId: string): boolean {
    const current = this.usage.get(turnId) ?? { calls: 0, mutations: 0 };
    const mutations = current.mutations + Number(MUTATING_TOOLS.has(name));
    if (current.calls + 1 > this.limits.maxCallsPerTurn) return false;
    if (mutations > this.limits.maxMutationsPerTurn) return false;
    this.usage.set(turnId, { calls: current.calls + 1, mutations });
    return true;
  }
}

type ParsedArguments<Name extends ToolName> =
  | { ok: true; value: ToolArguments[Name] }
  | { ok: false; message: string };

function parseArguments<Name extends ToolName>(
  name: Name,
  source: string,
  maxBytes: number,
): ParsedArguments<Name> {
  if (new TextEncoder().encode(source).byteLength > maxBytes) {
    return { ok: false, message: "Tool arguments are too large." };
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, message: "Tool arguments are not valid JSON." };
  }
  if (!plainObject(value)) return { ok: false, message: "Tool arguments must be an object." };
  const valid =
    name === "read_construction"
      ? exactKeys(value, ["revision"]) && revisionValue(value.revision)
      : name === "initialize_exercise"
        ? exactKeys(value, ["planId", "expectedRevision"]) &&
          boundedString(value.planId, 64) &&
          revisionValue(value.expectedRevision)
        : name === "check_relation"
          ? exactKeys(value, ["relation", "objects", "revision"]) &&
            ["perpendicular", "passes_midpoint"].includes(String(value.relation)) &&
            objectNames(value.objects) &&
            revisionValue(value.revision)
          : exactKeys(value, ["names", "style", "ttlMs", "revision"]) &&
            objectNames(value.names) &&
            ["focus", "hint"].includes(String(value.style)) &&
            integerBetween(value.ttlMs, 100, 5_000) &&
            revisionValue(value.revision);
  return valid
    ? { ok: true, value: value as ToolArguments[Name] }
    : { ok: false, message: "Tool arguments do not match the strict schema." };
}

function expectedRevision(name: ToolName, arguments_: ToolArguments[ToolName]): number {
  return name === "initialize_exercise"
    ? (arguments_ as ToolArguments["initialize_exercise"]).expectedRevision
    : (arguments_ as Exclude<ToolArguments[ToolName], ToolArguments["initialize_exercise"]>)
        .revision;
}

function failure(
  callId: string,
  revision: number,
  code: GatewayErrorCode,
  message: string,
): GatewayEnvelope {
  return { ok: false, callId, revision, error: { code, message }, evidenceIds: [] };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function revisionValue(value: unknown): value is number {
  return integerBetween(value, 0, Number.MAX_SAFE_INTEGER);
}

function integerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function objectNames(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 4 &&
    new Set(value).size === value.length &&
    value.every((name) => typeof name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name))
  );
}

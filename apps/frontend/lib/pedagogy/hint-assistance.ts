import type { ToolName } from "@/lib/tools/contracts";
import type { HelpLevel, PedagogyState } from "./state";

export type DeliveredHelpLevel = Exclude<HelpLevel, 0>;
export type HintSource = "proactive" | "explicit";
export type HintCleanupPolicy =
  | "none"
  | "restore_visual_hint"
  | "remove_helpers_or_restore_checkpoint";

export type HintAuthorization = Readonly<{
  directiveId: string;
  level: DeliveredHelpLevel;
  source: HintSource;
  allowedTools: readonly ToolName[];
  requiresConfirmation: boolean;
  cleanupPolicy: HintCleanupPolicy;
}>;

export type HintDirectiveLike = Readonly<{
  directiveId: string;
  kind: "explicit" | "proactive" | "completion";
  helpLevel: DeliveredHelpLevel;
  baseRevision: number;
}>;

type HintLevelProfile = Readonly<{
  level: DeliveredHelpLevel;
  allowedTools: readonly ToolName[];
  requiresConfirmation: boolean;
  cleanupPolicy: HintCleanupPolicy;
}>;

const NO_TOOLS: readonly ToolName[] = Object.freeze([]);
const HIGHLIGHT_ONLY: readonly ToolName[] = Object.freeze([
  "highlight_objects",
]);

export const HINT_LEVEL_MATRIX: Readonly<
  Record<DeliveredHelpLevel, HintLevelProfile>
> = Object.freeze({
  1: Object.freeze({
    level: 1,
    allowedTools: NO_TOOLS,
    requiresConfirmation: false,
    cleanupPolicy: "none",
  }),
  2: Object.freeze({
    level: 2,
    allowedTools: NO_TOOLS,
    requiresConfirmation: false,
    cleanupPolicy: "none",
  }),
  3: Object.freeze({
    level: 3,
    allowedTools: HIGHLIGHT_ONLY,
    requiresConfirmation: false,
    cleanupPolicy: "restore_visual_hint",
  }),
  4: Object.freeze({
    level: 4,
    allowedTools: NO_TOOLS,
    requiresConfirmation: true,
    cleanupPolicy: "remove_helpers_or_restore_checkpoint",
  }),
});

export function nextUsefulHelpLevel(current: HelpLevel): DeliveredHelpLevel {
  if (current <= 0) return 1;
  if (current === 1) return 2;
  if (current === 2) return 3;
  return 4;
}

export function getHintLevelProfile(
  level: DeliveredHelpLevel,
): HintLevelProfile {
  return HINT_LEVEL_MATRIX[level];
}

export function createHintAuthorization(
  state: PedagogyState,
  directive: HintDirectiveLike,
): HintAuthorization | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(directive.directiveId)) return null;
  if (directive.baseRevision !== state.revision) return null;
  if (directive.kind === "completion") return null;

  if (directive.kind === "proactive") {
    const profile = HINT_LEVEL_MATRIX[1];
    return freezeAuthorization({
      directiveId: directive.directiveId,
      source: "proactive",
      ...profile,
    });
  }

  const expectedLevel = nextUsefulHelpLevel(state.helpLevel);
  if (directive.helpLevel !== expectedLevel) return null;
  const profile = HINT_LEVEL_MATRIX[expectedLevel];
  return freezeAuthorization({
    directiveId: directive.directiveId,
    source: "explicit",
    ...profile,
  });
}

export type HintConfirmationChallenge = Readonly<{
  token: string;
  directiveId: string;
  revision: number;
  expiresAt: number;
}>;

type ConfirmationRecord = HintConfirmationChallenge & { consumed: boolean };

export class HintConfirmationLedger {
  private readonly records = new Map<string, ConfirmationRecord>();

  constructor(
    private readonly createToken: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 30_000,
  ) {}

  issue(
    authorization: HintAuthorization,
    revision: number,
  ): HintConfirmationChallenge | null {
    if (
      authorization.source !== "explicit" ||
      authorization.level !== 4 ||
      !authorization.requiresConfirmation ||
      !Number.isInteger(revision) ||
      revision < 0
    ) {
      return null;
    }
    let token: string;
    try {
      token = this.createToken();
    } catch {
      return null;
    }
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(token) || this.records.has(token)) {
      return null;
    }
    const challenge = Object.freeze({
      token,
      directiveId: authorization.directiveId,
      revision,
      expiresAt: this.now() + this.ttlMs,
    });
    this.records.set(token, { ...challenge, consumed: false });
    return challenge;
  }

  consume(token: string, directiveId: string, revision: number): boolean {
    const record = this.records.get(token);
    if (
      !record ||
      record.consumed ||
      record.directiveId !== directiveId ||
      record.revision !== revision ||
      this.now() > record.expiresAt
    ) {
      return false;
    }
    record.consumed = true;
    return true;
  }

  invalidate(directiveId: string): void {
    for (const [token, record] of this.records) {
      if (record.directiveId === directiveId) this.records.delete(token);
    }
  }

  clear(): void {
    this.records.clear();
  }
}

function freezeAuthorization(
  authorization: Omit<HintAuthorization, "allowedTools"> & {
    allowedTools: readonly ToolName[];
  },
): HintAuthorization {
  return Object.freeze({
    ...authorization,
    allowedTools: Object.freeze([...authorization.allowedTools]),
  });
}

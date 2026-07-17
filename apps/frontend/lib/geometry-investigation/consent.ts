export const GEOMETRY_CONSENT_MAX_TTL_MS = 120_000 as const;

export type GeometryVariationConsentBindingV1 = Readonly<{
  activityId: string;
  epoch: number;
  revision: number;
  action: "create_geometry_variation";
  target: "convex" | "concave" | "crossed";
  movingPoint: "A" | "B" | "C" | "D";
}>;

export type GeometryConsentValidation =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason: "missing" | "expired" | "used" | "binding_mismatch";
    }>;

type ConsentRecord = Readonly<{
  binding: GeometryVariationConsentBindingV1;
  expiresAt: number;
}>;

export class GeometryConsentTokenStoreV1 {
  private readonly active = new Map<string, ConsentRecord>();
  private readonly used = new Set<string>();
  private sequence = 0;

  constructor(
    private readonly dependencies: Readonly<{
      now?: () => number;
      createToken?: () => string;
    }> = {},
  ) {}

  issue(
    binding: GeometryVariationConsentBindingV1,
    ttlMs = 60_000,
  ): string {
    const boundedTtl = Math.max(1_000, Math.min(GEOMETRY_CONSENT_MAX_TTL_MS, ttlMs));
    const token = this.dependencies.createToken?.() ?? this.defaultToken();
    if (!/^[A-Za-z0-9_.:-]{16,160}$/.test(token) || this.active.has(token)) {
      throw new Error("Consent token factory produced an invalid or duplicate token.");
    }
    this.active.set(token, {
      binding: { ...binding },
      expiresAt: this.now() + boundedTtl,
    });
    return token;
  }

  validate(
    token: string,
    binding: GeometryVariationConsentBindingV1,
  ): GeometryConsentValidation {
    if (this.used.has(token)) return { ok: false, reason: "used" };
    const record = this.active.get(token);
    if (!record) return { ok: false, reason: "missing" };
    if (this.now() > record.expiresAt) {
      this.active.delete(token);
      return { ok: false, reason: "expired" };
    }
    return sameBinding(record.binding, binding)
      ? { ok: true }
      : { ok: false, reason: "binding_mismatch" };
  }

  consume(
    token: string,
    binding: GeometryVariationConsentBindingV1,
  ): GeometryConsentValidation {
    const validation = this.validate(token, binding);
    if (!validation.ok) return validation;
    this.active.delete(token);
    this.used.add(token);
    return { ok: true };
  }

  revokeActivity(activityId: string): number {
    let revoked = 0;
    for (const [token, record] of this.active) {
      if (record.binding.activityId !== activityId) continue;
      this.active.delete(token);
      revoked += 1;
    }
    return revoked;
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  private defaultToken(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `ggb-consent:${uuid}`;
    this.sequence += 1;
    return `ggb-consent:fallback:${Date.now()}:${this.sequence}`;
  }
}

function sameBinding(
  left: GeometryVariationConsentBindingV1,
  right: GeometryVariationConsentBindingV1,
): boolean {
  return (
    left.activityId === right.activityId &&
    left.epoch === right.epoch &&
    left.revision === right.revision &&
    left.action === right.action &&
    left.target === right.target &&
    left.movingPoint === right.movingPoint
  );
}

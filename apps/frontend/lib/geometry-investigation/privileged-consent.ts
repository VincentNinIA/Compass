export type GeometryPrivilegedConsentBindingV1 =
  | Readonly<{
      activityId: string;
      epoch: number;
      revision: number;
      action: "restore_geometry_checkpoint";
      checkpointId: string;
    }>
  | Readonly<{
      activityId: string;
      epoch: number;
      revision: number;
      action: "demonstrate_geometry_step";
      stepId: string;
      speed: "reduced" | "normal";
    }>;

type RecordV1 = Readonly<{
  binding: GeometryPrivilegedConsentBindingV1;
  expiresAt: number;
}>;

export class GeometryPrivilegedConsentStoreV1 {
  private readonly active = new Map<string, RecordV1>();
  private readonly used = new Set<string>();
  private sequence = 0;

  constructor(
    private readonly dependencies: Readonly<{
      now?: () => number;
      createToken?: () => string;
    }> = {},
  ) {}

  issue(binding: GeometryPrivilegedConsentBindingV1, ttlMs = 60_000): string {
    const token = this.dependencies.createToken?.() ?? this.defaultToken();
    if (!/^[A-Za-z0-9_.:-]{16,160}$/.test(token) || this.active.has(token)) {
      throw new Error("Privileged token is invalid or duplicated.");
    }
    this.active.set(token, {
      binding: cloneBinding(binding),
      expiresAt: this.now() + Math.max(1_000, Math.min(120_000, ttlMs)),
    });
    return token;
  }

  validate(token: string, binding: GeometryPrivilegedConsentBindingV1) {
    if (this.used.has(token)) return { ok: false as const, reason: "used" as const };
    const record = this.active.get(token);
    if (!record) return { ok: false as const, reason: "missing" as const };
    if (this.now() > record.expiresAt) {
      this.active.delete(token);
      return { ok: false as const, reason: "expired" as const };
    }
    return JSON.stringify(record.binding) === JSON.stringify(binding)
      ? { ok: true as const }
      : { ok: false as const, reason: "binding_mismatch" as const };
  }

  consume(token: string, binding: GeometryPrivilegedConsentBindingV1) {
    const validation = this.validate(token, binding);
    if (!validation.ok) return validation;
    this.active.delete(token);
    this.used.add(token);
    return validation;
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
    if (uuid) return `ggb-privileged:${uuid}`;
    this.sequence += 1;
    return `ggb-privileged:fallback:${Date.now()}:${this.sequence}`;
  }
}

function cloneBinding(
  binding: GeometryPrivilegedConsentBindingV1,
): GeometryPrivilegedConsentBindingV1 {
  return { ...binding };
}

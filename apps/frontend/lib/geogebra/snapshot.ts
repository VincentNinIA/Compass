import type { GeoGebraAdapter } from "./adapter";
import type { SceneRegistry } from "./scene";
import type { ConstructionSnapshot, SnapshotObject } from "@/types/geogebra";

export type SnapshotResult =
  | { ok: true; value: ConstructionSnapshot }
  | {
      ok: false;
      error: { code: "adapter_unavailable" | "incomplete"; message: string };
      value: ConstructionSnapshot;
    };

export const SNAPSHOT_NORMALIZATION_VERSION = 1;

export class SnapshotService {
  private revision = 0;
  private lastHash = "";

  constructor(
    private readonly adapter: GeoGebraAdapter,
    private readonly registry: SceneRegistry,
  ) {}

  capture(): SnapshotResult {
    const first = this.readOnce();
    if (!first.ok && first.error.code === "incomplete") {
      return this.readOnce();
    }
    return first;
  }

  private readOnce(): SnapshotResult {
    const result = this.adapter.withApi((api) => {
      const objects: SnapshotObject[] = [];
      const missing: string[] = [];
      for (const registered of this.registry.list()) {
        if (!api.exists(registered.name) || !api.isDefined(registered.name)) {
          missing.push(registered.name);
          continue;
        }
        objects.push({
          ...registered,
          command: normalizeCommand(
            String(api.getCommandString(registered.name, false)),
          ),
        });
      }
      objects.sort((left, right) => left.name.localeCompare(right.name));
      const hash = stableHash(
        JSON.stringify({ version: SNAPSHOT_NORMALIZATION_VERSION, objects }),
      );
      return { objects, missing, hash };
    });

    if (!result.ok) {
      const value = this.incompleteSnapshot([], "unavailable");
      return {
        ok: false,
        error: { code: "adapter_unavailable", message: result.error.message },
        value,
      };
    }

    if (result.value.missing.length > 0) {
      const value = this.incompleteSnapshot(result.value.objects, result.value.hash);
      return {
        ok: false,
        error: {
          code: "incomplete",
          message: `Objects disappeared during snapshot: ${result.value.missing.join(", ")}.`,
        },
        value,
      };
    }

    if (result.value.hash !== this.lastHash) {
      this.lastHash = result.value.hash;
      this.revision += 1;
    }
    return {
      ok: true,
      value: {
        revision: this.revision,
        objects: result.value.objects,
        hash: result.value.hash,
        complete: true,
      },
    };
  }

  private incompleteSnapshot(objects: SnapshotObject[], hash: string) {
    return {
      revision: this.revision,
      objects,
      hash,
      complete: false,
    } satisfies ConstructionSnapshot;
  }
}

export function normalizeCommand(command: string) {
  return command
    .replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, (token) => {
      const value = Number(token);
      if (!Number.isFinite(value)) return token;
      const normalized = Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e9) / 1e9;
      return String(normalized);
    })
    .replace(/\s+/g, " ")
    .replace(/\s*([,=\[\]()])\s*/g, "$1")
    .trim();
}

export function stableHash(input: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

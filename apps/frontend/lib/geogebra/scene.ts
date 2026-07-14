import type { GeoGebraAdapter } from "./adapter";
import type { SceneObject, SceneObjectKind, SceneObjectOwner } from "@/types/geogebra";

export type SceneError = {
  code: "adapter_unavailable" | "label_collision" | "command_rejected" | "verification_failed";
  message: string;
  labels: string[];
};

export type SceneResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SceneError };

export const BOOTSTRAP_OBJECTS = [
  { name: "A", command: "A = (-2, 0)", kind: "point" },
  { name: "B", command: "B = (2, 0)", kind: "point" },
  { name: "AB", command: "AB = Segment(A, B)", kind: "segment" },
] as const;

export const EXERCISE_OBJECTS = [
  { name: "A", command: "A = (-3, 0)", kind: "point" },
  { name: "B", command: "B = (3, 0)", kind: "point" },
  { name: "AB", command: "AB = Segment(A, B)", kind: "segment" },
] as const;

export class SceneRegistry {
  private readonly objects = new Map<string, SceneObject>();

  list(): SceneObject[] {
    return [...this.objects.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  get(name: string) {
    return this.objects.get(name);
  }

  register(name: string, owner: SceneObjectOwner, kind: SceneObjectKind = "other") {
    const object = { name, owner, kind } satisfies SceneObject;
    this.objects.set(name, object);
    return object;
  }

  remove(name: string) {
    this.objects.delete(name);
  }

  replace(objects: SceneObject[]) {
    this.objects.clear();
    for (const object of objects) this.objects.set(object.name, object);
  }
}

export function initializeMinimalScene(
  adapter: GeoGebraAdapter,
  registry: SceneRegistry,
): SceneResult<SceneObject[]> {
  return initializeCanonicalScene(adapter, registry, BOOTSTRAP_OBJECTS, "system");
}

export function initializeExerciseScene(
  adapter: GeoGebraAdapter,
  registry: SceneRegistry,
): SceneResult<SceneObject[]> {
  return initializeCanonicalScene(adapter, registry, EXERCISE_OBJECTS, "exercise");
}

function initializeCanonicalScene(
  adapter: GeoGebraAdapter,
  registry: SceneRegistry,
  objects: typeof BOOTSTRAP_OBJECTS | typeof EXERCISE_OBJECTS,
  owner: Extract<SceneObjectOwner, "system" | "exercise">,
): SceneResult<SceneObject[]> {
  const result = adapter.withApi((api): SceneResult<SceneObject[]> => {
    const collisions = objects.filter(({ name }) => api.exists(name)).map(
      ({ name }) => name,
    );
    if (collisions.length > 0) {
      return {
        ok: false,
        error: {
          code: "label_collision",
          message: `Reserved labels already exist: ${collisions.join(", ")}.`,
          labels: collisions,
        },
      };
    }

    const created: string[] = [];
    for (const object of objects) {
      if (!api.evalCommand(object.command)) {
        rollback(api.deleteObject, created);
        return {
          ok: false,
          error: {
            code: "command_rejected",
            message: `GeoGebra rejected ${object.name}.`,
            labels: [...created, object.name],
          },
        };
      }
      created.push(object.name);
    }

    const invalid = created.filter((name) => !api.exists(name) || !api.isDefined(name));
    if (invalid.length > 0) {
      rollback(api.deleteObject, created);
      return {
        ok: false,
        error: {
          code: "verification_failed",
          message: `Created labels are not valid: ${invalid.join(", ")}.`,
          labels: invalid,
        },
      };
    }

    for (const name of created) {
      api.setFixed?.(name, true, false);
      api.setLabelVisible(name, true);
    }

    const published = objects.map(({ name, kind }) => ({
      name,
      owner,
      kind,
    }));
    registry.replace(published);
    return { ok: true, value: registry.list() };
  });

  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: "adapter_unavailable",
        message: result.error.message,
        labels: [],
      },
    };
  }
  return result.value;
}

function rollback(
  deleteObject: ((label: string) => void) | undefined,
  labels: string[],
) {
  if (!deleteObject) return;
  for (const label of labels.toReversed()) deleteObject(label);
}

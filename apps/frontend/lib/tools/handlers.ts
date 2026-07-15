import type { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import type { SceneRegistry } from "@/lib/geogebra/scene";
import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import type {
  ExerciseInitializationOptions,
  InitializationResultV1,
} from "@/lib/geogebra/exercise-initialization";
import type { SnapshotService } from "@/lib/geogebra/snapshot";
import type { PerpendicularBisectorValidator } from "@/lib/geogebra/validator";
import type { ToolHandlers } from "./gateway";
import { ToolHandlerError } from "./gateway";
import type { HighlightManager } from "./highlight";

type CoreHandlerDependencies = {
  adapter: GeoGebraAdapter;
  registry: SceneRegistry;
  snapshots: SnapshotService;
  validator: PerpendicularBisectorValidator;
  getConfirmedExercise(planId: string): ExerciseConfirmedV1 | undefined;
  initializeExercise(
    confirmation: ExerciseConfirmedV1,
    options?: ExerciseInitializationOptions,
  ): Promise<InitializationResultV1>;
  highlights: HighlightManager;
};

export function createCoreToolHandlers(
  dependencies: CoreHandlerDependencies,
): ToolHandlers {
  return {
    read_construction(arguments_, context) {
      const snapshot = dependencies.snapshots.capture();
      if (!snapshot.ok || snapshot.value.revision !== context.revision) {
        throw new ToolHandlerError("stale_revision", "Construction changed during the read.");
      }
      return {
        data: snapshot.value,
        evidenceIds: [`snapshot-r${snapshot.value.revision}-${snapshot.value.hash}`],
      };
    },

    async initialize_exercise(arguments_, context) {
      assertAuthority(context);
      const confirmation = dependencies.getConfirmedExercise(arguments_.planId);
      if (!confirmation) {
        throw new ToolHandlerError("plan_unconfirmed", "Exercise plan is not confirmed.");
      }
      const initialized = await dependencies.initializeExercise(confirmation, {
        signal: context.signal,
        isAuthorityCurrent: context.isAuthorityCurrent,
      });
      assertAuthority(context);
      if (
        initialized.status !== "initialized" &&
        initialized.status !== "already_initialized"
      ) {
        throw new ToolHandlerError("rollback_failed", "Exercise initialization failed safely.");
      }
      return {
        data: {
          planId: arguments_.planId,
          status: initialized.status,
          objects:
            initialized.status === "initialized" ? initialized.created : ["A", "B", "AB"],
          snapshotHash: initialized.snapshotHash,
        },
      };
    },

    check_relation(arguments_, context) {
      assertRelationTuple(arguments_.relation, arguments_.objects, dependencies.registry);
      const missing = arguments_.objects.filter((name) => !dependencies.registry.get(name));
      if (missing.length > 0) {
        throw new ToolHandlerError("object_missing", "A relation object does not exist.");
      }
      const candidate = arguments_.objects[0];
      const validation = dependencies.validator.validate(
        context.revision,
        candidate,
        context.isAuthorityCurrent,
      );
      assertAuthority(context);
      if (!validation.ok) {
        throw new ToolHandlerError("object_missing", "The requested relation cannot be measured.");
      }
      const evidence = validation.value.evidence.find(
        (entry) => entry.relation === arguments_.relation,
      );
      if (!evidence) throw new Error("Relation evidence is unavailable.");
      if (!sameTuple(evidence.objects, arguments_.objects)) {
        throw new ToolHandlerError(
          "invalid_arguments",
          "Relation evidence does not match the authorized object tuple.",
        );
      }
      return {
        data: {
          relation: evidence.relation,
          pass: evidence.pass,
          observed: evidence.observed,
          tolerance: evidence.tolerance,
          objects: evidence.objects,
          revision: evidence.revision,
        },
        evidenceIds: [evidence.id],
      };
    },

    highlight_objects(arguments_, context) {
      assertAuthority(context);
      return { data: dependencies.highlights.apply(arguments_.names, arguments_.style, arguments_.ttlMs) };
    },
  };
}

function assertAuthority(context: Parameters<ToolHandlers["initialize_exercise"]>[1]): void {
  if (context.signal?.aborted || !(context.isAuthorityCurrent?.() ?? true)) {
    throw new DOMException("Tool authority expired.", "AbortError");
  }
}

function assertRelationTuple(
  relation: "perpendicular" | "passes_midpoint",
  objects: string[],
  registry: SceneRegistry,
): void {
  const expectedReferences =
    relation === "perpendicular" ? ["AB"] : ["A", "B"];
  if (
    objects.length !== expectedReferences.length + 1 ||
    !sameTuple(objects.slice(1), expectedReferences)
  ) {
    throw new ToolHandlerError(
      "invalid_arguments",
      "Objects do not match the canonical tuple for this relation.",
    );
  }
  const candidate = registry.get(objects[0]);
  const references = expectedReferences.map((name) => registry.get(name));
  if (
    candidate?.owner !== "student" ||
    candidate.kind !== "line" ||
    references.some(
      (object, index) =>
        !object ||
        object.name !== expectedReferences[index] ||
        !["system", "exercise"].includes(object.owner) ||
        object.kind !== (relation === "perpendicular" ? "segment" : "point"),
    )
  ) {
    throw new ToolHandlerError(
      "invalid_arguments",
      "Objects do not have the authorized roles for this relation.",
    );
  }
}

function sameTuple(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

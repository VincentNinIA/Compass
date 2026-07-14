import type { GeoGebraAdapter } from "@/lib/geogebra/adapter";
import type { SceneRegistry } from "@/lib/geogebra/scene";
import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import type { InitializationResultV1 } from "@/lib/geogebra/exercise-initialization";
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

    async initialize_exercise(arguments_) {
      const confirmation = dependencies.getConfirmedExercise(arguments_.planId);
      if (!confirmation) {
        throw new ToolHandlerError("plan_unconfirmed", "Exercise plan is not confirmed.");
      }
      const initialized = await dependencies.initializeExercise(confirmation);
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
      const missing = arguments_.objects.filter((name) => !dependencies.registry.get(name));
      if (missing.length > 0) {
        throw new ToolHandlerError("object_missing", "A relation object does not exist.");
      }
      const candidate = arguments_.objects[0];
      const validation = dependencies.validator.validate(context.revision, candidate);
      if (!validation.ok) {
        throw new ToolHandlerError("object_missing", "The requested relation cannot be measured.");
      }
      const evidence = validation.value.evidence.find(
        (entry) => entry.relation === arguments_.relation,
      );
      if (!evidence) throw new Error("Relation evidence is unavailable.");
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

    highlight_objects(arguments_) {
      return { data: dependencies.highlights.apply(arguments_.names, arguments_.style, arguments_.ttlMs) };
    },
  };
}

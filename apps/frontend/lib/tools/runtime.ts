import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import type {
  ExerciseInitializationOptions,
  InitializationResultV1,
} from "@/lib/geogebra/exercise-initialization";
import type { GatewayContext, ToolGatewayExecutor, ToolPhase } from "./gateway";

export type ToolRuntime = {
  gateway: ToolGatewayExecutor;
  getContext(turnId: string): GatewayContext | undefined;
};

export type ToolWorkflowAuthority = {
  getPhase(): ToolPhase;
  getConfirmedExercise(planId: string): ExerciseConfirmedV1 | undefined;
  initializeExercise(
    confirmation: ExerciseConfirmedV1,
    options?: ExerciseInitializationOptions,
  ): Promise<InitializationResultV1>;
};

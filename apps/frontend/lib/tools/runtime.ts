import type { ExerciseConfirmedV1 } from "@/lib/exercise/exercise-confirmation";
import type { InitializationResultV1 } from "@/lib/geogebra/exercise-initialization";
import type { GatewayContext, ToolGateway, ToolPhase } from "./gateway";

export type ToolRuntime = {
  gateway: ToolGateway;
  getContext(turnId: string): GatewayContext | undefined;
};

export type ToolWorkflowAuthority = {
  getPhase(): ToolPhase;
  getConfirmedExercise(planId: string): ExerciseConfirmedV1 | undefined;
  initializeExercise(
    confirmation: ExerciseConfirmedV1,
  ): Promise<InitializationResultV1>;
};

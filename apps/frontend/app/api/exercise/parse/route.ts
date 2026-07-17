import { createExerciseParseHandler } from "@/lib/exercise/exercise-parse-route";
import { withDemoAccessProtection } from "@/lib/demo-access/guard";

export const runtime = "nodejs";

export const POST = withDemoAccessProtection(
  createExerciseParseHandler({ profile: "general" }),
);

import { Pool } from "pg";

import { MemoryClassroomPilotStoreV1 } from "./pilot-store";
import { PostgresClassroomPilotStoreV1 } from "./postgres-pilot-store";
import { ClassroomPilotServiceV1 } from "./pilot-service";

type Environment = Readonly<Record<string, string | undefined>>;

type Runtime =
  | { status: "disabled" | "unavailable" }
  | { status: "ready"; service: ClassroomPilotServiceV1 };

type ClassroomGlobal = typeof globalThis & {
  __compassClassroomPilotRuntime?: Runtime;
};

export function createClassroomPilotRuntime(
  environment: Environment = process.env,
): Runtime {
  if (environment.COMPASS_CLASSROOM_ENABLED !== "1") {
    return { status: "disabled" };
  }
  if (environment.COMPASS_CLASSROOM_STORE === "memory") {
    if (
      environment.COMPASS_CLASSROOM_TEST_MODE !== "1" ||
      environment.VERCEL_ENV === "production"
    ) {
      return { status: "unavailable" };
    }
    return {
      status: "ready",
      service: new ClassroomPilotServiceV1(
        new MemoryClassroomPilotStoreV1(),
      ),
    };
  }
  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString) return { status: "unavailable" };
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  return {
    status: "ready",
    service: new ClassroomPilotServiceV1(
      new PostgresClassroomPilotStoreV1(pool),
    ),
  };
}

export function getClassroomPilotRuntime(): Runtime {
  const globalScope = globalThis as ClassroomGlobal;
  globalScope.__compassClassroomPilotRuntime ??=
    createClassroomPilotRuntime(process.env);
  return globalScope.__compassClassroomPilotRuntime;
}

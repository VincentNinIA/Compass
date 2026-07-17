import { createRealtimeSessionHandler } from "@/lib/realtime/session-route";
import { withDemoAccessProtection } from "@/lib/demo-access/guard";

export const runtime = "nodejs";

export const POST = withDemoAccessProtection(createRealtimeSessionHandler());

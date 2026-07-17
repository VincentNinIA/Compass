import { createRealtimeSessionHandler } from "@/lib/realtime/session-route";

export const runtime = "nodejs";

export const POST = createRealtimeSessionHandler();

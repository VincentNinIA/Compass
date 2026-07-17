import { createDemoAccessRouteHandlers } from "@/lib/demo-access/access-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createDemoAccessRouteHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;

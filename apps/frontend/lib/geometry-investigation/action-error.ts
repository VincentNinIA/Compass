import type { GatewayErrorCode } from "@/lib/tools/gateway";

export class GeometryActionError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeometryActionError";
  }
}

export type ResponseOwner =
  | `explicit:${string}`
  | `proactive:${string}`;

export type ResponseGateSnapshot = {
  owner: ResponseOwner;
  state: "pending" | "active";
  responseId?: string;
};

export class ResponseGate {
  private current?: ResponseGateSnapshot;
  private readonly usedOwners = new Set<ResponseOwner>();

  reserve(owner: ResponseOwner): boolean {
    if (!validOwner(owner) || this.current || this.usedOwners.has(owner)) {
      return false;
    }
    this.usedOwners.add(owner);
    this.current = { owner, state: "pending" };
    return true;
  }

  activate(owner: ResponseOwner, responseId: string): boolean {
    if (
      !validId(responseId) ||
      this.current?.owner !== owner ||
      this.current.state !== "pending"
    ) {
      return false;
    }
    this.current = { owner, state: "active", responseId };
    return true;
  }

  continue(owner: ResponseOwner): boolean {
    if (this.current?.owner !== owner || this.current.state !== "active") {
      return false;
    }
    this.current = { owner, state: "pending" };
    return true;
  }

  release(owner: ResponseOwner, responseId?: string): boolean {
    if (
      this.current?.owner !== owner ||
      (responseId !== undefined &&
        this.current.state === "active" &&
        this.current.responseId !== responseId)
    ) {
      return false;
    }
    this.current = undefined;
    return true;
  }

  snapshot(): ResponseGateSnapshot | undefined {
    return this.current ? { ...this.current } : undefined;
  }

  isOwnedBy(owner: ResponseOwner): boolean {
    return this.current?.owner === owner;
  }
}

export function explicitResponseOwner(turnId: string): ResponseOwner {
  return `explicit:${turnId}`;
}

export function proactiveResponseOwner(directiveId: string): ResponseOwner {
  return `proactive:${directiveId}`;
}

function validOwner(owner: string): owner is ResponseOwner {
  return /^(explicit|proactive):[A-Za-z0-9_-]{1,128}$/.test(owner);
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

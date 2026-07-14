import {
  ResponseGate,
  explicitResponseOwner,
  type ResponseOwner,
} from "./response-gate";

export type VoiceTurnState =
  | "speaking"
  | "committed"
  | "requested"
  | "responding"
  | "tooling"
  | "completed"
  | "cancelled"
  | "failed";

export type VoiceTurn = {
  turnId: string;
  state: VoiceTurnState;
  responseId?: string;
};

export type ExplicitTurnRequest = {
  turnId: string;
  epoch: number;
  revision: number;
  snapshotHash: string;
  speechEventId: string;
};

export type VoiceTurnServerEvent = {
  type: string;
  event_id?: unknown;
  item_id?: unknown;
  response?: {
    id?: unknown;
    status?: unknown;
    output?: unknown;
    metadata?: {
      geotutor_turn_id?: unknown;
      geotutor_response_owner?: unknown;
      geotutor_epoch?: unknown;
      geotutor_revision?: unknown;
      geotutor_snapshot_hash?: unknown;
      geotutor_speech_event_id?: unknown;
    };
  };
  item?: { id?: unknown; type?: unknown; role?: unknown };
};

type VoiceTurnDependencies = {
  send(event: ResponseCreateEvent): boolean;
  onTurn(turn: VoiceTurn): void;
  responseGate?: ResponseGate;
  createEventId?: () => string;
  createExplicitRequest?(
    turnId: string,
    speechEventId: string | undefined,
  ): ExplicitTurnRequest | undefined;
};

export class VoiceTurnManager {
  private readonly turns = new Map<string, VoiceTurn>();
  private readonly pending: string[] = [];
  private activeTurnId?: string;
  private readonly requests = new Map<string, ExplicitTurnRequest>();
  private readonly speechEventIds = new Map<string, string>();
  private readonly responseGate: ResponseGate;
  private eventSequence = 0;

  constructor(private readonly dependencies: VoiceTurnDependencies) {
    this.responseGate = dependencies.responseGate ?? new ResponseGate();
  }

  handle(event: VoiceTurnServerEvent): void {
    if (
      event.type === "conversation.item.added" ||
      event.type === "conversation.item.created"
    ) {
      const turnId = stringValue(event.item?.id);
      if (
        turnId &&
        event.item?.type === "message" &&
        event.item.role === "user" &&
        !this.turns.has(turnId)
      ) {
        if (!this.captureRequest(turnId, stringValue(event.event_id))) return;
        this.publish({ turnId, state: "committed" });
        this.pending.push(turnId);
        this.requestNext();
      }
      return;
    }
    if (event.type === "input_audio_buffer.speech_started") {
      const turnId = stringValue(event.item_id);
      if (turnId && !this.turns.has(turnId)) this.publish({ turnId, state: "speaking" });
      return;
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      const turnId = stringValue(event.item_id);
      const speechEventId = stringValue(event.event_id);
      if (turnId && speechEventId) this.speechEventIds.set(turnId, speechEventId);
      return;
    }
    if (event.type === "input_audio_buffer.committed") {
      const turnId = stringValue(event.item_id);
      if (!turnId) return;
      const existing = this.turns.get(turnId);
      if (existing && existing.state !== "speaking") return;
      if (!this.captureRequest(turnId, stringValue(event.event_id))) return;
      this.publish({ turnId, state: "committed" });
      if (!this.pending.includes(turnId)) this.pending.push(turnId);
      this.requestNext();
      return;
    }
    if (event.type === "response.created") {
      const responseId = stringValue(event.response?.id);
      const responseTurnId = stringValue(
        event.response?.metadata?.geotutor_turn_id,
      );
      const active = this.activeTurn();
      if (
        !active ||
        active.state !== "requested" ||
        !responseId ||
        responseTurnId !== active.turnId ||
        !this.matchesRequestMetadata(active.turnId, event.response?.metadata) ||
        !this.responseGate.activate(this.owner(active.turnId), responseId)
      ) {
        return;
      }
      this.publish({ ...active, state: "responding", responseId });
      return;
    }
    if (event.type === "response.done") {
      const active = this.activeTurn();
      if (!active) return;
      const responseId = stringValue(event.response?.id);
      const responseTurnId = stringValue(
        event.response?.metadata?.geotutor_turn_id,
      );
      if (responseTurnId !== active.turnId) return;
      if (!this.matchesRequestMetadata(active.turnId, event.response?.metadata)) return;
      if (active.responseId && responseId && active.responseId !== responseId) return;
      if (hasCompletedFunctionCalls(event)) {
        this.publish({ ...active, state: "tooling", responseId: responseId ?? active.responseId });
        return;
      }
      const status = event.response?.status;
      const state =
        status === "completed"
          ? "completed"
          : status === "cancelled"
            ? "cancelled"
            : "failed";
      this.publish({ ...active, state, responseId: responseId ?? active.responseId });
      this.responseGate.release(this.owner(active.turnId), responseId);
      this.requests.delete(active.turnId);
      this.activeTurnId = undefined;
      this.requestNext();
    }
  }

  continueAfterTools(): boolean {
    const active = this.activeTurn();
    if (!active || active.state !== "tooling") return false;
    const owner = this.owner(active.turnId);
    if (
      !this.responseGate.continue(owner) ||
      !this.dependencies.send(
        responseRequest(
          active.turnId,
          this.createEventId(),
          this.requests.get(active.turnId),
        ),
      )
    ) {
      this.responseGate.release(owner);
      this.publish({ ...active, state: "failed" });
      this.activeTurnId = undefined;
      this.requestNext();
      return false;
    }
    this.publish({ turnId: active.turnId, state: "requested" });
    return true;
  }

  currentTurnId(): string | undefined {
    return this.activeTurnId;
  }

  currentResponseId(): string | undefined {
    return this.activeTurn()?.responseId;
  }

  hasOpenWork(): boolean {
    return this.activeTurnId !== undefined || this.pending.length > 0;
  }

  failAfterTools(): boolean {
    const active = this.activeTurn();
    if (!active || active.state !== "tooling") return false;
    this.responseGate.release(this.owner(active.turnId));
    this.publish({ ...active, state: "failed" });
    this.activeTurnId = undefined;
    this.requestNext();
    return true;
  }

  cancelOpen(): void {
    for (const turn of this.turns.values()) {
      if (["completed", "cancelled", "failed"].includes(turn.state)) continue;
      this.publish({ ...turn, state: "cancelled" });
    }
    this.pending.length = 0;
    if (this.activeTurnId) {
      this.responseGate.release(this.owner(this.activeTurnId));
    }
    this.activeTurnId = undefined;
    this.requests.clear();
    this.speechEventIds.clear();
  }

  resumePending(): void {
    this.requestNext();
  }

  close(): void {
    this.cancelOpen();
  }

  snapshot(): VoiceTurn[] {
    return [...this.turns.values()].map((turn) => ({ ...turn }));
  }

  private requestNext(): void {
    if (this.activeTurnId) return;
    const turnId = this.pending.shift();
    if (!turnId) return;
    const turn = this.turns.get(turnId);
    if (!turn || turn.state !== "committed") return;
    const owner = this.owner(turnId);
    if (!this.responseGate.reserve(owner)) {
      this.pending.unshift(turnId);
      return;
    }
    if (
      !this.dependencies.send(
        responseRequest(turnId, this.createEventId(), this.requests.get(turnId)),
      )
    ) {
      this.responseGate.release(owner);
      this.publish({ ...turn, state: "failed" });
      this.requestNext();
      return;
    }
    this.activeTurnId = turnId;
    this.publish({ ...turn, state: "requested" });
  }

  private activeTurn(): VoiceTurn | undefined {
    return this.activeTurnId ? this.turns.get(this.activeTurnId) : undefined;
  }

  private publish(turn: VoiceTurn): void {
    const copy = { ...turn };
    this.turns.set(turn.turnId, copy);
    this.dependencies.onTurn({ ...copy });
  }

  private owner(turnId: string): ResponseOwner {
    return explicitResponseOwner(turnId);
  }

  private createEventId(): string {
    return this.dependencies.createEventId?.() ?? `voice-event-${++this.eventSequence}`;
  }

  private captureRequest(
    turnId: string,
    speechEventId: string | undefined,
  ): boolean {
    if (!this.dependencies.createExplicitRequest) return true;
    const anchoredSpeechEventId = this.speechEventIds.get(turnId) ?? speechEventId;
    const request = this.dependencies.createExplicitRequest(
      turnId,
      anchoredSpeechEventId,
    );
    if (!request || request.turnId !== turnId) {
      this.publish({ turnId, state: "failed" });
      return false;
    }
    this.speechEventIds.delete(turnId);
    this.requests.set(turnId, { ...request });
    return true;
  }

  private matchesRequestMetadata(
    turnId: string,
    metadata: NonNullable<VoiceTurnServerEvent["response"]>["metadata"],
  ): boolean {
    const request = this.requests.get(turnId);
    if (!request) return true;
    return (
      metadata?.geotutor_response_owner === this.owner(turnId) &&
      metadata.geotutor_epoch === String(request.epoch) &&
      metadata.geotutor_revision === String(request.revision) &&
      metadata.geotutor_snapshot_hash === request.snapshotHash &&
      metadata.geotutor_speech_event_id === request.speechEventId
    );
  }
}

type ResponseCreateEvent = {
  type: "response.create";
  event_id: string;
  response: {
    metadata: {
      geotutor_turn_id: string;
      geotutor_response_owner?: ResponseOwner;
      geotutor_epoch?: string;
      geotutor_revision?: string;
      geotutor_snapshot_hash?: string;
      geotutor_speech_event_id?: string;
    };
  };
};

function responseRequest(
  turnId: string,
  eventId: string,
  request?: ExplicitTurnRequest,
): ResponseCreateEvent {
  return {
    type: "response.create",
    event_id: eventId,
    response: {
      metadata: {
        geotutor_turn_id: turnId,
        ...(request
          ? {
              geotutor_response_owner: explicitResponseOwner(turnId),
              geotutor_epoch: String(request.epoch),
              geotutor_revision: String(request.revision),
              geotutor_snapshot_hash: request.snapshotHash,
              geotutor_speech_event_id: request.speechEventId,
            }
          : {}),
      },
    },
  };
}

function hasCompletedFunctionCalls(event: VoiceTurnServerEvent): boolean {
  return (
    Array.isArray(event.response?.output) &&
    event.response.output.some(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "function_call" &&
        (item as { status?: unknown }).status === "completed",
    )
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

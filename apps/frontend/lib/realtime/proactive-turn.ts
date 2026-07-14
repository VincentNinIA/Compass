import {
  DirectiveCorrelationLedger,
  completeDirective,
  dispatchDirective,
  guardDirective,
  invalidateDirective,
  type InterventionDirective,
} from "@/lib/pedagogy/directive";
import type { PolicyDecision } from "@/lib/pedagogy/policy";
import type { EvidenceLog } from "@/lib/pedagogy/evidence-log";
import {
  type PedagogyEvent,
  type PedagogyState,
} from "@/lib/pedagogy/state";
import {
  ResponseGate,
  proactiveResponseOwner,
  type ResponseOwner,
} from "./response-gate";

export type ProactiveTurnStatus =
  | "item_sent"
  | "response_requested"
  | "responding"
  | "completed"
  | "cancelled"
  | "failed";

export type ProactiveTurnSnapshot = {
  directiveId: string;
  owner: ResponseOwner;
  status: ProactiveTurnStatus;
  itemEventId: string;
  itemId: string;
  responseEventId?: string;
  responseId?: string;
};

export type ProactiveTurnRequest = {
  directiveId: string;
  evidenceIds: readonly string[];
};

export type ProactiveRequestResult =
  | "unavailable"
  | "ignored"
  | "busy"
  | "item_sent"
  | "failed";

export function shouldInvalidateQueuedDirective(
  result: ProactiveRequestResult,
): boolean {
  return result !== "item_sent";
}

export type ProactiveClientEvent =
  | {
      type: "conversation.item.create";
      event_id: string;
      item: {
        id: string;
        type: "message";
        role: "user";
        content: [{ type: "input_text"; text: string }];
      };
    }
  | {
      type: "response.create";
      event_id: string;
      response: {
        metadata: {
          geotutor_response_owner: ResponseOwner;
          geotutor_directive_id: string;
          geotutor_response_event_id: string;
        };
      };
    }
  | { type: "response.cancel"; response_id?: string }
  | { type: "output_audio_buffer.clear" };

export type ProactiveServerEvent = {
  type: string;
  item_id?: unknown;
  item?: { id?: unknown };
  response?: {
    id?: unknown;
    status?: unknown;
    metadata?: {
      geotutor_response_owner?: unknown;
      geotutor_directive_id?: unknown;
      geotutor_response_event_id?: unknown;
    };
  };
};

type PendingProactive = ProactiveTurnSnapshot & {
  directive: InterventionDirective;
  ackTimer?: ReturnType<typeof setTimeout>;
};

export class ProactiveTurnOrchestrator {
  private pending?: PendingProactive;
  private sequence = 0;
  private readonly responseGate: ResponseGate;
  private readonly correlations: DirectiveCorrelationLedger;
  private readonly ackTimeoutMs: number;

  constructor(
    private readonly dependencies: {
      send(event: ProactiveClientEvent): boolean;
      getState(): PedagogyState;
      dispatch(event: PedagogyEvent): PedagogyState;
      responseGate?: ResponseGate;
      correlations?: DirectiveCorrelationLedger;
      createEventId?: () => string;
      createItemId?: () => string;
      ackTimeoutMs?: number;
      evidenceLog?: EvidenceLog;
      onStatus?(snapshot: ProactiveTurnSnapshot): void;
      onGateReleased?(): void;
    },
  ) {
    this.responseGate = dependencies.responseGate ?? new ResponseGate();
    this.correlations =
      dependencies.correlations ?? new DirectiveCorrelationLedger();
    this.ackTimeoutMs = dependencies.ackTimeoutMs ?? 2_000;
  }

  request(
    decision: PolicyDecision,
    directive: InterventionDirective,
  ): "ignored" | "busy" | "item_sent" | "failed" {
    const request: ProactiveTurnRequest = {
      directiveId: directive.directiveId,
      evidenceIds: directive.evidenceIds,
    };
    if (decision.type !== "speak") return "ignored";
    if (this.pending) return "busy";
    const state = this.dependencies.getState();
    if (!guardDirective(state, directive, "before_item").ok) return "failed";
    const owner = proactiveResponseOwner(directive.directiveId);
    if (!this.responseGate.reserve(owner)) return "busy";
    if (!this.correlations.create(request.directiveId)) {
      this.responseGate.release(owner);
      return "failed";
    }

    const itemEventId = this.createEventId("proactive-item");
    const itemId = this.dependencies.createItemId?.() ??
      `proactive-item-${++this.sequence}`;
    const itemEvent: ProactiveClientEvent = {
      type: "conversation.item.create",
      event_id: itemEventId,
      item: {
        id: itemId,
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(compactDirectiveEvent(state, directive)),
          },
        ],
      },
    };
    if (
      !this.dependencies.send(itemEvent) ||
      !this.correlations.bindItem(
        directive.directiveId,
        itemEventId,
        itemId,
      )
    ) {
      this.responseGate.release(owner);
      return "failed";
    }
    const snapshot: ProactiveTurnSnapshot = {
      directiveId: directive.directiveId,
      owner,
      status: "item_sent",
      itemEventId,
      itemId,
    };
    this.pending = {
      ...snapshot,
      directive,
      ackTimer: setTimeout(() => this.fail("failed"), this.ackTimeoutMs),
    };
    this.publish(snapshot);
    return "item_sent";
  }

  handle(event: ProactiveServerEvent): boolean {
    const pending = this.pending;
    if (!pending) return false;
    if (
      (event.type === "conversation.item.created" ||
        event.type === "conversation.item.added") &&
      readItemId(event) === pending.itemId &&
      pending.status === "item_sent"
    ) {
      this.acknowledgeItem();
      return true;
    }
    if (event.type === "response.created") {
      return this.acceptResponseCreated(event);
    }
    if (event.type === "response.done") {
      return this.acceptResponseDone(event);
    }
    return false;
  }

  cancelForExplicit(): boolean {
    if (!this.pending) return false;
    this.fail("cancelled");
    return true;
  }

  snapshot(): ProactiveTurnSnapshot | undefined {
    return this.pending ? publicSnapshot(this.pending) : undefined;
  }

  close(): void {
    if (this.pending) this.fail("cancelled");
  }

  private acknowledgeItem(): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.ackTimer);
    const live = this.dependencies.getState();
    if (!guardDirective(live, pending.directive, "before_item").ok) {
      this.fail("failed");
      return;
    }
    const transitioned = dispatchDirective(pending.directive);
    if (!transitioned.ok) {
      this.fail("failed");
      return;
    }
    const dispatchedState = this.dependencies.dispatch({
      type: "directive_dispatched",
      directiveId: pending.directiveId,
      ...anchor(live),
    });
    if (
      !guardDirective(
        dispatchedState,
        transitioned.directive,
        "before_response",
      ).ok
    ) {
      this.pending = { ...pending, directive: transitioned.directive };
      this.fail("failed");
      return;
    }
    const responseEventId = this.createEventId("proactive-response");
    if (
      !this.correlations.bindResponseRequest(
        pending.directiveId,
        responseEventId,
      ) ||
      !this.dependencies.send({
        type: "response.create",
        event_id: responseEventId,
        response: {
          metadata: {
            geotutor_response_owner: pending.owner,
            geotutor_directive_id: pending.directiveId,
            geotutor_response_event_id: responseEventId,
          },
        },
      })
    ) {
      this.pending = { ...pending, directive: transitioned.directive };
      this.fail("failed");
      return;
    }
    this.pending = {
      ...pending,
      directive: transitioned.directive,
      status: "response_requested",
      responseEventId,
      ackTimer: setTimeout(() => this.fail("failed"), this.ackTimeoutMs),
    };
    this.log("directive_dispatched", transitioned.directive, {
      outcome: "accepted",
      reason: "response_requested",
    });
    this.publish(publicSnapshot(this.pending));
  }

  private acceptResponseCreated(event: ProactiveServerEvent): boolean {
    const pending = this.pending;
    const responseId = readString(event.response?.id);
    if (
      !pending ||
      pending.status !== "response_requested" ||
      !responseId ||
      !matchesMetadata(event, pending) ||
      !pending.responseEventId
    ) {
      return false;
    }
    const live = this.dependencies.getState();
    if (!guardDirective(live, pending.directive, "before_response").ok) {
      this.fail("cancelled");
      return true;
    }
    if (
      !this.responseGate.activate(pending.owner, responseId) ||
      !this.correlations.bindResponseCreated(
        pending.directiveId,
        pending.responseEventId,
        responseId,
      )
    ) {
      return false;
    }
    clearTimeout(pending.ackTimer);
    const nextState = this.dependencies.dispatch({
      type: "response_started",
      responseId,
      directiveId: pending.directiveId,
      ...anchor(live),
    });
    if (nextState.activeResponse?.responseId !== responseId) {
      this.dependencies.send({ type: "response.cancel", response_id: responseId });
      this.dependencies.send({ type: "output_audio_buffer.clear" });
      this.fail("failed");
      return true;
    }
    this.pending = {
      ...pending,
      status: "responding",
      responseId,
      ackTimer: undefined,
    };
    this.log("response_started", pending.directive, {
      responseId,
      outcome: "accepted",
      reason: "owned_response",
    });
    this.publish(publicSnapshot(this.pending));
    return true;
  }

  private acceptResponseDone(event: ProactiveServerEvent): boolean {
    const pending = this.pending;
    const responseId = readString(event.response?.id);
    if (
      !pending ||
      pending.status !== "responding" ||
      !responseId ||
      responseId !== pending.responseId ||
      !matchesMetadata(event, pending)
    ) {
      return false;
    }
    const status = event.response?.status;
    const nextStatus: ProactiveTurnStatus =
      status === "completed"
        ? "completed"
        : status === "cancelled"
          ? "cancelled"
          : "failed";
    const live = this.dependencies.getState();
    this.dependencies.dispatch({
      type:
        nextStatus === "completed"
          ? "response_finished"
          : nextStatus === "cancelled"
            ? "response_cancelled"
            : "response_failed",
      responseId,
      ...anchor(live),
    });
    if (nextStatus === "completed") {
      completeDirective(pending.directive);
    } else {
      invalidateDirective(
        pending.directive,
        nextStatus === "cancelled"
          ? "explicitly_cancelled"
          : "state_mismatch",
      );
    }
    this.responseGate.release(pending.owner, responseId);
    this.log("response_finished", pending.directive, {
      responseId,
      outcome: nextStatus,
      reason: `response_${nextStatus}`,
    });
    this.publish({ ...publicSnapshot(pending), status: nextStatus });
    this.pending = undefined;
    this.dependencies.onGateReleased?.();
    return true;
  }

  private fail(status: "failed" | "cancelled"): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.ackTimer);
    const live = this.dependencies.getState();
    if (pending.status === "responding" && pending.responseId) {
      this.dependencies.send({
        type: "response.cancel",
        response_id: pending.responseId,
      });
      this.dependencies.send({ type: "output_audio_buffer.clear" });
      this.dependencies.dispatch({
        type: "response_cancelled",
        responseId: pending.responseId,
        ...anchor(live),
      });
    } else if (live.pendingIntervention?.directiveId === pending.directiveId) {
      this.dependencies.dispatch({
        type: "directive_invalidated",
        directiveId: pending.directiveId,
        ...anchor(live),
      });
    }
    invalidateDirective(
      pending.directive,
      status === "cancelled" ? "explicitly_cancelled" : "state_mismatch",
    );
    this.responseGate.release(pending.owner, pending.responseId);
    this.log("response_finished", pending.directive, {
      ...(pending.responseId ? { responseId: pending.responseId } : {}),
      outcome: status,
      reason: status === "cancelled" ? "explicitly_cancelled" : "state_mismatch",
    });
    this.publish({ ...publicSnapshot(pending), status });
    this.pending = undefined;
    this.dependencies.onGateReleased?.();
  }

  private createEventId(prefix: string): string {
    return (
      this.dependencies.createEventId?.() ??
      `${prefix}-${++this.sequence}`
    );
  }

  private publish(snapshot: ProactiveTurnSnapshot): void {
    this.dependencies.onStatus?.({ ...snapshot });
  }

  private log(
    eventType:
      | "directive_queued"
      | "directive_dispatched"
      | "response_started"
      | "response_finished",
    directive: InterventionDirective,
    detail: { responseId?: string; outcome: string; reason: string },
  ): void {
    this.dependencies.evidenceLog?.append({
      eventType,
      epoch: directive.epoch,
      revision: directive.baseRevision,
      ...(directive.sourceActionId
        ? { actionId: directive.sourceActionId }
        : {}),
      decision: "SPEAK",
      directiveId: directive.directiveId,
      ...(detail.responseId ? { responseId: detail.responseId } : {}),
      evidenceIds: directive.evidenceIds,
      outcome: detail.outcome,
      reason: detail.reason,
    });
  }
}

function compactDirectiveEvent(
  state: PedagogyState,
  directive: InterventionDirective,
) {
  return {
    type: "geotutor_verified_intervention",
    directiveId: directive.directiveId,
    sourceActionId: directive.sourceActionId,
    revision: directive.baseRevision,
    snapshotHash: directive.snapshotHash,
    facts: state.verifiedFacts.map((fact) => ({
      relationKey: fact.relationKey,
      status: fact.status,
      evidenceId: fact.evidenceId,
    })),
    evidenceIds: [...directive.evidenceIds],
    missingRelationKeys: [...directive.missingRelationKeys],
    helpLevel: directive.helpLevel,
    goal: directive.goal,
    allowedTools: [...directive.allowedTools],
  };
}

function anchor(state: PedagogyState) {
  return {
    epoch: state.epoch,
    revision: state.revision,
    snapshotHash: state.studentSnapshotHash,
  } as const;
}

function matchesMetadata(
  event: ProactiveServerEvent,
  pending: PendingProactive,
): boolean {
  return (
    event.response?.metadata?.geotutor_response_owner === pending.owner &&
    event.response.metadata.geotutor_directive_id === pending.directiveId &&
    event.response.metadata.geotutor_response_event_id ===
      pending.responseEventId
  );
}

function readItemId(event: ProactiveServerEvent): string | undefined {
  return readString(event.item?.id) ?? readString(event.item_id);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function publicSnapshot(pending: PendingProactive): ProactiveTurnSnapshot {
  const {
    directiveId,
    owner,
    status,
    itemEventId,
    itemId,
    responseEventId,
    responseId,
  } = pending;
  return {
    directiveId,
    owner,
    status,
    itemEventId,
    itemId,
    ...(responseEventId ? { responseEventId } : {}),
    ...(responseId ? { responseId } : {}),
  };
}

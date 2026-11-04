import { publishWorkflowEvent, type WorkflowEventPublishContext } from '@alga-psa/event-bus/publishers';
import { getSlaTarget } from '../../lib/itil/slaTargets';
import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

type IsoString = string;

export type WorkflowTicketSlaStageEvent =
  | {
      eventType: 'TICKET_SLA_STAGE_ENTERED';
      payload: {
        ticketId: string;
        slaPolicyId: string;
        stage: 'resolution';
        enteredAt?: IsoString;
        targetAt?: IsoString;
      } & BuiltWorkflowPayload<'TICKET_SLA_STAGE_ENTERED'>;
      idempotencyKey?: string;
    }
  | {
      eventType: 'TICKET_SLA_STAGE_MET';
      payload: {
        ticketId: string;
        slaPolicyId: string;
        stage: 'resolution';
        metAt?: IsoString;
        targetAt?: IsoString;
      } & BuiltWorkflowPayload<'TICKET_SLA_STAGE_MET'>;
      idempotencyKey?: string;
    }
  | {
      eventType: 'TICKET_SLA_STAGE_BREACHED';
      payload: {
        ticketId: string;
        slaPolicyId: string;
        stage: 'resolution';
        breachedAt?: IsoString;
        targetAt?: IsoString;
        overdueBySeconds?: number;
      } & BuiltWorkflowPayload<'TICKET_SLA_STAGE_BREACHED'>;
      idempotencyKey?: string;
    };

export type WorkflowTicketSlaStageEnteredEvent = Extract<WorkflowTicketSlaStageEvent, { eventType: 'TICKET_SLA_STAGE_ENTERED' }>;

export type WorkflowTicketSlaStageCompletionEvent = Exclude<WorkflowTicketSlaStageEvent, WorkflowTicketSlaStageEnteredEvent>;

function toIsoString(value: Date | string | null | undefined): IsoString | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function addHoursToIso(iso: string, hours: number): IsoString | undefined {
  const enteredAtMs = Date.parse(iso);
  if (Number.isNaN(enteredAtMs)) return undefined;
  return new Date(enteredAtMs + hours * 60 * 60 * 1000).toISOString();
}

export function buildTicketResolutionSlaStageEnteredEvent(args: {
  tenantId: string;
  ticketId: string;
  itilPriorityLevel?: number | null;
  enteredAt?: Date | string | null;
  /** Extra payload fields (e.g. workflow provenance), merged over the base fields. */
  payloadExtras?: Record<string, unknown>;
}): WorkflowTicketSlaStageEnteredEvent | null {
  const enteredAtIso = toIsoString(args.enteredAt);
  if (!enteredAtIso) return null;
  if (!args.itilPriorityLevel) return null;

  const targetAt = addHoursToIso(enteredAtIso, getSlaTarget(args.itilPriorityLevel));

  return {
    eventType: 'TICKET_SLA_STAGE_ENTERED',
    payload: builtWorkflowPayload('TICKET_SLA_STAGE_ENTERED', {
      ticketId: args.ticketId,
      // Until a first-class SLA policy model exists, use a stable per-tenant identifier
      // so workflows can still key off a consistent slaPolicyId.
      slaPolicyId: args.tenantId,
      stage: 'resolution',
      enteredAt: enteredAtIso,
      targetAt,
      ...args.payloadExtras,
    }),
    idempotencyKey: `ticket:${args.ticketId}:sla:resolution:entered:${enteredAtIso}`,
  };
}

export function buildTicketResolutionSlaStageCompletionEvent(args: {
  tenantId: string;
  ticketId: string;
  itilPriorityLevel?: number | null;
  enteredAt?: Date | string | null;
  closedAt?: Date | string | null;
}): WorkflowTicketSlaStageCompletionEvent | null {
  const enteredAtIso = toIsoString(args.enteredAt);
  const closedAtIso = toIsoString(args.closedAt);
  if (!enteredAtIso || !closedAtIso) return null;
  if (!args.itilPriorityLevel) return null;

  const targetAt = addHoursToIso(enteredAtIso, getSlaTarget(args.itilPriorityLevel));
  if (!targetAt) return null;

  const targetAtMs = Date.parse(targetAt);
  const closedAtMs = Date.parse(closedAtIso);
  if (Number.isNaN(targetAtMs) || Number.isNaN(closedAtMs)) return null;

  if (closedAtMs <= targetAtMs) {
    return {
      eventType: 'TICKET_SLA_STAGE_MET',
      payload: builtWorkflowPayload('TICKET_SLA_STAGE_MET', {
        ticketId: args.ticketId,
        slaPolicyId: args.tenantId,
        stage: 'resolution',
        metAt: closedAtIso,
        targetAt,
      }),
      idempotencyKey: `ticket:${args.ticketId}:sla:resolution:met:${closedAtIso}`,
    };
  }

  return {
    eventType: 'TICKET_SLA_STAGE_BREACHED',
    payload: builtWorkflowPayload('TICKET_SLA_STAGE_BREACHED', {
      ticketId: args.ticketId,
      slaPolicyId: args.tenantId,
      stage: 'resolution',
      breachedAt: closedAtIso,
      targetAt,
      overdueBySeconds: Math.max(0, Math.floor((closedAtMs - targetAtMs) / 1000)),
    }),
    idempotencyKey: `ticket:${args.ticketId}:sla:resolution:breached:${closedAtIso}`,
  };
}


/**
 * Publish an SLA stage event (entered / met / breached). Uses the event's own idempotency key.
 * A switch because a union of branded events cannot go through one generic call.
 */
export function publishWorkflowTicketSlaStageEvent(
  event: WorkflowTicketSlaStageEvent,
  ctx: WorkflowEventPublishContext
): Promise<void> {
  const idempotencyKey = event.idempotencyKey;
  switch (event.eventType) {
    case 'TICKET_SLA_STAGE_ENTERED':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx, idempotencyKey });
    case 'TICKET_SLA_STAGE_MET':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx, idempotencyKey });
    case 'TICKET_SLA_STAGE_BREACHED':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx, idempotencyKey });
  }
}

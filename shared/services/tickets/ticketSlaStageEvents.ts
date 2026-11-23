import { publishWorkflowEvent, type WorkflowEventPublishContext } from '@alga-psa/event-bus/publishers';
import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

/**
 * `TICKET_SLA_STAGE_*` describes the ticket's own SLA: the policy that applies to it, the moment
 * its clock started and the moment resolution is due. They used to be computed from a hard-coded
 * table of hours keyed on `tickets.itil_priority_level`, which no create ever wrote — so the
 * events were both rarely emitted and, when they were, unrelated to the SLA the ticket actually
 * runs on. A ticket with no SLA emits none (F129 of `ee/plans/2026-11-21-itil-remediation`).
 */

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

/** The ticket's own SLA, as the row carries it. */
export interface TicketSlaFields {
  /** `tickets.sla_policy_id`: null when no policy applies to this ticket. */
  slaPolicyId?: string | null;
  /** `tickets.sla_started_at`: when the clock started. Falls back to the ticket's `entered_at`. */
  slaStartedAt?: Date | string | null;
  /** `tickets.sla_resolution_due_at`: when resolution is due. No due time, no stage events. */
  slaResolutionDueAt?: Date | string | null;
}

export function buildTicketResolutionSlaStageEnteredEvent(args: TicketSlaFields & {
  tenantId: string;
  ticketId: string;
  enteredAt?: Date | string | null;
  /** Extra payload fields (e.g. workflow provenance), merged over the base fields. */
  payloadExtras?: Record<string, unknown>;
}): WorkflowTicketSlaStageEnteredEvent | null {
  const enteredAtIso = toIsoString(args.slaStartedAt) ?? toIsoString(args.enteredAt);
  const targetAt = toIsoString(args.slaResolutionDueAt);
  if (!enteredAtIso || !targetAt || !args.slaPolicyId) return null;

  return {
    eventType: 'TICKET_SLA_STAGE_ENTERED',
    payload: builtWorkflowPayload('TICKET_SLA_STAGE_ENTERED', {
      ticketId: args.ticketId,
      slaPolicyId: args.slaPolicyId,
      stage: 'resolution',
      enteredAt: enteredAtIso,
      targetAt,
      ...args.payloadExtras,
    }),
    idempotencyKey: `ticket:${args.ticketId}:sla:resolution:entered:${enteredAtIso}`,
  };
}

export function buildTicketResolutionSlaStageCompletionEvent(args: TicketSlaFields & {
  tenantId: string;
  ticketId: string;
  enteredAt?: Date | string | null;
  closedAt?: Date | string | null;
}): WorkflowTicketSlaStageCompletionEvent | null {
  const enteredAtIso = toIsoString(args.slaStartedAt) ?? toIsoString(args.enteredAt);
  const closedAtIso = toIsoString(args.closedAt);
  const targetAt = toIsoString(args.slaResolutionDueAt);
  if (!enteredAtIso || !closedAtIso || !targetAt || !args.slaPolicyId) return null;

  const targetAtMs = Date.parse(targetAt);
  const closedAtMs = Date.parse(closedAtIso);
  if (Number.isNaN(targetAtMs) || Number.isNaN(closedAtMs)) return null;

  if (closedAtMs <= targetAtMs) {
    return {
      eventType: 'TICKET_SLA_STAGE_MET',
      payload: builtWorkflowPayload('TICKET_SLA_STAGE_MET', {
        ticketId: args.ticketId,
        slaPolicyId: args.slaPolicyId,
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
      slaPolicyId: args.slaPolicyId,
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

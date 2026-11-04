import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import type { BuiltWorkflowPayload } from '@alga-psa/event-schemas';
import type { ITicketResource } from '@alga-psa/types';
import { assertHumanWorkAssignee } from '../../lib/humanWork/assertHumanWorkAssignee';
import { buildTicketAdditionalAgentAssignedPayload, buildTicketAssignedPayload } from '../../lib/tickets/ticketWorkflowEventPayloads';
import { writeTicketActivity } from '../../lib/ticketActivity/writeTicketActivity';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
} from '../../lib/ticketActivity/types';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

/**
 * Audit row for an additional-agent change. Written in the caller's transaction so it rolls
 * back with the mutation. The acting user is the actor (this feeds the per-user work trail);
 * system-initiated work (null actor) is recorded as a system actor.
 */
async function writeAdditionalAgentActivity(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string | null,
  ticketId: string,
  eventType: string,
  additionalUserId: string,
  details: Record<string, unknown>,
  source: string,
): Promise<void> {
  await writeTicketActivity(trx, {
    tenant,
    ticketId,
    eventType,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: ticketId,
    actor: actorUserId
      ? { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: actorUserId }
      : { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM },
    source: actorUserId ? source : TICKET_ACTIVITY_SOURCE.SYSTEM,
    details: { additional_agent_id: additionalUserId, ...details },
  });
}

export class TicketResourceError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_found' | 'conflict'
  ) {
    super(message);
    this.name = 'TicketResourceError';
  }
}

/**
 * What a ticket-resource change publishes. `payload` is the event-specific part;
 * the envelope (tenantId, occurredAt, actor) is added at publish time from
 * `tenant` / `actorUserId`.
 */
export type TicketResourceEvent =
  | {
      eventType: 'TICKET_ASSIGNED';
      payload: Record<string, unknown> & BuiltWorkflowPayload<'TICKET_ASSIGNED'>;
      tenant: string;
      /** Null for system-initiated work. */
      actorUserId: string | null;
    }
  | {
      eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED';
      payload: Record<string, unknown> & BuiltWorkflowPayload<'TICKET_ADDITIONAL_AGENT_ASSIGNED'>;
      tenant: string;
      /** Null for system-initiated work. */
      actorUserId: string | null;
    };

export type TicketAdditionalAgentEvent = Extract<TicketResourceEvent, { eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED' }>;

export interface AddTicketResourceResult {
  /** Null when the ticket had no primary assignee and the user was promoted. */
  resource: ITicketResource | null;
  event: TicketResourceEvent;
}

export type TicketResourceNotificationSuppression = {
  suppressContactNotifications?: boolean;
  suppressInternalNotifications?: boolean;
};

/** Publish what `addTicketResourceCore` returned, once its transaction commits. */
export async function publishTicketResourceEvent(event: TicketResourceEvent): Promise<void> {
  const ctx = {
    tenantId: event.tenant,
    actor: event.actorUserId ? ({ actorType: 'USER', actorUserId: event.actorUserId } as const) : ({ actorType: 'SYSTEM' } as const),
  };
  if (event.eventType === 'TICKET_ASSIGNED') {
    await publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx });
    return;
  }
  await publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx });
}

/**
 * Adds an additional agent to a ticket.
 *
 * Shared by the server action (`addTicketResource`) and the REST API so both
 * paths apply the same promote-to-primary rule and duplicate check. The event
 * is returned rather than published so the caller can emit it after the
 * transaction commits.
 *
 * `actorUserId` is null for system-initiated work (e.g. recurring-ticket
 * generation): `tickets.updated_by` is nullable and the event omits
 * `assignedByUserId`, so no stand-in user is ever recorded.
 */
export async function addTicketResourceCore(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string | null,
  ticketId: string,
  additionalUserId: string,
  role: string,
  notificationSuppression: TicketResourceNotificationSuppression = {},
  source: string = TICKET_ACTIVITY_SOURCE.UI,
): Promise<AddTicketResourceResult> {
  const ticket = await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .first();

  if (!ticket) {
    throw new TicketResourceError(`Ticket not found in tenant ${tenant}`, 'not_found');
  }

  // Human-work guard: both the additional agent and the promoted-to-primary assignee are this id.
  await assertHumanWorkAssignee(trx, tenant, [additionalUserId]);

  // If the ticket has no primary assignment yet, promote this user to primary
  if (!ticket.assigned_to) {
    const [updatedTicket] = await tenantScopedTable(trx, 'tickets', tenant)
      .where({ ticket_id: ticketId })
      .update({
        assigned_to: additionalUserId,
        updated_by: actorUserId,
        updated_at: new Date()
      })
      .returning('*');

    if (!updatedTicket) {
      throw new Error(`Primary assignment update for ticket ${ticketId} completed without returning the updated ticket.`);
    }

    await writeAdditionalAgentActivity(
      trx, tenant, actorUserId, ticketId, TICKET_ACTIVITY_EVENT.ASSIGNED, additionalUserId,
      { role, promoted_to_primary: true }, source,
    );

    return {
      resource: null,
      event: {
        eventType: 'TICKET_ASSIGNED',
        payload: buildTicketAssignedPayload({
          ticketId: ticketId,
          userId: additionalUserId,
          ...(actorUserId ? { assignedByUserId: actorUserId } : {}),
          ...notificationSuppression,
        }),
        tenant,
        actorUserId,
      }
    };
  }

  const existingResource = await tenantScopedTable(trx, 'ticket_resources', tenant)
    .where({
      ticket_id: ticketId,
      additional_user_id: additionalUserId,
    })
    .first();

  if (existingResource) {
    throw new TicketResourceError(
      `Resource already exists for user ${additionalUserId} in tenant ${tenant}`,
      'conflict'
    );
  }

  const [resource] = await tenantScopedTable(trx, 'ticket_resources', tenant)
    .insert({
      ticket_id: ticketId,
      assigned_to: ticket.assigned_to,
      additional_user_id: additionalUserId,
      role: role,
      tenant: tenant,
      assigned_at: new Date()
    })
    .returning('*');

  await writeAdditionalAgentActivity(
    trx, tenant, actorUserId, ticketId, TICKET_ACTIVITY_EVENT.ASSIGNED, additionalUserId,
    { role }, source,
  );

  return {
    resource,
    event: {
      eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED',
      payload: buildTicketAdditionalAgentAssignedPayload({
        ticketId,
        primaryAgentId: ticket.assigned_to,
        additionalAgentId: additionalUserId,
        assignedByUserId: actorUserId,
        ...notificationSuppression,
      }),
      tenant,
      actorUserId,
    }
  };
}

export async function removeTicketResourceCore(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string | null,
  assignmentId: string,
  source: string = TICKET_ACTIVITY_SOURCE.UI,
): Promise<void> {
  const resource = await tenantScopedTable(trx, 'ticket_resources', tenant)
    .where({ assignment_id: assignmentId })
    .first();

  if (!resource) {
    throw new TicketResourceError(`Ticket resource not found in tenant ${tenant}`, 'not_found');
  }

  await tenantScopedTable(trx, 'ticket_resources', tenant)
    .where({ assignment_id: assignmentId })
    .delete();

  await writeAdditionalAgentActivity(
    trx, tenant, actorUserId, resource.ticket_id, TICKET_ACTIVITY_EVENT.UNASSIGNED,
    resource.additional_user_id, { role: resource.role ?? null }, source,
  );
}

export async function getTicketResourcesCore(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<ITicketResource[]> {
  const ticket = await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .first();

  if (!ticket) {
    throw new TicketResourceError(`Ticket not found in tenant ${tenant}`, 'not_found');
  }

  return await tenantScopedTable(trx, 'ticket_resources', tenant)
    .where({ ticket_id: ticketId })
    .select('*')
    .orderBy('assigned_at', 'desc');
}

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import type { ITicketResource } from '@alga-psa/types';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
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
 * Adds an additional agent to a ticket. Returns null when the ticket had no
 * primary assignee and the user was promoted to primary instead.
 *
 * Shared by the server action (`addTicketResource`) and the REST API so both
 * paths apply the same promote-to-primary rule, duplicate check, and events.
 */
export async function addTicketResourceCore(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  ticketId: string,
  additionalUserId: string,
  role: string
): Promise<ITicketResource | null> {
  const ticket = await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .first();

  if (!ticket) {
    throw new TicketResourceError(`Ticket not found in tenant ${tenant}`, 'not_found');
  }

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

    await publishEvent({
      eventType: 'TICKET_ASSIGNED',
      payload: {
        tenantId: tenant,
        ticketId: ticketId,
        userId: additionalUserId,
        assignedByUserId: actorUserId
      }
    });

    return null;
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

  await publishEvent({
    eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED',
    payload: {
      tenantId: tenant,
      ticketId: ticketId,
      primaryAgentId: ticket.assigned_to,
      additionalAgentId: additionalUserId,
      assignedByUserId: actorUserId
    }
  });

  return resource;
}

export async function removeTicketResourceCore(
  trx: Knex.Transaction,
  tenant: string,
  assignmentId: string
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

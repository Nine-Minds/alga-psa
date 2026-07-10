// @alga-psa/tickets/actions.ts
'use server'

import { ITicketResource } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { withAuth } from '@alga-psa/auth';
import { ticketActionErrorFrom, type TicketActionError } from './ticketActionErrors';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export const addTicketResource = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  additionalUserId: string,
  role: string
): Promise<ITicketResource | TicketActionError | null> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot add ticket resource');
    }

    // First, verify that the ticket exists and has the correct assigned_to
    const ticket = await tenantScopedTable(trx, 'tickets', tenant)
      .where({
        ticket_id: ticketId,
      })
      .first();

    if (!ticket) {
      throw new Error(`Ticket not found in tenant ${tenant}`);
    }

    // If the ticket has no primary assignment yet, promote this user to primary
    if (!ticket.assigned_to) {
      const [updatedTicket] = await tenantScopedTable(trx, 'tickets', tenant)
        .where({
          ticket_id: ticketId,
        })
        .update({
          assigned_to: additionalUserId,
          updated_by: user.user_id,
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
          assignedByUserId: user.user_id
        }
      });

      return null;
    }

    // Check if resource already exists
    const existingResource = await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({
        ticket_id: ticketId,
        additional_user_id: additionalUserId,
      })
      .first();

    if (existingResource) {
      throw new Error(`Resource already exists for user ${additionalUserId} in tenant ${tenant}`);
    }

    // Create the resource with the ticket's assigned_to
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

    // Publish TICKET_ADDITIONAL_AGENT_ASSIGNED event
    const eventPayload = {
      tenantId: tenant,
      ticketId: ticketId,
      primaryAgentId: ticket.assigned_to,
      additionalAgentId: additionalUserId,
      assignedByUserId: user.user_id
    };
    console.log('[ticketResourceActions] Publishing TICKET_ADDITIONAL_AGENT_ASSIGNED event:', JSON.stringify(eventPayload));
    await publishEvent({
      eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED',
      payload: eventPayload
    });

    return resource;
    });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Failed to add ticket resource:', error);
    throw error;
  }
});

export const removeTicketResource = withAuth(async (
  user,
  { tenant },
  assignmentId: string
): Promise<void | TicketActionError> => {
  const { knex: db } = await createTenantKnex();
  try {
    await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot remove ticket resource');
    }

    // Verify the resource exists before attempting to delete
    const resource = await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({
        assignment_id: assignmentId,
      })
      .first();

    if (!resource) {
      throw new Error(`Ticket resource not found in tenant ${tenant}`);
    }

    await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({
        assignment_id: assignmentId,
      })
      .delete();
    });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Failed to remove ticket resource:', error);
    throw error;
  }
});

export const getTicketResources = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<ITicketResource[] | TicketActionError> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view ticket resources');
    }

    // First verify the ticket exists
    const ticket = await tenantScopedTable(trx, 'tickets', tenant)
      .where({
        ticket_id: ticketId,
      })
      .first();

    if (!ticket) {
      throw new Error(`Ticket not found in tenant ${tenant}`);
    }

    const resources = await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({
        ticket_id: ticketId,
      })
      .select('*')
      .orderBy('assigned_at', 'desc');

    return resources;
    });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Failed to fetch ticket resources:', error);
    throw error;
  }
});

// Helper function to check if a user can be added as additional agent
export const canAddAsAdditionalAgent = withAuth(async (
  _user,
  { tenant },
  ticketId: string,
  userId: string
): Promise<boolean> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
    // First verify the ticket exists
    const ticket = await tenantScopedTable(trx, 'tickets', tenant)
      .where({
        ticket_id: ticketId,
      })
      .first();

    if (!ticket) {
      throw new Error(`Ticket not found in tenant ${tenant}`);
    }

    // Check if user is already an additional agent
    const existingResource = await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({
        ticket_id: ticketId,
        additional_user_id: userId,
      })
      .first();

    if (existingResource) {
      return false;
    }

    // Check if user is the primary assigned agent
    const isPrimaryAgent = await tenantScopedTable(trx, 'tickets', tenant)
      .where({
        ticket_id: ticketId,
        assigned_to: userId,
      })
      .first();

    return !isPrimaryAgent;
    });
  } catch (error) {
    console.error('Error checking user availability:', error);
    if (error instanceof Error) {
      // Log specific error but return false for this helper function
      console.error(`Tenant ${tenant} error: ${error.message}`);
    }
    return false;
  }
});

// @alga-psa/tickets/actions.ts
'use server'

import { ITicketResource } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { publishEvent } from '@alga-psa/event-bus/publishers';

export async function addTicketResource(
  ticketId: string,
  additionalUserId: string,
  role: string,
  currentUser: IUserWithRoles
): Promise<ITicketResource | null> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      if (!await hasPermission(currentUser, 'ticket', 'update', trx)) {
        throw new Error('Permission denied: Cannot add ticket resource');
      }

      // First, verify that the ticket exists and has the correct assigned_to
      const ticket = await trx('tickets')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        })
        .first();

      if (!ticket) {
        throw new Error(`Ticket not found in tenant ${tenant}`);
      }

      // If the ticket has no primary assignment yet, promote this user to primary
      if (!ticket.assigned_to) {
        const [updatedTicket] = await trx('tickets')
          .where({
            ticket_id: ticketId,
            tenant: tenant
          })
          .update({
            assigned_to: additionalUserId,
            updated_by: currentUser.user_id,
            updated_at: new Date()
          })
          .returning('*');

        if (!updatedTicket) {
          throw new Error(`Failed to set primary assignment for ticket ${ticketId}`);
        }

        await publishEvent({
          eventType: 'TICKET_ASSIGNED',
          payload: {
            tenantId: tenant,
            ticketId: ticketId,
            userId: additionalUserId,
            assignedByUserId: currentUser.user_id
          }
        });

        return null;
      }

      // Check if resource already exists
      const existingResource = await trx('ticket_resources')
        .where({
          ticket_id: ticketId,
          additional_user_id: additionalUserId,
          tenant: tenant
        })
        .first();

      if (existingResource) {
        throw new Error(`Resource already exists for user ${additionalUserId} in tenant ${tenant}`);
      }

      // Create the resource with the ticket's assigned_to
      const [resource] = await trx('ticket_resources')
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
          assignedByUserId: currentUser.user_id
        };
        console.log('[ticketResourceActions] Publishing TICKET_ADDITIONAL_AGENT_ASSIGNED event:', JSON.stringify(eventPayload));
        await publishEvent({
          eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED',
          payload: eventPayload
        });

        return resource;
    } catch (error) {
      console.error('Failed to add ticket resource:', error);
      if (error instanceof Error) {
        // Preserve original error message if it's already specific
        throw error;
      }
      throw new Error(`Failed to add ticket resource in tenant ${tenant}: ${error}`);
    }
  });
}

export async function removeTicketResource(
  assignmentId: string,
  currentUser: IUserWithRoles
): Promise<void> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      if (!await hasPermission(currentUser, 'ticket', 'update', trx)) {
        throw new Error('Permission denied: Cannot remove ticket resource');
      }

      // Verify the resource exists before attempting to delete
      const resource = await trx('ticket_resources')
        .where({
          assignment_id: assignmentId,
          tenant: tenant
        })
        .first();

      if (!resource) {
        throw new Error(`Ticket resource not found in tenant ${tenant}`);
      }

    await trx('ticket_resources')
      .where({
        assignment_id: assignmentId,
        tenant: tenant
      })
        .delete();
    } catch (error) {
      console.error('Failed to remove ticket resource:', error);
      if (error instanceof Error) {
        // Preserve original error message if it's already specific
        throw error;
      }
      throw new Error(`Failed to remove ticket resource in tenant ${tenant}: ${error}`);
    }
  });
}

export async function getTicketResources(
  ticketId: string,
  currentUser: IUserWithRoles
): Promise<ITicketResource[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      if (!await hasPermission(currentUser, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view ticket resources');
      }

      // First verify the ticket exists
      const ticket = await trx('tickets')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        })
        .first();

      if (!ticket) {
        throw new Error(`Ticket not found in tenant ${tenant}`);
      }

    const resources = await trx('ticket_resources')
      .where({
        ticket_id: ticketId,
        tenant: tenant
      })
      .select('*')
      .orderBy('assigned_at', 'desc');

      return resources;
    } catch (error) {
      console.error('Failed to fetch ticket resources:', error);
      if (error instanceof Error) {
        // Preserve original error message if it's already specific
        throw error;
      }
      throw new Error(`Failed to fetch ticket resources in tenant ${tenant}: ${error}`);
    }
  });
}

// Helper function to check if a user can be added as additional agent
export async function canAddAsAdditionalAgent(
  ticketId: string,
  userId: string,
  currentUser: IUserWithRoles
): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // First verify the ticket exists
    const ticket = await trx('tickets')
      .where({
        ticket_id: ticketId,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error(`Ticket not found in tenant ${tenant}`);
    }

    // Check if user is already an additional agent
    const existingResource = await trx('ticket_resources')
      .where({
        ticket_id: ticketId,
        additional_user_id: userId,
        tenant: tenant
      })
      .first();

    if (existingResource) {
      return false;
    }

    // Check if user is the primary assigned agent
    const isPrimaryAgent = await trx('tickets')
      .where({
        ticket_id: ticketId,
        assigned_to: userId,
        tenant: tenant
      })
      .first();

      return !isPrimaryAgent;
    } catch (error) {
      console.error('Error checking user availability:', error);
      if (error instanceof Error) {
        // Log specific error but return false for this helper function
        console.error(`Tenant ${tenant} error: ${error.message}`);
      }
      return false;
    }
  });
}

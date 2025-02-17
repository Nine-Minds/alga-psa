// server/src/lib/actions/ticketResourceActions.ts
'use server'

import { ITicketResource } from '@/interfaces/ticketResource.interfaces';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import TicketResource from '@/lib/models/ticketResource';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/lib/db';

export async function addTicketResource(
  ticketId: string,
  additionalUserId: string,
  role: string,
  currentUser: IUserWithRoles
): Promise<ITicketResource> {
  if (!await hasPermission(currentUser, 'ticket', 'update')) {
    throw new Error('Permission denied: Cannot add ticket resource');
  }

  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // First, verify that the ticket exists and has the correct assigned_to
    const ticket = await db('tickets')
      .where({
        ticket_id: ticketId,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error(`Ticket not found in tenant ${tenant}`);
    }

    // Check if resource already exists
    const existingResource = await db('ticket_resources')
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
    const [resource] = await db('ticket_resources')
      .insert({
        ticket_id: ticketId,
        assigned_to: ticket.assigned_to,
        additional_user_id: additionalUserId,
        role: role,
        tenant: tenant,
        assigned_at: new Date()
      })
      .returning('*');

    return resource;
  } catch (error) {
    console.error('Failed to add ticket resource:', error);
    if (error instanceof Error) {
      // Preserve original error message if it's already specific
      throw error;
    }
    throw new Error(`Failed to add ticket resource in tenant ${tenant}: ${error}`);
  }
}

export async function removeTicketResource(
  assignmentId: string,
  currentUser: IUserWithRoles
): Promise<void> {
  if (!await hasPermission(currentUser, 'ticket', 'update')) {
    throw new Error('Permission denied: Cannot remove ticket resource');
  }

  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // Verify the resource exists before attempting to delete
    const resource = await db('ticket_resources')
      .where({
        assignment_id: assignmentId,
        tenant: tenant
      })
      .first();

    if (!resource) {
      throw new Error(`Ticket resource not found in tenant ${tenant}`);
    }

    await db('ticket_resources')
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
}

export async function getTicketResources(
  ticketId: string,
  currentUser: IUserWithRoles
): Promise<ITicketResource[]> {
  if (!await hasPermission(currentUser, 'ticket', 'read')) {
    throw new Error('Permission denied: Cannot view ticket resources');
  }

  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // First verify the ticket exists
    const ticket = await db('tickets')
      .where({
        ticket_id: ticketId,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error(`Ticket not found in tenant ${tenant}`);
    }

    const resources = await db('ticket_resources')
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
}

// Helper function to check if a user can be added as additional agent
export async function canAddAsAdditionalAgent(
  ticketId: string,
  userId: string,
  currentUser: IUserWithRoles
): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  try {
    // First verify the ticket exists
    const ticket = await db('tickets')
      .where({
        ticket_id: ticketId,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error(`Ticket not found in tenant ${tenant}`);
    }

    // Check if user is already an additional agent
    const existingResource = await db('ticket_resources')
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
    const isPrimaryAgent = await db('tickets')
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
}

/**
 * Ticket server actions
 *
 * These are Next.js server actions for ticket operations.
 * They handle validation, authorization, and delegate to the repository.
 */

'use server';

import { createTicketRepository } from '../repositories/index.js';
import {
  createTicketSchema,
  updateTicketSchema,
  type Ticket,
  type TicketFilters,
  type TicketListResponse,
  type TicketListItem,
  type CreateTicketInput,
  type UpdateTicketInput,
} from '../types/index.js';

// Note: In the real implementation, these would import from @alga-psa/database
// For now, we define the types that will be injected
type Knex = import('knex').Knex;

/**
 * Server action context provided by the app shell
 */
interface ActionContext {
  tenantId: string;
  userId: string;
  knex: Knex;
}

/**
 * Get a list of tickets for the current tenant
 */
export async function getTickets(
  context: ActionContext,
  filters: TicketFilters = {}
): Promise<TicketListResponse> {
  const repo = createTicketRepository(context.knex);
  return repo.findMany(context.tenantId, filters);
}

/**
 * Get a list of tickets with display details (joined data)
 */
export async function getTicketsWithDetails(
  context: ActionContext,
  filters: TicketFilters = {}
): Promise<{ items: TicketListItem[]; total: number; limit: number; offset: number }> {
  const repo = createTicketRepository(context.knex);
  return repo.findManyWithDetails(context.tenantId, filters);
}

/**
 * Get a single ticket by ID
 */
export async function getTicket(
  context: ActionContext,
  ticketId: string
): Promise<Ticket | null> {
  const repo = createTicketRepository(context.knex);
  return repo.findById(context.tenantId, ticketId);
}

/**
 * Create a new ticket
 */
export async function createTicket(
  context: ActionContext,
  input: CreateTicketInput
): Promise<{ success: true; ticket: Ticket } | { success: false; error: string }> {
  // Validate input
  const validation = createTicketSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createTicketRepository(context.knex);
    const ticket = await repo.create(
      context.tenantId,
      context.userId,
      validation.data
    );
    return { success: true, ticket };
  } catch (error) {
    console.error('[tickets/actions] Failed to create ticket:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create ticket',
    };
  }
}

/**
 * Update an existing ticket
 */
export async function updateTicket(
  context: ActionContext,
  input: UpdateTicketInput
): Promise<{ success: true; ticket: Ticket } | { success: false; error: string }> {
  // Validate input
  const validation = updateTicketSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createTicketRepository(context.knex);
    const ticket = await repo.update(
      context.tenantId,
      context.userId,
      validation.data
    );

    if (!ticket) {
      return { success: false, error: 'Ticket not found' };
    }

    return { success: true, ticket };
  } catch (error) {
    console.error('[tickets/actions] Failed to update ticket:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update ticket',
    };
  }
}

/**
 * Close a ticket
 */
export async function closeTicket(
  context: ActionContext,
  ticketId: string,
  closedStatusId: string
): Promise<{ success: true; ticket: Ticket } | { success: false; error: string }> {
  try {
    const repo = createTicketRepository(context.knex);
    const ticket = await repo.close(
      context.tenantId,
      context.userId,
      ticketId,
      closedStatusId
    );

    if (!ticket) {
      return { success: false, error: 'Ticket not found' };
    }

    return { success: true, ticket };
  } catch (error) {
    console.error('[tickets/actions] Failed to close ticket:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to close ticket',
    };
  }
}

/**
 * Delete a ticket (soft delete)
 */
export async function deleteTicket(
  context: ActionContext,
  ticketId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createTicketRepository(context.knex);
    const deleted = await repo.delete(context.tenantId, ticketId);

    if (!deleted) {
      return { success: false, error: 'Ticket not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[tickets/actions] Failed to delete ticket:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete ticket',
    };
  }
}

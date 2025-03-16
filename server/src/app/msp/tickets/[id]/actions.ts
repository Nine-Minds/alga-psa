'use server';

import { getTenantForCurrentRequest } from 'server/src/lib/tenant';
import Ticket from 'server/src/lib/models/ticket';
import { ITicket } from 'server/src/interfaces/ticket.interfaces';

/**
 * Server action to fetch ticket data with tenant information
 * This separates server-side data fetching from client-side rendering
 * to avoid using server-only features in client components
 */
export async function getTicketData(id: string) {
  try {
    // Get tenant first
    const tenantResult = await getTenantForCurrentRequest();
    const tenant = tenantResult || undefined;
    
    // Get ticket details
    const ticket = await Ticket.get(id);
    
    return {
      ticket: ticket ? { ...ticket, tenant } : undefined,
      error: null
    };
  } catch (error) {
    console.error(`Error fetching ticket with id ${id}:`, error);
    return {
      ticket: undefined,
      error: `Failed to load ticket data: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
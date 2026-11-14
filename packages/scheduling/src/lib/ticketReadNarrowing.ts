import { hasPermission } from '@alga-psa/auth';
import { createTicketReadScope, narrowTicketQueryToReadable } from '@alga-psa/authorization/ticketReadAuthorization';

/**
 * Narrow a tenant-scoped `tickets as <alias>` query to the tickets the reader may read: the `ticket:read`
 * permission first, then the ticket read policy in SQL (the compiler the ticket list uses), so counts and pages
 * are already in scope. A reader without the permission gets no tickets. Scheduling's ticket lookups and work item
 * searches all narrow through this one function.
 */
export async function narrowTicketsToReadable(db: any, tenant: string, user: any, ticketsQuery: any, alias = 't'): Promise<void> {
  if (!await hasPermission(user, 'ticket', 'read', db)) {
    ticketsQuery.whereRaw('1 = 0');
    return;
  }
  await narrowTicketQueryToReadable(db, await createTicketReadScope(db, tenant, user), ticketsQuery, alias);
}

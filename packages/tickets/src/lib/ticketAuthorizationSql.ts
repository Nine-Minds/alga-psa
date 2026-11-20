import type { Knex } from 'knex';
import type { RelationshipSqlAdapter } from '@alga-psa/authorization/kernel';
import { tenantDb } from '@alga-psa/db';
import { createTicketRelationshipSqlAdapter as createSharedTicketAdapter } from '@alga-psa/authorization/clientScopeSqlAdapters';

type TicketDbConnection = Knex | Knex.Transaction;

/**
 * Physical mapping the shared read-authorization SQL compiler needs for the
 * `tickets` table. Mirrors `toTicketAuthorizationRecord`: a ticket is
 * "assigned" only to its primary `assigned_to`.
 *
 * Shared by the web server-action list and the public API list so both paths
 * authorize identically — a single source of truth for the ticket adapter.
 */
export function createTicketRelationshipSqlAdapter(
  _conn: TicketDbConnection,
  _tenant: string,
  alias: string = 't'
): RelationshipSqlAdapter {
  return createSharedTicketAdapter(alias);
}

/**
 * Batch-fetch `ticket_resources.additional_user_id` (co-assignees) keyed by
 * ticket_id. Used by non-authorization ticket features that need additional
 * agent metadata. These rows are intentionally not used as read grants because
 * some workflows can create them without ticket row-level authorization.
 */
export async function fetchTicketAdditionalUserIds(
  conn: TicketDbConnection,
  tenant: string,
  ticketIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ticketIds.length === 0) {
    return map;
  }
  const rows = await tenantDb(conn, tenant)
    .table('ticket_resources')
    .whereIn('ticket_id', ticketIds)
    .whereNotNull('additional_user_id')
    .select<{ ticket_id: string; additional_user_id: string }[]>('ticket_id', 'additional_user_id');
  for (const row of rows) {
    const ids = map.get(row.ticket_id) ?? [];
    ids.push(row.additional_user_id);
    map.set(row.ticket_id, ids);
  }
  return map;
}

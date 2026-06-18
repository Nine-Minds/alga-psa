import type { Knex } from 'knex';
import type { RelationshipSqlAdapter } from '@alga-psa/authorization/kernel';

type TicketDbConnection = Knex | Knex.Transaction;

/**
 * Physical mapping the shared read-authorization SQL compiler needs for the
 * `tickets` table. Mirrors `toTicketAuthorizationRecord`: a ticket is
 * "assigned" to its primary `assigned_to` OR any `ticket_resources`
 * `additional_user_id` co-assignee.
 *
 * Shared by the web server-action list and the public API list so both paths
 * authorize identically — a single source of truth for the ticket adapter.
 */
export function createTicketRelationshipSqlAdapter(
  conn: TicketDbConnection,
  tenant: string
): RelationshipSqlAdapter {
  return {
    ownerColumn: 't.entered_by',
    clientColumn: 't.client_id',
    boardColumn: 't.board_id',
    teamColumn: 't.assigned_team_id',
    // Tickets expose no client-visibility column ⇒ `client_visible_only` denies,
    // matching the JS kernel (record.is_client_visible is absent).
    applyAssignedUsers(query, userIds) {
      const normalizedUserIds = Array.from(
        new Set(userIds.filter((value): value is string => typeof value === 'string' && value.length > 0))
      );
      if (normalizedUserIds.length === 0) {
        query.whereRaw('1 = 0');
        return;
      }

      if (normalizedUserIds.length === 1) {
        query.where('t.assigned_to', normalizedUserIds[0]);
      } else {
        query.whereIn('t.assigned_to', normalizedUserIds);
      }

      query.orWhereExists(function () {
        this.select(conn.raw('1'))
          .from('ticket_resources as tr_auth')
          .whereRaw('tr_auth.tenant = t.tenant')
          .whereRaw('tr_auth.ticket_id = t.ticket_id')
          .andWhere('tr_auth.tenant', tenant)
          .whereNotNull('tr_auth.additional_user_id');

        if (normalizedUserIds.length === 1) {
          this.andWhere('tr_auth.additional_user_id', normalizedUserIds[0]);
        } else {
          this.whereIn('tr_auth.additional_user_id', normalizedUserIds);
        }
      });
    },
  };
}

/**
 * Batch-fetch `ticket_resources.additional_user_id` (co-assignees) keyed by
 * ticket_id. Used to build JS authorization records that count co-assignees the
 * same way `createTicketRelationshipSqlAdapter` does in SQL.
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
  const rows = await conn('ticket_resources')
    .where({ tenant })
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

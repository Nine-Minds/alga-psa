'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';

export interface ClientTicketStats {
  openTicketCount: number;
}

/**
 * Open ticket counts for every client in the tenant, in one grouped query.
 *
 * Feeds the client grid cards, which render immediately and fill the count in
 * when it lands — the same out-of-band pattern the board tab strip uses for
 * getBoardListStats. A count is decoration; the grid must stay usable without it.
 *
 * "Open" is `statuses.is_closed IS NOT TRUE`, joined — deliberately the same
 * predicate as getBoardListStats, so the number on a card and the ticket list it
 * invites you to open can never describe different sets. NOT the denormalized
 * `tickets.is_closed` column: as of 2026-08 that column is stale on ~24% of
 * production tickets (545/2261, all in the same direction — ticket says open,
 * status says closed), so filtering on it roughly doubles the count.
 *
 * Only clients with at least one open ticket get an entry. The card hides the
 * row when there is no count, so absent and zero mean the same thing here and
 * a tenant-wide LEFT JOIN to seed zeroes would buy nothing.
 */
export const getClientOpenTicketCounts = withAuth(
  async (user, { tenant }): Promise<Record<string, number>> => {
    if (!(await hasPermission(user, 'ticket', 'read'))) {
      // Not an error: a user without ticket access sees cards without counts.
      return {};
    }

    const { knex: db } = await createTenantKnex();

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const rows = await trx('tickets as t')
        .leftJoin('statuses as s', function joinStatuses() {
          this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
        })
        .where('t.tenant', tenant)
        .whereNotNull('t.client_id')
        .whereRaw('s.is_closed IS NOT TRUE')
        .groupBy('t.client_id')
        .select('t.client_id')
        .select(trx.raw('COUNT(*)::int as open_count'));

      const counts: Record<string, number> = {};
      for (const row of rows as Array<{ client_id: string; open_count: number }>) {
        counts[row.client_id] = row.open_count;
      }
      return counts;
    });
  },
);

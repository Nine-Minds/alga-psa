import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

/**
 * Client credit balance is a derived value: the sum of what remains on the
 * client's non-expired credit_tracking entries. There is no cached column to
 * keep in sync — this module is the single definition of "available credit".
 */

function activeCreditRows(
    conn: Knex | Knex.Transaction,
    tenant: string
): Knex.QueryBuilder {
    return tenantDb(conn, tenant)
        .table('credit_tracking')
        .where('credit_tracking.tenant', tenant)
        .where('credit_tracking.is_expired', false)
        .where((qb) => {
            qb.whereNull('credit_tracking.expiration_date')
              .orWhere('credit_tracking.expiration_date', '>', new Date().toISOString());
        });
}

/**
 * Available credit for one client, in minor units. When currencyCode is given,
 * only credits in that currency count — which is what invoice application
 * needs; without it, the sum spans currencies and is only meaningful for
 * clients that hold a single currency.
 */
export async function getAvailableCredit(
    conn: Knex | Knex.Transaction,
    tenant: string,
    clientId: string,
    currencyCode?: string
): Promise<number> {
    let query = activeCreditRows(conn, tenant)
        .where('credit_tracking.client_id', clientId);
    if (currencyCode) {
        query = query.where('credit_tracking.currency_code', currencyCode);
    }
    const row = await query
        .sum({ total: 'credit_tracking.remaining_amount' })
        .first();
    return Number(row?.total ?? 0);
}

/**
 * Per-client available-credit sums, for joining into client lists, stats, and
 * reports: SELECT client_id, available_credit FROM (this) GROUP BY client_id.
 */
export function availableCreditByClientQuery(
    conn: Knex | Knex.Transaction,
    tenant: string
): Knex.QueryBuilder {
    return activeCreditRows(conn, tenant)
        .select('credit_tracking.client_id')
        .sum({ available_credit: 'credit_tracking.remaining_amount' })
        .groupBy('credit_tracking.client_id');
}

/**
 * Raw SQL scalar subquery yielding a client's available credit, for embedding
 * in query builders that select from `clients` (aliased or not). `clientsRef`
 * is the SQL reference to the clients table/alias in the outer query.
 */
export function availableCreditSubquerySql(clientsRef = 'clients'): string {
    return `COALESCE((
        SELECT SUM(ct.remaining_amount)
        FROM credit_tracking ct
        WHERE ct.tenant = ${clientsRef}.tenant
          AND ct.client_id = ${clientsRef}.client_id
          AND ct.is_expired = false
          AND (ct.expiration_date IS NULL OR ct.expiration_date > NOW())
    ), 0)`;
}

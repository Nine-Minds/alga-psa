import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * The name of the client the tenant marked as its own company.
 *
 * One query shared by every surface that speaks as the MSP — the dashboard
 * welcome banner, the appointment ICS payload — so "our own name" cannot drift
 * between them. Null when no default client is set or its name is blank, which
 * leaves each caller its own fallback.
 */
export async function resolveTenantDefaultCompanyName(
  conn: Knex | Knex.Transaction,
  tenant: string
): Promise<string | null> {
  const db = tenantDb(conn, tenant);

  const query = db.table('tenant_companies')
    .where({ 'tenant_companies.is_default': true, 'tenant_companies.deleted_at': null })
    .select('clients.client_name')
    .first();
  db.tenantJoin(query, 'clients', 'clients.client_id', 'tenant_companies.client_id');

  const row = await query as { client_name?: string | null } | undefined;
  const name = typeof row?.client_name === 'string' ? row.client_name.trim() : '';

  return name || null;
}

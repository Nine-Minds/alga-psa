import type { Knex } from 'knex';
import { registerTenantTables, tenantDb } from '@alga-psa/db';

let registered = false;

/**
 * `tenantDb` for code that touches the Enterprise-owned `service_principals`
 * table. The table is registered with the shared tenant-table registry on first
 * use instead of at import time, so importing this module has no side effects
 * and no caller depends on which service-principal module happened to load first.
 */
export function servicePrincipalDb(conn: Knex | Knex.Transaction, tenant: string) {
  if (!registered) {
    registerTenantTables({ service_principals: { scope: 'tenant' } });
    registered = true;
  }
  return tenantDb(conn, tenant);
}

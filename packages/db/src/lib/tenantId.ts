import type { Knex } from 'knex';
import { getTenantContext, getConnection } from './tenant';

export async function resolveTenantId(knexOrTrx?: Knex | Knex.Transaction): Promise<string | null> {
  let tenant = getTenantContext() ?? null;

  // Development-only escape hatch: fallback to the first tenant in the DB.
  // Default is strict (no fallback) so missing tenant wiring fails fast in dev.
  if (!tenant && process.env.NODE_ENV !== 'production' && process.env.ALGA_TENANT_FALLBACK === '1') {
    try {
      const knex = knexOrTrx ?? (await getConnection(null));
      const row = await knex<{ tenant: string }>('tenants').select('tenant').first();
      tenant = row?.tenant ?? null;
    } catch {
      // ignore
    }
  }

  return tenant;
}

export async function requireTenantId(knexOrTrx?: Knex | Knex.Transaction): Promise<string> {
  const tenant = await resolveTenantId(knexOrTrx);
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  return tenant;
}

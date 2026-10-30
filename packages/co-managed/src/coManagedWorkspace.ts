import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

// A tenant's product never changes during normal operation, so native hot paths ask once per TTL and then
// cost zero statements (PLAN §3: "cached 'not co-managed' fast path").
const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expires: number }>();

export async function isCoManagedWorkspace(db: Knex, tenant: string): Promise<boolean> {
  const hit = cache.get(tenant);
  if (hit && hit.expires > Date.now()) return hit.value;
  const row = await tenantDb(db, tenant).table('tenants').first('product_code');
  const value = row?.product_code === 'co_managed';
  cache.set(tenant, { value, expires: Date.now() + TTL_MS });
  return value;
}

export function resetCoManagedWorkspaceCache(): void { cache.clear(); }

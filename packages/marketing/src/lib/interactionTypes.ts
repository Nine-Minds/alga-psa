import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { MarketingInteractionTypeName } from '@alga-psa/types';

/**
 * Resolves the tenant interaction type ids seeded by
 * 20260719103000_seed_marketing_interaction_types.cjs. Cached per process —
 * these rows are stable for the lifetime of a tenant.
 */
const cache = new Map<string, string>();

export async function getMarketingInteractionTypeId(
  knex: Knex | Knex.Transaction,
  tenant: string,
  typeName: MarketingInteractionTypeName,
): Promise<string> {
  const key = `${tenant}:${typeName}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const db = tenantDb(knex, tenant);
  const row = await db.table('interaction_types')
    .where({ tenant, type_name: typeName })
    .first('type_id');
  if (!row) {
    throw new Error(`Marketing interaction type missing for tenant: ${typeName}`);
  }
  cache.set(key, String(row.type_id));
  return String(row.type_id);
}

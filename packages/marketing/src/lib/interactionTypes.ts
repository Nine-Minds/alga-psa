import type { Knex } from 'knex';
import type { MarketingInteractionTypeName } from '@alga-psa/types';

/**
 * Resolves the system interaction type ids seeded by
 * 20260719103000_seed_marketing_interaction_types.cjs. Marketing types live in
 * the global `system_interaction_types` table (opportunities' 'Note'
 * precedent), so no tenant scoping — and no per-tenant seed gap for tenants
 * created after the migration ran. Cached per process; these rows are stable.
 */
const cache = new Map<string, string>();

export async function getMarketingInteractionTypeId(
  knex: Knex | Knex.Transaction,
  tenant: string,
  typeName: MarketingInteractionTypeName,
): Promise<string> {
  const hit = cache.get(typeName);
  if (hit) return hit;

  const row = await knex('system_interaction_types')
    .where({ type_name: typeName })
    .first('type_id');
  if (!row) {
    throw new Error(`Marketing interaction type missing from system_interaction_types: ${typeName}`);
  }
  cache.set(typeName, String(row.type_id));
  return String(row.type_id);
}

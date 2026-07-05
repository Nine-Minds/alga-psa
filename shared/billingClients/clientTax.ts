import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export async function getClientDefaultTaxRegionCode(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<string | null> {
  const db = tenantDb(knexOrTrx, tenant);
  const query = db.table('client_tax_rates as ctr');
  db.tenantJoin(query, 'tax_rates as tr', 'ctr.tax_rate_id', 'tr.tax_rate_id');
  const result = await query
    .where({
      'ctr.client_id': clientId,
      'ctr.is_default': true,
    })
    .whereNull('ctr.location_id')
    .select({ region_code: 'tr.region_code' })
    .first();

  return result?.region_code ?? null;
}

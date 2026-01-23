import type { Knex } from 'knex';

export async function getClientDefaultTaxRegionCode(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<string | null> {
  const result = await knexOrTrx('client_tax_rates as ctr')
    .join('tax_rates as tr', function joinTaxRates() {
      this.on('ctr.tax_rate_id', '=', 'tr.tax_rate_id').andOn('ctr.tenant', '=', 'tr.tenant');
    })
    .where({
      'ctr.client_id': clientId,
      'ctr.tenant': tenant,
      'ctr.is_default': true,
    })
    .whereNull('ctr.location_id')
    .select('tr.region_code')
    .first();

  return result?.region_code ?? null;
}


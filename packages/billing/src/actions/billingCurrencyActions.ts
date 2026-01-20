'use server';

import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from '@alga-psa/db';

export async function resolveClientBillingCurrency(clientId: string, asOfDate?: string): Promise<string> {
  const { knex, tenant } = await createTenantKnex();
  const effectiveDate = asOfDate || Temporal.Now.plainDateISO().toString();

  const client = await knex('clients')
    .where({ tenant, client_id: clientId })
    .select('default_currency_code')
    .first();

  const currencies = await knex('client_contracts as cc')
    .join('contracts as c', function () {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .where({
      'cc.tenant': tenant,
      'cc.client_id': clientId,
      'cc.is_active': true
    })
    .where('cc.start_date', '<=', effectiveDate)
    .where(function () {
      this.whereNull('cc.end_date').orWhere('cc.end_date', '>=', effectiveDate);
    })
    .whereNotNull('c.currency_code')
    .distinct('c.currency_code');

  const unique = Array.from(new Set(currencies.map((r: any) => r.currency_code).filter(Boolean)));
  if (unique.length > 1) {
    throw new Error(`Client has active contracts in multiple currencies (${unique.join(', ')}).`);
  }

  return unique[0] || client?.default_currency_code || 'USD';
}


import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isSupportedCurrency } from '@alga-psa/core';

/**
 * The tenant's default billing currency (`default_billing_settings.default_currency_code`),
 * or null when none is configured. This is the one source for "which currency
 * when nothing else says": never fall back to a literal currency code.
 */
export async function getTenantDefaultCurrency(
  trx: Knex | Knex.Transaction,
  tenant: string,
): Promise<string | null> {
  const row = await tenantDb(trx, tenant)
    .table('default_billing_settings')
    .first('default_currency_code');
  const code = typeof row?.default_currency_code === 'string' ? row.default_currency_code.trim() : '';
  return code && isSupportedCurrency(code) ? code : null;
}

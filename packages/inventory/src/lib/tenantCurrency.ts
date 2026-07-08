import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export async function resolveTenantCurrency(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<string> {
  const row = await tenantDb(knex, tenant)
    .table('default_billing_settings')
    .select<{ default_currency_code: string | null }>('default_currency_code')
    .first();

  return row?.default_currency_code?.trim() || 'USD';
}

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * The tenant's configured billing currency, or `null` when none is configured.
 * Callers that must not guess (AMP imports) use this directly.
 */
export async function resolveConfiguredTenantCurrency(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<string | null> {
  const row = await tenantDb(knex, tenant)
    .table('default_billing_settings')
    .select<{ default_currency_code: string | null }>('default_currency_code')
    .first();

  return row?.default_currency_code?.trim() || null;
}

export async function resolveTenantCurrency(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<string> {
  // LEVERAGE: friction tenant-currency-usd-fallback — interactive inventory flows
  // historically fall back to 'USD' when the tenant has no configured currency.
  // AMP importers must not guess, so they call resolveConfiguredTenantCurrency.
  return (await resolveConfiguredTenantCurrency(knex, tenant)) ?? 'USD';
}

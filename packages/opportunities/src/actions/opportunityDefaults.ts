'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';

/**
 * Default currency for a new opportunity: the client's configured currency,
 * else the tenant billing default. Mirrors the cascade quoteActions uses.
 */
export const getClientDefaultCurrency = withAuth(async (_user, { tenant }, clientId: string): Promise<string> => {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const client = await db.table('clients').where({ client_id: clientId }).select('default_currency_code').first();
  if (client?.default_currency_code) return client.default_currency_code;
  const settings = await db.table('billing_settings').select('default_currency_code').first();
  return settings?.default_currency_code ?? 'USD';
});

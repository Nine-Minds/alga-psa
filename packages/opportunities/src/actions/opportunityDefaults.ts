'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { ClientLifecycleStatus } from '@alga-psa/types';

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

/**
 * Lifecycle of the client picked in the create dialog (it seeds the opportunity type). Read by id
 * because the client picker searches on the server and the dialog never holds the client list.
 * Null when the caller cannot read clients or the client does not exist.
 */
// LEVERAGE: pattern client-extra-fields-by-id — a picked client's non-name fields (here lifecycle, in inventory the currency) are re-read by id per package; a shared by-ids lookup injected through the picker context would serve both.
export const getClientLifecycleStatus = withAuth(
  async (user, { tenant }, clientId: string): Promise<ClientLifecycleStatus | null> => {
    if (!(await hasPermission(user, 'client', 'read'))) return null;
    const { knex } = await createTenantKnex();
    const client = await tenantDb(knex, tenant)
      .table('clients')
      .where({ client_id: clientId })
      .select('lifecycle_status')
      .first();
    return (client?.lifecycle_status as ClientLifecycleStatus | undefined) ?? null;
  },
);

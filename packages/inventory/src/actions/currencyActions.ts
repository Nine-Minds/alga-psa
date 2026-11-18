'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { resolveTenantCurrency } from '../lib';

export const getInventoryTenantCurrency = withAuth(
  async (user, { tenant }): Promise<string> => {
    if (!(await hasPermission(user, 'inventory', 'read'))) {
      throw new Error('Permission denied: inventory read required');
    }

    const { knex } = await createTenantKnex();
    return resolveTenantCurrency(knex, tenant);
  },
);

/**
 * The currency one client is billed in, read by id (the sales-order dialog derives its currency from
 * the picked client). The client picker searches on the server and never holds the tenant's list, so
 * the picked row is looked up here instead. Null when the client is not visible to the caller; the
 * caller falls back to the tenant currency.
 */
export const getInventoryClientCurrency = withAuth(
  async (user, { tenant }, clientId: string): Promise<string | null> => {
    if (!(await hasPermission(user, 'inventory', 'read')) || !(await hasPermission(user, 'client', 'read'))) {
      throw new Error('Permission denied: inventory read and client read required');
    }

    const { knex } = await createTenantKnex();
    const scope = await createClientScopeContext(knex, tenant, user);
    if (!(await scope.permits('client', clientId))) return null;

    const row = await tenantDb(knex, tenant)
      .table('clients')
      .where({ client_id: clientId })
      .first('default_currency_code');
    return (row?.default_currency_code as string | null | undefined) ?? null;
  },
);

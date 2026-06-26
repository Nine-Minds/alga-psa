'use server'

import { withTransaction, createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth, withOptionalAuth } from '@alga-psa/auth';
import type { Tenant, TenantCompany } from '@alga-psa/types';
import type { Knex } from 'knex';

// Returns the current tenant ID, or null if not authenticated
// Uses withOptionalAuth to support both authenticated and unauthenticated contexts (e.g., layout)
export const getCurrentTenant = withOptionalAuth(async (_user, ctx): Promise<string | null> => {
  return ctx?.tenant ?? null;
});

const tenantScopedTable = (trx: Knex.Transaction, table: string, tenant: string) =>
  tenantDb(trx, tenant).table(table);

export const getTenantDetails = withAuth(async (_user, { tenant }): Promise<Tenant & { clients: TenantCompany[] }> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [tenantDetails] = (await tenantScopedTable(trx, 'tenants', tenant)
      .select('*')) as Tenant[];

    const clientsQuery = tenantDb(trx, tenant).table('tenant_companies as tc');
    tenantDb(trx, tenant).tenantJoin(clientsQuery, 'clients as c', 'tc.client_id', 'c.client_id');

    const clients = (await clientsQuery
      .select(
        'c.client_id as client_id',
        'c.client_name as client_name',
        'tc.is_default as is_default',
        'tc.created_at as created_at',
        'tc.updated_at as updated_at'
      )
      .whereNull('tc.deleted_at')) as unknown as TenantCompany[];

    return {
      ...tenantDetails,
      clients
    };
  });
});

export const updateTenantName = withAuth(async (_user, { tenant }, name: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await tenantScopedTable(trx, 'tenants', tenant)
      .update({ client_name: name });
  });
});

export const addClientToTenant = withAuth(async (_user, { tenant }, clientId: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await tenantScopedTable(trx, 'tenant_companies', tenant)
      .insert({
        tenant,
        client_id: clientId,
        is_default: false
      });
  });
});

export const removeClientFromTenant = withAuth(async (_user, { tenant }, clientId: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await tenantScopedTable(trx, 'tenant_companies', tenant)
      .where('client_id', clientId)
      .update({ deleted_at: trx.fn.now() });
  });
});

export const setDefaultClient = withAuth(async (_user, { tenant }, clientId: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Clear existing default
    await tenantScopedTable(trx, 'tenant_companies', tenant)
      .where('is_default', true)
      .update({ is_default: false });

    // Set new default
    await tenantScopedTable(trx, 'tenant_companies', tenant)
      .where('client_id', clientId)
      .update({ is_default: true });
  });
});

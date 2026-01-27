'use server'

import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth, withOptionalAuth } from '@alga-psa/auth';
import type { Tenant, TenantCompany } from '@alga-psa/types';
import { Knex } from 'knex';

// Returns the current tenant ID, or null if not authenticated
// Uses withOptionalAuth to support both authenticated and unauthenticated contexts (e.g., layout)
export const getCurrentTenant = withOptionalAuth(async (_user, ctx): Promise<string | null> => {
  return ctx?.tenant ?? null;
});

export const getTenantDetails = withAuth(async (_user, { tenant }): Promise<Tenant & { clients: TenantCompany[] }> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [tenantDetails] = await trx('tenants')
      .select('*')
      .where('tenant', tenant);

    const clients = await trx('tenant_companies as tc')
      .join('clients as c', function() {
        this.on('tc.client_id', '=', 'c.client_id')
            .andOn('tc.tenant', '=', 'c.tenant');
      })
      .select(
        'c.client_id',
        'c.client_name',
        'tc.is_default',
        'tc.created_at',
        'tc.updated_at'
      )
      .where('tc.tenant', tenant)
      .whereNull('tc.deleted_at');

    return {
      ...tenantDetails,
      clients
    };
  });
});

export const updateTenantName = withAuth(async (_user, { tenant }, name: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await trx('tenants')
      .where('tenant', tenant)
      .update({ client_name: name });
  });
});

export const addClientToTenant = withAuth(async (_user, { tenant }, clientId: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await trx('tenant_companies')
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
    await trx('tenant_companies')
      .where('tenant', tenant)
      .where('client_id', clientId)
      .update({ deleted_at: trx.fn.now() });
  });
});

export const setDefaultClient = withAuth(async (_user, { tenant }, clientId: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Clear existing default
    await trx('tenant_companies')
      .where('tenant', tenant)
      .where('is_default', true)
      .update({ is_default: false });

    // Set new default
    await trx('tenant_companies')
      .where('tenant', tenant)
      .where('client_id', clientId)
      .update({ is_default: true });
  });
});

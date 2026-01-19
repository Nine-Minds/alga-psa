'use server'

import { getTenantForCurrentRequest } from '@alga-psa/tenancy/server';
import { withTransaction } from '@alga-psa/db';
import type { Tenant, TenantCompany } from '@alga-psa/types';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { getSession } from '@alga-psa/auth';

export async function getCurrentTenant(): Promise<string | null> {
  try {
    const tenantFromRequest = await getTenantForCurrentRequest();
    if (tenantFromRequest) {
      return tenantFromRequest;
    }
  } catch {
    // The per-request tenant context is not always available (e.g. in server actions).
  }

  try {
    const session = await getSession();
    const tenantCandidate = (session as any)?.user?.tenant;
    if (typeof tenantCandidate === 'string' && tenantCandidate.length > 0) {
      return tenantCandidate;
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch tenant:', error);
    throw new Error('Failed to fetch tenant');
  }
}

export async function getTenantDetails(): Promise<Tenant & { clients: TenantCompany[] }> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex: db } = await createTenantKnex(tenantId);
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [tenantDetails] = await trx('tenants')
      .select('*')
      .where('tenant', tenantId);

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
      .where('tc.tenant', tenantId)
      .whereNull('tc.deleted_at');

    return {
      ...tenantDetails,
      clients
    };
  });
}

export async function updateTenantName(name: string): Promise<void> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex: db } = await createTenantKnex(tenantId);
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await trx('tenants')
      .where('tenant', tenantId)
      .update({ client_name: name });
  });
}

export async function addClientToTenant(clientId: string): Promise<void> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex: db } = await createTenantKnex(tenantId);
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await trx('tenant_companies')
      .insert({
        tenant: tenantId,
        client_id: clientId,
        is_default: false
      });
  });
}

export async function removeClientFromTenant(clientId: string): Promise<void> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex: db } = await createTenantKnex(tenantId);
  return withTransaction(db, async (trx: Knex.Transaction) => {
    await trx('tenant_companies')
      .where('tenant', tenantId)
      .where('client_id', clientId)
      .update({ deleted_at: trx.fn.now() });
  });
}

export async function setDefaultClient(clientId: string): Promise<void> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex: db } = await createTenantKnex(tenantId);
  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Clear existing default
    await trx('tenant_companies')
      .where('tenant', tenantId)
      .where('is_default', true)
      .update({ is_default: false });

    // Set new default
    await trx('tenant_companies')
      .where('tenant', tenantId)
      .where('client_id', clientId)
      .update({ is_default: true });
  });
}

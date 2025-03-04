'use server'

import { getTenantForCurrentRequest } from '../tenant';
import { createTenantKnex } from '../db';
import { Tenant, TenantCompany } from 'server/src/lib/types';
import { Knex } from 'knex';

export async function getCurrentTenant(): Promise<string | null> {
  try {
    return await getTenantForCurrentRequest();
  } catch (error) {
    console.error('Failed to fetch tenant:', error);
    throw new Error('Failed to fetch tenant');
  }
}

export async function getTenantDetails(): Promise<Tenant & { companies: TenantCompany[] }> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex } = await createTenantKnex();
  
  const [tenant] = await knex('tenants')
    .select('*')
    .where('tenant', tenantId);

  const companies = await knex('tenant_companies as tc')
    .join('companies as c', 'tc.company_id', 'c.company_id')
    .select(
      'c.company_id',
      'c.company_name',
      'tc.is_default',
      'tc.created_at',
      'tc.updated_at'
    )
    .where('tc.tenant_id', tenantId)
    .whereNull('tc.deleted_at');

  return {
    ...tenant,
    companies
  };
}

export async function updateTenantName(name: string): Promise<void> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex } = await createTenantKnex();
  await knex('tenants')
    .where('tenant', tenantId)
    .update({ company_name: name });
}

export async function addCompanyToTenant(companyId: string): Promise<void> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex } = await createTenantKnex();
  await knex('tenant_companies')
    .insert({
      tenant_id: tenantId,
      company_id: companyId,
      is_default: false
    });
}

export async function removeCompanyFromTenant(companyId: string): Promise<void> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex } = await createTenantKnex();
  await knex('tenant_companies')
    .where('tenant_id', tenantId)
    .where('company_id', companyId)
    .update({ deleted_at: knex.fn.now() });
}

export async function setDefaultCompany(companyId: string): Promise<void> {
  const tenantId = await getCurrentTenant();
  if (!tenantId) throw new Error('No tenant found');

  const { knex } = await createTenantKnex();
  
  // Start transaction
  await knex.transaction(async (trx: Knex.Transaction) => {
    // Clear existing default
    await trx('tenant_companies')
      .where('tenant_id', tenantId)
      .where('is_default', true)
      .update({ is_default: false });

    // Set new default
    await trx('tenant_companies')
      .where('tenant_id', tenantId)
      .where('company_id', companyId)
      .update({ is_default: true });
  });
}

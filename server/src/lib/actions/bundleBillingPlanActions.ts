'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';

export interface DetailedBundlePlan {
  bundle_id: string;
  plan_id: string;
  display_order?: number;
  custom_rate?: number | null;
  plan_name: string;
  billing_frequency: string;
  is_custom?: boolean;
  plan_type: string;
  default_rate?: number | undefined; // optional, may be computed elsewhere
}

export async function getDetailedBundlePlans(bundleId: string): Promise<DetailedBundlePlan[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const rows = await trx('bundle_billing_plans as bbp')
      .join('billing_plans as bp', 'bbp.plan_id', 'bp.plan_id')
      .where({ 'bbp.bundle_id': bundleId, 'bbp.tenant': tenant })
      .select<DetailedBundlePlan[]>(
        'bbp.bundle_id',
        'bbp.plan_id',
        'bbp.display_order',
        'bbp.custom_rate',
        'bp.plan_name',
        'bp.billing_frequency',
        'bp.is_custom',
        'bp.plan_type'
      )
      .orderBy('bbp.display_order', 'asc');
    return rows as DetailedBundlePlan[];
  });
}

export async function addPlanToBundle(bundleId: string, planId: string, customRate?: number | undefined): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx('bundle_billing_plans').insert({
      tenant,
      bundle_id: bundleId,
      plan_id: planId,
      display_order: 0,
      custom_rate: customRate ?? null,
      created_at: new Date()
    });
  });
}

export async function removePlanFromBundle(bundleId: string, planId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx('bundle_billing_plans')
      .where({ tenant, bundle_id: bundleId, plan_id: planId })
      .delete();
  });
}

export async function updatePlanInBundle(bundleId: string, planId: string, update: { custom_rate?: number | undefined }): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx('bundle_billing_plans')
      .where({ tenant, bundle_id: bundleId, plan_id: planId })
      .update({ custom_rate: update.custom_rate ?? null, updated_at: new Date() });
  });
}


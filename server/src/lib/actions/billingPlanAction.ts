'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';

// Lightweight interface to satisfy UI needs
export interface IBillingPlan {
  plan_id: string;
  plan_name: string;
  billing_frequency?: string;
  is_custom?: boolean;
  plan_type?: string;
}

export async function getBillingPlans(): Promise<IBillingPlan[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const rows = await trx('billing_plans')
      .where({ tenant })
      .select<IBillingPlan[]>(
        'plan_id',
        'plan_name',
        'billing_frequency',
        'is_custom',
        'plan_type'
      )
      .orderBy('plan_name', 'asc');
    return rows as IBillingPlan[];
  });
}


'use server'

import { getServerSession } from "next-auth/next";
import { options } from '../../app/api/auth/[...nextauth]/options';
import { createTenantKnex } from '@/lib/db';
import { BillingCycleType } from '@/interfaces/billing.interfaces';

export async function getBillingCycle(companyId: string): Promise<BillingCycleType> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn} = await createTenantKnex();

  const result = await conn('companies')
    .where('company_id', companyId)
    .select('billing_cycle')
    .first();

  return result?.billing_cycle || 'monthly';
}

export async function updateBillingCycle(
  companyId: string, 
  billingCycle: BillingCycleType,
): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn} = await createTenantKnex();

  await conn('companies')
    .where('company_id', companyId)
    .update({ 
      billing_cycle: billingCycle,
      updated_at: new Date().toISOString()
    });
}

export async function getAllBillingCycles(): Promise<{ [companyId: string]: BillingCycleType }> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn} = await createTenantKnex();

  const results = await conn('companies')
    .select('company_id', 'billing_cycle');

  return results.reduce((acc: { [companyId: string]: BillingCycleType }, row) => {
    acc[row.company_id] = row.billing_cycle;
    return acc;
  }, {});
}

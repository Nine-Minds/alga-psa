'use server'

import { getServerSession } from "next-auth/next";
import { options } from '../../app/api/auth/[...nextauth]/options';
import { createTenantKnex } from '@/lib/db';
import { BillingCycleType } from '@/interfaces/billing.interfaces';
import { createCompanyBillingCycles } from "../billing/createBillingCycles";

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

export async function canCreateNextBillingCycle(companyId: string): Promise<boolean> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn} = await createTenantKnex();

  // Get the company's current billing cycle type
  const company = await conn('companies')
    .where('company_id', companyId)
    .first();

  if (!company) {
    throw new Error('Company not found');
  }

  // Get the latest billing cycle
  const lastCycle = await conn('company_billing_cycles')
    .where({ company_id: companyId })
    .orderBy('effective_date', 'desc')
    .first();

  const now = new Date().toISOString().split('T')[0] + 'T00:00:00Z';

  console.log('Last cycle:', lastCycle);

  // If no cycles exist, we can create one
  if (!lastCycle) {
    return true;
  }

  // If the last cycle's end date is in the past, we can create the next one
  return new Date(lastCycle.period_end_date) < new Date(now);
}

export async function createNextBillingCycle(companyId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn} = await createTenantKnex();

  const company = await conn('companies')
    .where('company_id', companyId)
    .first();

  if (!company) {
    throw new Error('Company not found');
  }

  const canCreate = await canCreateNextBillingCycle(companyId);
  if (!canCreate) {
    throw new Error('Cannot create next billing cycle at this time');
  }

  await createCompanyBillingCycles(conn, company);
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

'use server'

import { getServerSession } from "next-auth/next";
import { options } from '../../app/api/auth/[...nextauth]/options';
import { createTenantKnex } from '@/lib/db';
import { BillingCycleType, ICompanyBillingCycle } from '@/interfaces/billing.interfaces';
import { createCompanyBillingCycles } from "../billing/createBillingCycles";
import { v4 as uuidv4 } from 'uuid';
import { getNextBillingDate, hardDeleteInvoice } from './invoiceActions';
import { ISO8601String } from '@/types/types.d';

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

export async function canCreateNextBillingCycle(companyId: string): Promise<{
  canCreate: boolean;
  isEarly: boolean;
  periodEndDate?: string;
}> {
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
    .where({ 
      company_id: companyId,
      is_active: true 
    })
    .orderBy('effective_date', 'desc')
    .first();

  const now = new Date().toISOString().split('T')[0] + 'T00:00:00Z';

  console.log('Last cycle:', lastCycle);

  // If no cycles exist, we can create one
  if (!lastCycle) {
    return {
      canCreate: true,
      isEarly: false
    };
  }

  // Allow creation of next cycle but flag if it's early
  const isEarly = new Date(lastCycle.period_end_date) > new Date(now);
  return {
    canCreate: true,
    isEarly,
    periodEndDate: isEarly ? lastCycle.period_end_date : undefined
  };
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

export async function removeBillingCycle(cycleId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Only allow admins to remove billing cycles
  // if (session.user.user_type !== 'admin') {
  //   throw new Error('Only admins can remove billing cycles');
  // }

  const { knex } = await createTenantKnex();

  // Get the billing cycle first to ensure it exists and get company_id
  const billingCycle = await knex('company_billing_cycles')
    .where({ billing_cycle_id: cycleId })
    .first();

  if (!billingCycle) {
    throw new Error('Billing cycle not found');
  }

  // Check for existing invoices
  const invoice = await knex('invoices')
    .where({ billing_cycle_id: cycleId })
    .first();

  if (invoice) {
    // Use the hardDeleteInvoice function to properly clean up the invoice
    await hardDeleteInvoice(invoice.invoice_id);
  }

  // Mark billing cycle as inactive instead of deleting
  await knex('company_billing_cycles')
    .where({ billing_cycle_id: cycleId })
    .update({ 
      is_active: false,
      period_end_date: new Date().toISOString() // Set end date to now
    });

  // Verify future periods won't be affected
  const nextBillingDate = await getNextBillingDate(
    billingCycle.company_id,
    new Date().toISOString()
  );

  if (!nextBillingDate) {
    throw new Error('Failed to verify future billing periods');
  }
}

export async function getInvoicedBillingCycles(): Promise<(ICompanyBillingCycle & {
  company_name: string;
  period_start_date: ISO8601String;
  period_end_date: ISO8601String;
})[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn} = await createTenantKnex();

  // Get all billing cycles that have invoices
  const invoicedCycles = await conn('company_billing_cycles as cbc')
    .join('companies as c', 'c.company_id', 'cbc.company_id')
    .join('invoices as i', 'i.billing_cycle_id', 'cbc.billing_cycle_id')
    .whereNotNull('cbc.period_end_date')
    .select(
      'cbc.billing_cycle_id',
      'cbc.company_id',
      'c.company_name',
      'cbc.billing_cycle',
      'cbc.period_start_date',
      'cbc.period_end_date',
      'cbc.effective_date',
      'cbc.tenant'
    )
    .orderBy('cbc.period_end_date', 'desc');

  return invoicedCycles;
}

export async function getAllBillingCycles(): Promise<{ [companyId: string]: BillingCycleType }> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn} = await createTenantKnex();

  // Get billing cycles from companies table
  const results = await conn('companies')
    .select('company_id', 'billing_cycle');

  return results.reduce((acc: { [companyId: string]: BillingCycleType }, row) => {
    acc[row.company_id] = row.billing_cycle as BillingCycleType;
    return acc;
  }, {});
}

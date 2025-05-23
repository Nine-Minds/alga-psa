'use server'

import { getServerSession } from "next-auth/next";
import { options } from '../../app/api/auth/[...nextauth]/options';
import { createTenantKnex } from 'server/src/lib/db';
import { BillingCycleType, ICompanyBillingCycle } from 'server/src/interfaces/billing.interfaces';
import { createCompanyBillingCycles } from "../billing/createBillingCycles";
import { v4 as uuidv4 } from 'uuid';
import { getNextBillingDate } from './billingAndTax';
import { hardDeleteInvoice } from './invoiceModification';
import { ISO8601String } from 'server/src/types/types.d';
import { BillingCycleCreationResult } from "../billing/createBillingCycles";
import { withTransaction } from '../../../../shared/db';
import { Knex } from 'knex';

export async function getBillingCycle(companyId: string): Promise<BillingCycleType> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn, tenant} = await createTenantKnex();

  const result = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('companies')
      .where({
        company_id: companyId,
        tenant
      })
      .select('billing_cycle')
      .first();
  });

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
  const {knex: conn, tenant} = await createTenantKnex();

  await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('companies')
      .where({
        company_id: companyId,
        tenant
      })
      .update({
        billing_cycle: billingCycle,
        updated_at: new Date().toISOString()
      });
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
  const {knex: conn, tenant} = await createTenantKnex();

  // Get the company's current billing cycle type
  const company = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('companies')
      .where({
        company_id: companyId,
        tenant
      })
      .first();
  });

  if (!company) {
    throw new Error('Company not found');
  }

  // Get the latest billing cycle
  const lastCycle = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('company_billing_cycles')
      .where({
        company_id: companyId,
        is_active: true,
        tenant
      })
      .orderBy('effective_date', 'desc')
      .first();
  });

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

export async function createNextBillingCycle(
  companyId: string,
  effectiveDate?: string
): Promise<BillingCycleCreationResult> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn, tenant} = await createTenantKnex();

  const company = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('companies')
      .where({
        company_id: companyId,
        tenant
      })
      .first();
  });

  if (!company) {
    throw new Error('Company not found');
  }

  const canCreate = await canCreateNextBillingCycle(companyId);
  if (!canCreate) {
    throw new Error('Cannot create next billing cycle at this time');
  }

  return await createCompanyBillingCycles(conn, company, { manual: true });
}

// function for rollback (deactivate cycle, delete invoice)
export async function removeBillingCycle(cycleId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Only allow admins to remove billing cycles
  // if (session.user.user_type !== 'admin') {
  //   throw new Error('Only admins can remove billing cycles');
  // }

  const { knex, tenant } = await createTenantKnex();

  // Get the billing cycle first to ensure it exists and get company_id
  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('company_billing_cycles')
      .where({
        billing_cycle_id: cycleId,
        tenant
      })
      .first();
  });

  if (!billingCycle) {
    throw new Error('Billing cycle not found');
  }

  // Check for existing invoices
  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('invoices')
      .where({
        billing_cycle_id: cycleId,
        tenant
      })
      .first();
  });

  if (invoice) {
    // Use the hardDeleteInvoice function to properly clean up the invoice
    await hardDeleteInvoice(invoice.invoice_id);
  }

  // Mark billing cycle as inactive instead of deleting
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('company_billing_cycles')
      .where({
        billing_cycle_id: cycleId,
        tenant
      })
      .update({
        is_active: false,
        period_end_date: new Date().toISOString() // Set end date to now
      });
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

// function for hard delete (delete cycle and invoice)
export async function hardDeleteBillingCycle(cycleId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Only allow admins to remove billing cycles
  // if (session.user.user_type !== 'admin') {
  //   throw new Error('Only admins can remove billing cycles');
  // }

  const { knex, tenant } = await createTenantKnex();

  // Get the billing cycle first to ensure it exists and get company_id
  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('company_billing_cycles')
      .where({
        billing_cycle_id: cycleId,
        tenant
      })
      .first();
  });

  if (!billingCycle) {
    throw new Error('Billing cycle not found');
  }

  // Check for existing invoices
  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('invoices')
      .where({
        billing_cycle_id: cycleId,
        tenant
      })
      .first();
  });

  if (invoice) {
    // Use the hardDeleteInvoice function to properly clean up the invoice
    await hardDeleteInvoice(invoice.invoice_id);
  }

  // Delete the billing cycle record
  const deletedCount = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('company_billing_cycles')
      .where({
        billing_cycle_id: cycleId,
        tenant
      })
      .del();
  });

  if (deletedCount === 0) {
    // This might happen if the cycle was already deleted in a race condition,
    // but the invoice deletion succeeded. Log a warning.
    console.warn(`Billing cycle ${cycleId} was not found for deletion, but associated invoice might have been deleted.`);
  } else {
    console.log(`Successfully deleted billing cycle ${cycleId}`);
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
  const {knex: conn, tenant} = await createTenantKnex();

  // Get all billing cycles that have invoices
  const invoicedCycles = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('company_billing_cycles as cbc')
      .join('companies as c', function() {
        this.on('c.company_id', '=', 'cbc.company_id')
            .andOn('c.tenant', '=', 'cbc.tenant');
      })
      .join('invoices as i', function() {
        this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id')
            .andOn('i.tenant', '=', 'cbc.tenant');
      })
      .where('cbc.tenant', tenant)
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
  });

  return invoicedCycles;
}

export async function getAllBillingCycles(): Promise<{ [companyId: string]: BillingCycleType }> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn, tenant} = await createTenantKnex();

  // Get billing cycles from companies table
  const results = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('companies')
      .where({ tenant })
      .select('company_id', 'billing_cycle');
  });

  return results.reduce((acc: { [companyId: string]: BillingCycleType }, row) => {
    acc[row.company_id] = row.billing_cycle as BillingCycleType;
    return acc;
  }, {});
}

'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { BillingCycleType, IClientContractLineCycle } from 'server/src/interfaces/billing.interfaces';
import { createClientContractLineCycles } from "../billing/createBillingCycles";
import { v4 as uuidv4 } from 'uuid';
import { getNextBillingDate } from './billingAndTax';
import { hardDeleteInvoice } from './invoiceModification';
import { ISO8601String } from 'server/src/types/types.d';
import { BillingCycleCreationResult } from "../billing/createBillingCycles";
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { getSession } from 'server/src/lib/auth/getSession';

export async function getBillingCycle(clientId: string): Promise<BillingCycleType> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn, tenant} = await createTenantKnex();

  const result = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({
        client_id: clientId,
        tenant
      })
      .select('billing_cycle')
      .first();
  });

  return result?.billing_cycle || 'monthly';
}

export async function updateBillingCycle(
  clientId: string,
  billingCycle: BillingCycleType,
): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn, tenant} = await createTenantKnex();

  await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({
        client_id: clientId,
        tenant
      })
      .update({
        billing_cycle: billingCycle,
        updated_at: new Date().toISOString()
      });
  });
}

export async function canCreateNextBillingCycle(clientId: string): Promise<{
  canCreate: boolean;
  isEarly: boolean;
  periodEndDate?: string;
}> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn, tenant} = await createTenantKnex();

  // Get the client's current billing cycle type
  const client = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({
        client_id: clientId,
        tenant
      })
      .first();
  });

  if (!client) {
    throw new Error('Client not found');
  }

  // Get the latest billing cycle
  const lastCycle = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('client_billing_cycles')
      .where({
        client_id: clientId,
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

export async function getNextBillingCycleStatusForClients(
  clientIds: string[]
): Promise<{
  [clientId: string]: {
    canCreate: boolean;
    isEarly: boolean;
    periodEndDate?: string;
  };
}> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (clientIds.length === 0) {
    return {};
  }

  const { knex: conn, tenant } = await createTenantKnex();
  const now = new Date().toISOString().split('T')[0] + 'T00:00:00Z';

  const lastCycles = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('client_billing_cycles')
      .whereIn('client_id', clientIds)
      .andWhere({
        tenant,
        is_active: true
      })
      .orderBy([
        { column: 'client_id', order: 'asc' },
        { column: 'effective_date', order: 'desc' }
      ])
      .select('client_id', 'period_end_date');
  });

  const statusMap: {
    [clientId: string]: {
      canCreate: boolean;
      isEarly: boolean;
      periodEndDate?: string;
    };
  } = {};

  clientIds.forEach(clientId => {
    statusMap[clientId] = {
      canCreate: true,
      isEarly: false
    };
  });

  for (const cycle of lastCycles) {
    if (!cycle?.client_id || statusMap[cycle.client_id]?.periodEndDate) {
      continue;
    }

    if (!cycle.period_end_date) {
      statusMap[cycle.client_id] = { canCreate: true, isEarly: false };
      continue;
    }

    const isEarly = new Date(cycle.period_end_date) > new Date(now);
    statusMap[cycle.client_id] = {
      canCreate: true,
      isEarly,
      periodEndDate: isEarly ? cycle.period_end_date : undefined
    };
  }

  return statusMap;
}

export async function createNextBillingCycle(
  clientId: string,
  effectiveDate?: string
): Promise<BillingCycleCreationResult> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn, tenant} = await createTenantKnex();

  const client = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({
        client_id: clientId,
        tenant
      })
      .first();
  });

  if (!client) {
    throw new Error('Client not found');
  }

  const canCreate = await canCreateNextBillingCycle(clientId);
  if (!canCreate) {
    throw new Error('Cannot create next billing cycle at this time');
  }

  return await createClientContractLineCycles(conn, client, { manual: true });
}

// function for rollback (deactivate cycle, delete invoice)
export async function removeBillingCycle(cycleId: string): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Only allow admins to remove billing cycles
  // if (session.user.user_type !== 'admin') {
  //   throw new Error('Only admins can remove billing cycles');
  // }

  const { knex, tenant } = await createTenantKnex();

  // Get the billing cycle first to ensure it exists and get client_id
  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_billing_cycles')
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
    return await trx('client_billing_cycles')
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
    billingCycle.client_id,
    new Date().toISOString()
  );

  if (!nextBillingDate) {
    throw new Error('Failed to verify future billing periods');
  }
}

// function for hard delete (delete cycle and invoice)
export async function hardDeleteBillingCycle(cycleId: string): Promise<void> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Only allow admins to remove billing cycles
  // if (session.user.user_type !== 'admin') {
  //   throw new Error('Only admins can remove billing cycles');
  // }

  const { knex, tenant } = await createTenantKnex();

  // Get the billing cycle first to ensure it exists and get client_id
  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_billing_cycles')
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
    return await trx('client_billing_cycles')
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

export async function getInvoicedBillingCycles(): Promise<(IClientContractLineCycle & {
  client_name: string;
  period_start_date: ISO8601String;
  period_end_date: ISO8601String;
})[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn, tenant} = await createTenantKnex();

  // Get all billing cycles that have invoices
  const invoicedCycles = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('client_billing_cycles as cbc')
      .join('clients as c', function() {
        this.on('c.client_id', '=', 'cbc.client_id')
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
        'cbc.client_id',
        'c.client_name',
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

export async function getAllBillingCycles(): Promise<{ [clientId: string]: BillingCycleType }> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const {knex: conn, tenant} = await createTenantKnex();

  // Get billing cycles from clients table
  const results = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({ tenant })
      .select('client_id', 'billing_cycle');
  });

  return results.reduce((acc: { [clientId: string]: BillingCycleType }, row) => {
    acc[row.client_id] = row.billing_cycle as BillingCycleType;
    return acc;
  }, {});
}

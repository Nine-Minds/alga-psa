'use server'

import { createTenantKnex } from '@alga-psa/db';
import { BillingCycleType, IClientContractLineCycle } from '@alga-psa/types';
import { createClientContractLineCycles, type BillingCycleCreationResult } from '../lib/billing/createBillingCycles';
import { v4 as uuidv4 } from 'uuid';
import { getNextBillingDate } from './billingAndTax';
import { hardDeleteInvoice } from './invoiceModification';
import { ISO8601String } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';


export const getBillingCycle = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<BillingCycleType> => {
  const { knex: conn } = await createTenantKnex();

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
});

export const updateBillingCycle = withAuth(async (
  user,
  { tenant },
  clientId: string,
  billingCycle: BillingCycleType
): Promise<void> => {
  const { knex: conn } = await createTenantKnex();

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
});

export const canCreateNextBillingCycle = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<{
  canCreate: boolean;
  isEarly: boolean;
  periodEndDate?: string;
}> => {
  const { knex: conn } = await createTenantKnex();

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
});

export const getNextBillingCycleStatusForClients = withAuth(async (
  user,
  { tenant },
  clientIds: string[]
): Promise<{
  [clientId: string]: {
    canCreate: boolean;
    isEarly: boolean;
    periodEndDate?: string;
  };
}> => {
  if (clientIds.length === 0) {
    return {};
  }

  const { knex: conn } = await createTenantKnex();
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
});

export const createNextBillingCycle = withAuth(async (
  user,
  { tenant },
  clientId: string,
  effectiveDate?: string
): Promise<BillingCycleCreationResult> => {
  const { knex: conn } = await createTenantKnex();

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
  if (!canCreate.canCreate) {
    throw new Error('Cannot create next billing cycle at this time');
  }

  return await createClientContractLineCycles(conn, client, {
    manual: true,
    effectiveDate
  });
});

// function for rollback (deactivate cycle, delete invoice)
export const removeBillingCycle = withAuth(async (
  user,
  { tenant },
  cycleId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();

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
});

// function for hard delete (delete cycle and invoice)
export const hardDeleteBillingCycle = withAuth(async (
  user,
  { tenant },
  cycleId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();

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
});

export interface InvoicedRecurringHistoryRow {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceDate: ISO8601String | null;
  clientId: string;
  clientName: string;
  billingCycleId: string | null;
  hasBillingCycleBridge: boolean;
  cadenceSource: 'client_schedule' | 'contract_anniversary';
  executionWindowKind: 'billing_cycle_window' | 'contract_cadence_window';
  servicePeriodStart: ISO8601String | null;
  servicePeriodEnd: ISO8601String | null;
  servicePeriodLabel: string;
  invoiceWindowStart: ISO8601String | null;
  invoiceWindowEnd: ISO8601String | null;
  invoiceWindowLabel: string;
}

function formatHistoryRangeLabel(start?: string | null, end?: string | null) {
  if (!start && !end) {
    return 'Unavailable';
  }

  if (!start || !end) {
    return start ?? end ?? 'Unavailable';
  }

  return `${start} to ${end}`;
}

function normalizeHistoryDate(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

function mapRecurringHistoryRow(row: any): InvoicedRecurringHistoryRow {
  const servicePeriodStart = normalizeHistoryDate(row.service_period_start);
  const servicePeriodEnd = normalizeHistoryDate(row.service_period_end);
  const invoiceWindowStart = normalizeHistoryDate(row.invoice_window_start);
  const invoiceWindowEnd = normalizeHistoryDate(row.invoice_window_end);
  const invoiceDate = normalizeHistoryDate(row.invoice_date);
  const cadenceSource = row.cadence_owner === 'contract'
    ? 'contract_anniversary'
    : 'client_schedule';
  const executionWindowKind = row.cadence_owner === 'contract'
    ? 'contract_cadence_window'
    : 'billing_cycle_window';

  return {
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number ?? null,
    invoiceStatus: row.status ?? null,
    clientId: row.client_id,
    clientName: row.client_name,
    billingCycleId: row.billing_cycle_id ?? null,
    hasBillingCycleBridge: Boolean(row.billing_cycle_id),
    cadenceSource,
    executionWindowKind,
    servicePeriodStart,
    servicePeriodEnd,
    servicePeriodLabel: formatHistoryRangeLabel(
      servicePeriodStart,
      servicePeriodEnd,
    ),
    invoiceDate,
    invoiceWindowStart,
    invoiceWindowEnd,
    invoiceWindowLabel: formatHistoryRangeLabel(
      invoiceWindowStart,
      invoiceWindowEnd,
    ),
  };
}

export const reverseRecurringInvoice = withAuth(async (
  user,
  { tenant },
  params: { invoiceId: string; billingCycleId?: string | null }
): Promise<void> => {
  if (params.billingCycleId) {
    await removeBillingCycle(params.billingCycleId);
    return;
  }

  await hardDeleteInvoice(params.invoiceId);
});

export const hardDeleteRecurringInvoice = withAuth(async (
  user,
  { tenant },
  params: { invoiceId: string; billingCycleId?: string | null }
): Promise<void> => {
  if (params.billingCycleId) {
    await hardDeleteBillingCycle(params.billingCycleId);
    return;
  }

  await hardDeleteInvoice(params.invoiceId);
});

export const getInvoicedBillingCycles = withAuth(async (
  user,
  { tenant }
): Promise<(IClientContractLineCycle & {
  client_name: string;
  period_start_date: ISO8601String;
  period_end_date: ISO8601String;
})[]> => {
  const { knex: conn } = await createTenantKnex();

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
});

// Types for paginated invoiced billing cycles
export interface FetchInvoicedCyclesOptions {
  page?: number;
  pageSize?: number;
  searchTerm?: string;
}

export interface PaginatedInvoicedCyclesResult {
  cycles: InvoicedRecurringHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Fetch invoiced billing cycles with server-side pagination and search
 */
export const getInvoicedBillingCyclesPaginated = withAuth(async (
  user,
  { tenant },
  options: FetchInvoicedCyclesOptions = {}
): Promise<PaginatedInvoicedCyclesResult> => {
  const {
    page = 1,
    pageSize = 10,
    searchTerm = ''
  } = options;

  const { knex: conn } = await createTenantKnex();

  const result = await withTransaction(conn, async (trx: Knex.Transaction) => {
    const detailServicePeriodStartSql = `
      SELECT MIN(iid.service_period_start)
      FROM invoice_charges ic
      JOIN invoice_charge_details iid
        ON iid.item_id = ic.item_id
       AND iid.tenant = ic.tenant
      WHERE ic.invoice_id = i.invoice_id
        AND ic.tenant = i.tenant
    `;
    const detailServicePeriodEndSql = `
      SELECT MAX(iid.service_period_end)
      FROM invoice_charges ic
      JOIN invoice_charge_details iid
        ON iid.item_id = ic.item_id
       AND iid.tenant = ic.tenant
      WHERE ic.invoice_id = i.invoice_id
        AND ic.tenant = i.tenant
    `;
    const recurringSummaryQuery = trx('recurring_service_periods as rsp')
      .where('rsp.tenant', tenant)
      .whereNotNull('rsp.invoice_id')
      .select('rsp.invoice_id')
      .min('rsp.service_period_start as service_period_start')
      .max('rsp.service_period_end as service_period_end')
      .min('rsp.invoice_window_start as invoice_window_start')
      .max('rsp.invoice_window_end as invoice_window_end')
      .max('rsp.cadence_owner as cadence_owner')
      .groupBy('rsp.invoice_id')
      .as('rsp_summary');

    const buildBaseQuery = () => {
      const query = trx('invoices as i')
        .join('clients as c', function () {
          this.on('c.client_id', '=', 'i.client_id')
            .andOn('c.tenant', '=', 'i.tenant');
        })
        .leftJoin(recurringSummaryQuery, 'rsp_summary.invoice_id', 'i.invoice_id')
        .where('i.tenant', tenant)
        .whereRaw(
          `coalesce(rsp_summary.service_period_start, (${detailServicePeriodStartSql})) is not null`,
        );

      if (searchTerm.trim()) {
        const searchPattern = `%${searchTerm.trim().toLowerCase()}%`;
        query.whereRaw('LOWER(c.client_name) LIKE ?', [searchPattern]);
      }

      return query;
    };

    // Get total count
    const countResult = await buildBaseQuery()
      .countDistinct('i.invoice_id as count')
      .first();
    const total = parseInt(String(countResult?.count || '0'), 10);

    if (total === 0) {
      return {
        cycles: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0
      };
    }

    // Calculate pagination
    const offset = (page - 1) * pageSize;
    const totalPages = Math.ceil(total / pageSize);

    // Fetch paginated data
    const cycles = await buildBaseQuery()
      .select(
        'i.invoice_id',
        'i.invoice_number',
        'i.status',
        'i.invoice_date',
        'i.billing_cycle_id',
        'i.client_id',
        'c.client_name',
        trx.raw(`coalesce(rsp_summary.service_period_start, (${detailServicePeriodStartSql})) as service_period_start`),
        trx.raw(`coalesce(rsp_summary.service_period_end, (${detailServicePeriodEndSql})) as service_period_end`),
        trx.raw(`coalesce(rsp_summary.invoice_window_start, i.billing_period_start) as invoice_window_start`),
        trx.raw(`coalesce(rsp_summary.invoice_window_end, i.billing_period_end) as invoice_window_end`),
        trx.raw(`coalesce(rsp_summary.cadence_owner, case when i.billing_cycle_id is not null then 'client' else null end) as cadence_owner`)
      )
      .orderByRaw(`coalesce(rsp_summary.invoice_window_end, i.billing_period_end, i.invoice_date) desc`)
      .orderBy('i.invoice_id', 'desc')
      .limit(pageSize)
      .offset(offset);

    return {
      cycles: cycles.map(mapRecurringHistoryRow),
      total,
      page,
      pageSize,
      totalPages
    };
  });

  return result;
});

export const getAllBillingCycles = withAuth(async (
  user,
  { tenant }
): Promise<{ [clientId: string]: BillingCycleType }> => {
  const { knex: conn } = await createTenantKnex();

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
});

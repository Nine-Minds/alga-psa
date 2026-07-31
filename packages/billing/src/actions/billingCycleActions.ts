'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { BillingCycleType, IClient, IClientContractLineCycle, ISO8601String } from '@alga-psa/types';
import { createClientContractLineCycles, type BillingCycleCreationResult } from '../lib/billing/createBillingCycles';
import { v4 as uuidv4 } from 'uuid';
import { getNextBillingDate } from './billingAndTax';
import { hardDeleteInvoice } from './invoiceModification';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { toPlainDate } from '@alga-psa/core';
import { applyClientCadenceChange } from '@alga-psa/shared/billingClients';
import { getClientLogoUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import {
  actionError,
  permissionError,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type BillingCycleActionError = ActionMessageError | ActionPermissionError;
type BillingCycleMutationResult = { success: true } | BillingCycleActionError;
type NextBillingCycleStatus = {
  canCreate: boolean;
  isEarly: boolean;
  periodEndDate?: string;
};

class BillingCycleDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingCycleDomainError';
  }
}

function isBillingCycleActionError(result: unknown): result is BillingCycleActionError {
  return isActionMessageError(result) || isActionPermissionError(result);
}

function billingCycleActionErrorFrom(error: unknown): BillingCycleActionError | null {
  if (error instanceof BillingCycleDomainError) {
    if (error.message.startsWith('Permission denied:')) {
      return permissionError(error.message);
    }
    return actionError(error.message);
  }

  if (error instanceof Error && error.message.startsWith('Permission denied:')) {
    return permissionError(error.message);
  }

  return null;
}

async function hardDeleteInvoiceForBillingCycle(invoiceId: string): Promise<BillingCycleActionError | null> {
  const result = await hardDeleteInvoice(invoiceId);
  if (isBillingCycleActionError(result)) {
    return result;
  }
  return null;
}

export const getBillingCycle = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<BillingCycleType | BillingCycleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  const { knex: conn } = await createTenantKnex();

  const result: { billing_cycle?: BillingCycleType | null } | undefined = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('clients')
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
): Promise<void | BillingCycleActionError> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    return permissionError('Permission denied: billing update required');
  }
  const { knex: conn } = await createTenantKnex();

  // Route every cadence change through the shared layer so the scalar, anchor,
  // cycle windows, and recurring_service_periods ledger stay consistent. A bare
  // scalar update here used to leave the ledger stale, stranding the client in a
  // "repair required" state on the invoicing screen.
  await withTransaction(conn, async (trx: Knex.Transaction) => {
    const settings = await tenantDb(trx, tenant).table('client_billing_settings')
      .where({ client_id: clientId })
      .first()
      .select(
        'billing_cycle_anchor_day_of_month',
        'billing_cycle_anchor_month_of_year',
        'billing_cycle_anchor_day_of_week',
        'billing_cycle_anchor_reference_date'
      );

    await applyClientCadenceChange(trx, tenant, {
      clientId,
      billingCycle,
      // Preserve any existing anchor; normalizeAnchorSettingsForCycle adapts it
      // to the new cycle (and fills defaults) inside applyClientCadenceChange.
      anchor: {
        dayOfMonth: settings?.billing_cycle_anchor_day_of_month ?? null,
        monthOfYear: settings?.billing_cycle_anchor_month_of_year ?? null,
        dayOfWeek: settings?.billing_cycle_anchor_day_of_week ?? null,
        referenceDate: settings?.billing_cycle_anchor_reference_date
          ? new Date(settings.billing_cycle_anchor_reference_date).toISOString()
          : null,
      },
    });
  });
});

export const canCreateNextBillingCycle = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<NextBillingCycleStatus | BillingCycleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  const { knex: conn } = await createTenantKnex();

  // Get the client's current billing cycle type
  const client = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('clients')
      .where({
        client_id: clientId,
        tenant
      })
      .first();
  });

  if (!client) {
    return actionError('Client not found');
  }

  // Get the latest billing cycle
  const lastCycle = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('client_billing_cycles')
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
  [clientId: string]: NextBillingCycleStatus;
} | BillingCycleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  if (clientIds.length === 0) {
    return {};
  }

  const { knex: conn } = await createTenantKnex();
  const now = new Date().toISOString().split('T')[0] + 'T00:00:00Z';

  const lastCycles = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('client_billing_cycles')
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
): Promise<BillingCycleCreationResult | BillingCycleActionError> => {
  if (!await hasPermission(user, 'billing', 'create')) {
    return permissionError('Permission denied: billing create required');
  }
  const { knex: conn } = await createTenantKnex();

  const client = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table<IClient>('clients')
      .where({
        client_id: clientId,
        tenant
      })
      .first();
  });

  if (!client) {
    return actionError('Client not found');
  }

  const canCreate = await canCreateNextBillingCycle(clientId);
  if (isBillingCycleActionError(canCreate)) {
    return canCreate;
  }
  if (!canCreate.canCreate) {
    return actionError('Cannot create next billing cycle at this time');
  }

  return await createClientContractLineCycles(conn, client, {
    manual: true,
    effectiveDate
  });
});

async function getBillingCycleRecord(
  knex: Knex,
  tenant: string,
  cycleId: string
) {
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantDb(trx, tenant).table('client_billing_cycles')
      .where({
        billing_cycle_id: cycleId,
        tenant,
      })
      .first();
  });
}

async function deactivateBillingCycleRecord(
  knex: Knex,
  tenant: string,
  cycleId: string
): Promise<void> {
  const billingCycle = await getBillingCycleRecord(knex, tenant, cycleId);

  if (!billingCycle) {
    throw new BillingCycleDomainError('Billing cycle not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantDb(trx, tenant).table('client_billing_cycles')
      .where({
        billing_cycle_id: cycleId,
        tenant
      })
      .update({
        is_active: false,
        period_end_date: new Date().toISOString()
      });
  });

  const nextBillingDate = await getNextBillingDate(
    billingCycle.client_id,
    new Date().toISOString()
  );
  if (isActionMessageError(nextBillingDate) || isActionPermissionError(nextBillingDate)) {
    throw new BillingCycleDomainError(
      'permissionError' in nextBillingDate ? nextBillingDate.permissionError : nextBillingDate.actionError,
    );
  }

  if (!nextBillingDate) {
    throw new BillingCycleDomainError('Future billing periods could not be verified after removing the billing cycle');
  }
}

async function permanentlyDeleteBillingCycleRecord(
  knex: Knex,
  tenant: string,
  cycleId: string
): Promise<void> {
  const billingCycle = await getBillingCycleRecord(knex, tenant, cycleId);

  if (!billingCycle) {
    throw new BillingCycleDomainError('Billing cycle not found');
  }

  const deletedCount = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantDb(trx, tenant).table('client_billing_cycles')
      .where({
        billing_cycle_id: cycleId,
        tenant
      })
      .del();
  });

  if (deletedCount === 0) {
    console.warn(`Billing cycle ${cycleId} was not found for deletion, but associated invoice might have been deleted.`);
  } else {
    console.log(`Successfully deleted billing cycle ${cycleId}`);
  }
}

// function for rollback (deactivate cycle, delete invoice)
export const removeBillingCycle = withAuth(async (
  user,
  { tenant },
  cycleId: string
): Promise<BillingCycleMutationResult> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required');
  }
  const { knex } = await createTenantKnex();

  try {
    // Check for existing invoices
    const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('invoices')
        .where({
          billing_cycle_id: cycleId,
          tenant
        })
        .first();
    });

    if (invoice) {
      const invoiceDeleteError = await hardDeleteInvoiceForBillingCycle(invoice.invoice_id);
      if (invoiceDeleteError) {
        return invoiceDeleteError;
      }
    }

    await deactivateBillingCycleRecord(knex, tenant, cycleId);
    return { success: true };
  } catch (error) {
    const expected = billingCycleActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

// function for hard delete (delete cycle and invoice)
export const hardDeleteBillingCycle = withAuth(async (
  user,
  { tenant },
  cycleId: string
): Promise<BillingCycleMutationResult> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required');
  }
  const { knex } = await createTenantKnex();

  try {
    // Check for existing invoices
    const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('invoices')
        .where({
          billing_cycle_id: cycleId,
          tenant
        })
        .first();
    });

    if (invoice) {
      const invoiceDeleteError = await hardDeleteInvoiceForBillingCycle(invoice.invoice_id);
      if (invoiceDeleteError) {
        return invoiceDeleteError;
      }
    }

    await permanentlyDeleteBillingCycleRecord(knex, tenant, cycleId);
    return { success: true };
  } catch (error) {
    const expected = billingCycleActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export interface RecurringInvoiceHistoryRow {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceDate: ISO8601String | null;
  clientId: string;
  clientName: string;
  logoUrl?: string | null;
  billingCycleId: string | null;
  hasBillingCycleBridge: boolean;
  cadenceSource: 'client_schedule' | 'contract_anniversary';
  executionWindowKind: 'client_cadence_window' | 'contract_cadence_window';
  servicePeriodStart: ISO8601String | null;
  servicePeriodEnd: ISO8601String | null;
  servicePeriodLabel: string;
  invoiceWindowStart: ISO8601String | null;
  invoiceWindowEnd: ISO8601String | null;
  invoiceWindowLabel: string;
  assignmentContractIds: string[];
  assignmentDefaultContractIds: string[];
  assignmentExplicitContractIds: string[];
  assignmentSourceSummary: 'system_managed_default_contract' | 'explicit_contract' | 'mixed' | 'unassigned';
  isMultiAssignment: boolean;
  assignmentSummary: string;
}

export type InvoicedRecurringHistoryRow = RecurringInvoiceHistoryRow;

function formatHistoryDisplayDate(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return toPlainDate(value).toString();
  } catch {
    return value;
  }
}

function formatHistoryRangeLabel(start?: string | null, end?: string | null) {
  const formattedStart = formatHistoryDisplayDate(start);
  const formattedEnd = formatHistoryDisplayDate(end);

  if (!formattedStart && !formattedEnd) {
    return 'Unavailable';
  }

  if (!formattedStart || !formattedEnd) {
    return formattedStart ?? formattedEnd ?? 'Unavailable';
  }

  return `${formattedStart} to ${formattedEnd}`;
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

function normalizeHistoryAssignmentContractIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
  }
  return [];
}

function buildHistoryAssignmentSummary(input: {
  assignmentContractIds: string[];
  assignmentDefaultContractIds: string[];
  assignmentExplicitContractIds: string[];
}): {
  assignmentSummary: string;
  assignmentSourceSummary: RecurringInvoiceHistoryRow['assignmentSourceSummary'];
} {
  const totalAssignments = input.assignmentContractIds.length;
  const defaultCount = input.assignmentDefaultContractIds.length;
  const explicitCount =
    input.assignmentExplicitContractIds.length > 0
      ? input.assignmentExplicitContractIds.length
      : Math.max(totalAssignments - defaultCount, 0);

  if (totalAssignments === 0) {
    return {
      assignmentSummary: 'No assignment header',
      assignmentSourceSummary: 'unassigned',
    };
  }

  if (defaultCount > 0 && explicitCount === 0) {
    return {
      assignmentSummary:
        totalAssignments > 1
          ? `System-managed default contract (${totalAssignments} assignments)`
          : 'System-managed default contract',
      assignmentSourceSummary: 'system_managed_default_contract',
    };
  }

  if (defaultCount > 0 && explicitCount > 0) {
    return {
      assignmentSummary:
        `Mixed assignment (${explicitCount} explicit, ${defaultCount} system-managed default)`,
      assignmentSourceSummary: 'mixed',
    };
  }

  return {
    assignmentSummary:
      totalAssignments > 1
        ? `Explicit contract assignments (${totalAssignments})`
        : 'Explicit contract assignment',
    assignmentSourceSummary: 'explicit_contract',
  };
}

function mapRecurringHistoryRow(row: any): RecurringInvoiceHistoryRow {
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
    : 'client_cadence_window';
  const assignmentContractIds = normalizeHistoryAssignmentContractIds(
    row.assignment_contract_ids,
  );
  const assignmentDefaultContractIds = normalizeHistoryAssignmentContractIds(
    row.assignment_default_contract_ids,
  );
  const assignmentExplicitContractIds = normalizeHistoryAssignmentContractIds(
    row.assignment_explicit_contract_ids,
  );
  const assignmentSummary = buildHistoryAssignmentSummary({
    assignmentContractIds,
    assignmentDefaultContractIds,
    assignmentExplicitContractIds,
  });

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
    assignmentContractIds,
    assignmentDefaultContractIds,
    assignmentExplicitContractIds,
    assignmentSourceSummary: assignmentSummary.assignmentSourceSummary,
    isMultiAssignment: assignmentContractIds.length > 1,
    assignmentSummary: assignmentSummary.assignmentSummary,
  };
}

function buildInvoiceDetailServicePeriodSubquery(
  db: ReturnType<typeof tenantDb>,
  aggregate: 'min' | 'max',
  outerInvoiceAlias: string,
): Knex.QueryBuilder {
  const servicePeriodColumn = aggregate === 'min'
    ? 'iid.service_period_start'
    : 'iid.service_period_end';
  const subquery = db.subquery('invoice_charges as ic')
    .whereRaw('?? = ??', ['ic.invoice_id', `${outerInvoiceAlias}.invoice_id`]);

  if (aggregate === 'min') {
    subquery.min(servicePeriodColumn);
  } else {
    subquery.max(servicePeriodColumn);
  }

  db.tenantJoin(subquery, 'invoice_charge_details as iid', 'ic.item_id', 'iid.item_id');

  return db.tenantWhereColumn(subquery, 'ic.tenant', `${outerInvoiceAlias}.tenant`);
}

function buildAssignmentContractIdsSubquery(
  db: ReturnType<typeof tenantDb>,
  trx: Knex.Transaction,
  outerInvoiceAlias: string,
  assignmentType?: 'default' | 'explicit',
): Knex.QueryBuilder {
  const subquery = db.subquery('invoice_charges as ic')
    .select(trx.raw('array_agg(distinct ic.client_contract_id)'))
    .whereRaw('?? = ??', ['ic.invoice_id', `${outerInvoiceAlias}.invoice_id`])
    .whereNotNull('ic.client_contract_id');

  db.tenantWhereColumn(subquery, 'ic.tenant', `${outerInvoiceAlias}.tenant`);

  if (!assignmentType) {
    return subquery;
  }

  db.tenantJoin(subquery, 'client_contracts as cc', 'cc.client_contract_id', 'ic.client_contract_id');
  db.tenantJoin(subquery, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');

  if (assignmentType === 'default') {
    subquery.where('ct.is_system_managed_default', true);
  } else {
    subquery.where((builder) => {
      builder
        .whereNull('ct.is_system_managed_default')
        .orWhere('ct.is_system_managed_default', false);
    });
  }

  return subquery;
}

export const reverseRecurringInvoice = withAuth(async (
  user,
  { tenant },
  params: { invoiceId: string; billingCycleId?: string | null }
): Promise<BillingCycleMutationResult> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required');
  }
  const invoiceDeleteError = await hardDeleteInvoiceForBillingCycle(params.invoiceId);
  if (invoiceDeleteError) {
    return invoiceDeleteError;
  }
  return { success: true };
});

export const hardDeleteRecurringInvoice = withAuth(async (
  user,
  { tenant },
  params: { invoiceId: string; billingCycleId?: string | null }
): Promise<BillingCycleMutationResult> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required');
  }
  const invoiceDeleteError = await hardDeleteInvoiceForBillingCycle(params.invoiceId);
  if (invoiceDeleteError) {
    return invoiceDeleteError;
  }
  return { success: true };
});

type InvoicedBillingCycleRow = IClientContractLineCycle & {
  client_name: string;
  period_start_date: ISO8601String;
  period_end_date: ISO8601String;
};

export const getInvoicedBillingCycles = withAuth(async (
  user,
  { tenant }
): Promise<InvoicedBillingCycleRow[] | BillingCycleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  const { knex: conn } = await createTenantKnex();

  // Get all billing cycles that have invoices
  const invoicedCycles = await withTransaction(conn, async (trx: Knex.Transaction): Promise<InvoicedBillingCycleRow[]> => {
    const db = tenantDb(trx, tenant);
    const query = db.table('client_billing_cycles as cbc');
    db.tenantJoin(query, 'clients as c', 'c.client_id', 'cbc.client_id');
    db.tenantJoin(query, 'invoices as i', 'i.billing_cycle_id', 'cbc.billing_cycle_id');

    const rows = await query
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

    return rows as unknown as InvoicedBillingCycleRow[];
  });

  return invoicedCycles;
});

// Types for paginated invoiced billing cycles
export interface FetchRecurringInvoiceHistoryOptions {
  page?: number;
  pageSize?: number;
  searchTerm?: string;
}

export interface PaginatedRecurringInvoiceHistoryResult {
  rows: RecurringInvoiceHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FetchInvoicedCyclesOptions extends FetchRecurringInvoiceHistoryOptions {}

export interface PaginatedInvoicedCyclesResult {
  cycles: InvoicedRecurringHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

async function fetchRecurringInvoiceHistoryPage(
  tenant: string,
  options: FetchRecurringInvoiceHistoryOptions = {}
): Promise<PaginatedRecurringInvoiceHistoryResult> {
  const { knex: conn } = await createTenantKnex();
  const {
    page = 1,
    pageSize = 10,
    searchTerm = ''
  } = options;

  const result = await withTransaction(conn, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    const detailServicePeriodStartSubquery = () =>
      buildInvoiceDetailServicePeriodSubquery(db, 'min', 'i');
    const detailServicePeriodEndSubquery = () =>
      buildInvoiceDetailServicePeriodSubquery(db, 'max', 'i');
    const recurringSummaryQuery = db.table('recurring_service_periods as rsp')
      .whereNotNull('rsp.invoice_id')
      .select('rsp.tenant')
      .select('rsp.invoice_id')
      .min('rsp.service_period_start as service_period_start')
      .max('rsp.service_period_end as service_period_end')
      .min('rsp.invoice_window_start as invoice_window_start')
      .max('rsp.invoice_window_end as invoice_window_end')
      .max('rsp.cadence_owner as cadence_owner')
      .groupBy('rsp.tenant', 'rsp.invoice_id')
      .as('rsp_summary');

    const buildBaseQuery = () => {
      const query = db.table('invoices as i');
      db.tenantJoin(query, 'clients as c', 'c.client_id', 'i.client_id');
      db.tenantJoinSubquery(query, recurringSummaryQuery, 'rsp_summary.invoice_id', 'i.invoice_id', {
        type: 'left',
        rootTenantColumn: 'i.tenant',
        joinedTenantColumn: 'rsp_summary.tenant',
      });
      query
        .whereRaw(
          'coalesce(rsp_summary.service_period_start, ?) is not null',
          [detailServicePeriodStartSubquery()],
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
        rows: [],
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
        'i.client_contract_id',
        'c.client_name',
        trx.raw('coalesce(rsp_summary.service_period_start, ?) as service_period_start', [detailServicePeriodStartSubquery()]),
        trx.raw('coalesce(rsp_summary.service_period_end, ?) as service_period_end', [detailServicePeriodEndSubquery()]),
        // `i.billing_period_start/end` is the legacy misnamed invoice window; newer rows have the
        // canonical window in `recurring_service_periods`. Coalesce both into `invoice_window_*`.
        // Column rename on `invoices` to `invoice_window_*` is pending.
        trx.raw(`coalesce(rsp_summary.invoice_window_start, i.billing_period_start) as invoice_window_start`),
        trx.raw(`coalesce(rsp_summary.invoice_window_end, i.billing_period_end) as invoice_window_end`),
        trx.raw(`coalesce(rsp_summary.cadence_owner, 'client') as cadence_owner`),
        trx.raw('coalesce(?, ARRAY[]::uuid[]) as assignment_contract_ids', [
          buildAssignmentContractIdsSubquery(db, trx, 'i'),
        ]),
        trx.raw('coalesce(?, ARRAY[]::uuid[]) as assignment_default_contract_ids', [
          buildAssignmentContractIdsSubquery(db, trx, 'i', 'default'),
        ]),
        trx.raw('coalesce(?, ARRAY[]::uuid[]) as assignment_explicit_contract_ids', [
          buildAssignmentContractIdsSubquery(db, trx, 'i', 'explicit'),
        ])
      )
      .orderByRaw(`coalesce(rsp_summary.invoice_window_end, i.billing_period_end, i.invoice_date) desc`)
      .orderBy('i.invoice_id', 'desc')
      .limit(pageSize)
      .offset(offset);

    const rows = cycles.map(mapRecurringHistoryRow);
    const clientIds = Array.from(
      new Set(
        rows
          .map((row) => row.clientId)
          .filter((clientId): clientId is string => Boolean(clientId)),
      ),
    );
    if (clientIds.length > 0) {
      const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
      for (const row of rows) {
        row.logoUrl = row.clientId ? logoUrlsMap.get(row.clientId) ?? null : null;
      }
    }

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages
    };
  });

  return result;
}

/**
 * Fetch recurring invoice history with server-side pagination and search.
 */
export const getRecurringInvoiceHistoryPaginated = withAuth(async (
  user,
  { tenant },
  options: FetchRecurringInvoiceHistoryOptions = {}
): Promise<PaginatedRecurringInvoiceHistoryResult | BillingCycleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  return fetchRecurringInvoiceHistoryPage(tenant, options);
});

/**
 * @deprecated Use getRecurringInvoiceHistoryPaginated.
 */
export const getInvoicedBillingCyclesPaginated = withAuth(async (
  user,
  { tenant },
  options: FetchInvoicedCyclesOptions = {}
): Promise<PaginatedInvoicedCyclesResult | BillingCycleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  const result = await fetchRecurringInvoiceHistoryPage(tenant, options);
  return {
    cycles: result.rows,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  };
});

export const getAllBillingCycles = withAuth(async (
  user,
  { tenant }
): Promise<{ [clientId: string]: BillingCycleType } | BillingCycleActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  const { knex: conn } = await createTenantKnex();

  // Get billing cycles from clients table
  const results = await withTransaction(conn, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('clients')
      .select('client_id', 'billing_cycle');
  });

  return results.reduce((acc: { [clientId: string]: BillingCycleType }, row) => {
    acc[row.client_id] = row.billing_cycle as BillingCycleType;
    return acc;
  }, {});
});

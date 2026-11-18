'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { RenewalWorkItemStatus } from '@alga-psa/types';
import { deriveClientContractStatus, getTenantLocalToday } from '@alga-psa/shared/billingClients';
import {
  aggregateCentsByCurrency,
  getContractMonthlyValuesByAssignment,
  type CurrencyAmount,
} from '@alga-psa/shared/billingClients/contractMonthlyValue';
import { getClientLogoUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import { mapHourBlockUsageRow, type HourBlockUsageQueryRow } from '../lib/hourBlockUsageRows';
import type { Knex } from 'knex';
import { isActionPermissionError, permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';


// Type definitions for reports
export interface ContractRevenue {
  contract_name: string;
  client_id: string;
  client_name: string;
  logoUrl?: string | null;
  /**
   * Fixed recurring value in minor units, cadence-normalized to monthly by the
   * canonical shared valuation ({@link getContractMonthlyValuesByAssignment}).
   * Usage lines bill recorded usage — variable revenue that is excluded here
   * and flagged via {@link ContractRevenue.has_variable_usage} so an active
   * usage contract is never silently presented as zero recurring revenue.
   */
  monthly_recurring: number;
  total_billed_ytd: number;
  /** True when the contract has usage-billed lines with variable, record-driven revenue. */
  has_variable_usage: boolean;
  /** Contract currency for this row's minor-unit amounts; rows are never re-labeled in tenant currency. */
  currency_code: string;
  status: 'active' | 'upcoming' | 'expired';
}

export interface ContractExpiration {
  client_contract_id?: string;
  contract_name: string;
  client_id: string;
  client_name: string;
  logoUrl?: string | null;
  end_date: string;
  decision_due_date?: string | null;
  renewal_mode?: 'none' | 'manual' | 'auto' | null;
  queue_status?: RenewalWorkItemStatus | null;
  days_until_expiration: number;
  /** Fixed recurring value in minor units; variable usage revenue is excluded. */
  monthly_value: number;
  /** True when the contract has usage-billed lines with variable, record-driven revenue. */
  has_variable_usage: boolean;
  /** Contract currency for this row's minor-unit amounts. */
  currency_code: string;
  auto_renew: boolean;
}

export interface BucketUsage {
  contract_name: string;
  client_id: string;
  client_name: string;
  logoUrl?: string | null;
  total_hours: number;
  used_hours: number;
  remaining_hours: number;
  utilization_percentage: number;
  overage_hours: number;
}

export interface ContractReportSummary {
  /**
   * Fixed monthly recurring revenue of active assignments, aggregated
   * separately per contract currency. Variable usage revenue is excluded,
   * never counted as zero; expired/upcoming assignments are excluded from the
   * committed total. No cross-currency grand total exists by design.
   */
  fixedMrrByCurrency: CurrencyAmount[];
  /** Actual billed revenue year-to-date, aggregated separately per contract currency. */
  ytdRevenueByCurrency: CurrencyAmount[];
  activeContractCount: number;
  atRiskDecisionCount: number;
  /** Active contracts whose revenue includes variable, record-driven usage billing. */
  variableUsageContractCount: number;
}

type ContractRevenueFactRow = {
  item_id: string;
  client_contract_id: string | null;
  invoice_date: string | Date | null;
  net_amount: string | number | null;
  item_detail_id?: string | null;
  service_period_end?: string | Date | null;
  allocated_amount?: string | number | null;
};

type ContractRevenueAssignmentRow = {
  client_contract_id: string;
  client_id: string;
  is_active: boolean | null;
  start_date: string | Date | null;
  end_date: string | Date | null;
  contract_id: string;
  contract_name: string;
  contract_status: string | null;
  client_name: string | null;
};

type ContractExpirationRow = {
  client_contract_id: string;
  contract_id: string;
  contract_name: string;
  contract_status: string | null;
  client_id: string;
  client_name: string | null;
  is_active: boolean | null;
  start_date: string | Date | null;
  end_date: string | Date | null;
  decision_due_date: string | Date | null;
  renewal_mode: string | null;
  use_tenant_renewal_defaults: boolean | null;
  tenant_default_renewal_mode: string | null;
  queue_status: RenewalWorkItemStatus | null;
};

const EXCLUDED_INVOICE_STATUSES = ['draft', 'Draft', 'cancelled', 'Cancelled', 'canceled', 'Canceled'] as const;

function normalizeDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

function isDateWithinRange(
  value: string | Date | null | undefined,
  startInclusive: string,
  endExclusive: string
): boolean {
  const normalized = normalizeDateOnly(value);
  if (!normalized) {
    return false;
  }

  return normalized >= startInclusive && normalized < endExclusive;
}

async function getContractRevenueYtdByAssignment(
  knex: Knex,
  tenant: string,
  yearStartDateOnly: string,
  nextYearStartDateOnly: string
): Promise<Map<string, number>> {
  const db = tenantDb(knex, tenant);
  // Contract revenue is the report family that intentionally pivots to
  // canonical recurring service periods when detail rows exist. Expiration and
  // renewal reporting below stay assignment-date based instead.
  const revenueFactQuery = db.table('invoice_charges as ic')
    .whereNotIn('inv.status', EXCLUDED_INVOICE_STATUSES)
    .whereNotNull('ic.client_contract_id')
    .select(
      'ic.item_id',
      'ic.client_contract_id',
      'inv.invoice_date',
      'ic.net_amount',
      'iid.item_detail_id',
      'iid.service_period_end',
      'iifd.allocated_amount'
    );
  db.tenantJoin(revenueFactQuery, 'invoices as inv', 'ic.invoice_id', 'inv.invoice_id');
  db.tenantJoin(revenueFactQuery, 'invoice_charge_details as iid', 'ic.item_id', 'iid.item_id', { type: 'left' });
  db.tenantJoin(revenueFactQuery, 'invoice_charge_fixed_details as iifd', 'iid.item_detail_id', 'iifd.item_detail_id', { type: 'left' });
  const revenueFactRows = (await revenueFactQuery) as unknown as ContractRevenueFactRow[];

  const rowsByItemId = new Map<string, ContractRevenueFactRow[]>();
  for (const row of revenueFactRows) {
    const existing = rowsByItemId.get(row.item_id) ?? [];
    existing.push(row);
    rowsByItemId.set(row.item_id, existing);
  }

  const totalsByAssignment = new Map<string, number>();

  for (const itemRows of rowsByItemId.values()) {
    const firstRow = itemRows[0];
    const clientContractId = firstRow?.client_contract_id;
    if (!clientContractId) {
      continue;
    }

    const detailRows = itemRows.filter(
      (row) => typeof row.item_detail_id === 'string' && row.item_detail_id.length > 0
    );
    const hasCanonicalServicePeriods = detailRows.some(
      (row) => typeof normalizeDateOnly(row.service_period_end) === 'string'
    );

    let chargeAmount = 0;

    if (hasCanonicalServicePeriods) {
      const fixedDetailRows = detailRows.filter((row) => row.allocated_amount !== null && row.allocated_amount !== undefined);
      if (fixedDetailRows.length > 0) {
        chargeAmount = fixedDetailRows
          .filter((row) => isDateWithinRange(row.service_period_end, yearStartDateOnly, nextYearStartDateOnly))
          .reduce((sum, row) => sum + (Number(row.allocated_amount ?? 0) || 0), 0);
      } else if (
        detailRows.some((row) => isDateWithinRange(row.service_period_end, yearStartDateOnly, nextYearStartDateOnly))
      ) {
        chargeAmount = Number(firstRow.net_amount ?? 0) || 0;
      }
    } else if (isDateWithinRange(firstRow.invoice_date, yearStartDateOnly, nextYearStartDateOnly)) {
      chargeAmount = Number(firstRow.net_amount ?? 0) || 0;
    }

    if (chargeAmount === 0) {
      continue;
    }

    totalsByAssignment.set(clientContractId, (totalsByAssignment.get(clientContractId) ?? 0) + chargeAmount);
  }

  return totalsByAssignment;
}

const mapAssignmentStatusToRevenueStatus = (
  status: ReturnType<typeof deriveClientContractStatus>
): ContractRevenue['status'] | null => {
  // Not billing yet: both real drafts and confirmed future-start ('scheduled') contracts keep the
  // report's existing 'upcoming' bucket (future-start rows were 'draft' -> 'upcoming' before).
  if (status === 'draft' || status === 'scheduled') {
    return 'upcoming';
  }
  if (status === 'terminated') {
    return null;
  }
  return status;
};

/**
 * Get contract revenue report data
 * Shows monthly recurring revenue and year-to-date billing by contract
 */
export const getContractRevenueReport = withAuth(async (user, { tenant }): Promise<ContractRevenue[] | ActionPermissionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    const today = new Date();
    const yearStartDateOnly = new Date(Date.UTC(today.getUTCFullYear(), 0, 1, 0, 0, 0, 0)).toISOString().slice(0, 10);
    const nextYearStartDateOnly = new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0)).toISOString().slice(0, 10);
    const invoiceMap = await getContractRevenueYtdByAssignment(
      knex,
      tenant,
      yearStartDateOnly,
      nextYearStartDateOnly
    );

    const dataQuery = db.table('client_contracts as cc')
      .andWhere((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false))
      .whereNotNull('c.owner_client_id')
      .select(
        'cc.client_contract_id',
        'cc.client_id',
        'cc.is_active',
        'cc.start_date',
        'cc.end_date',
        'c.contract_id',
        'c.contract_name',
        'c.status as contract_status',
        'cl.client_name'
      );
    db.tenantJoin(dataQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');
    db.tenantJoin(dataQuery, 'clients as cl', 'cc.client_id', 'cl.client_id', { type: 'left' });
    const data = (await dataQuery) as unknown as ContractRevenueAssignmentRow[];
    const tenantToday = await getTenantLocalToday(knex, tenant);

    const aggregatedMap = new Map<string, any>();

    for (const row of data) {
      const assignmentStatus = deriveClientContractStatus({
        isActive: Boolean(row.is_active),
        startDate: normalizeDateOnly(row.start_date),
        endDate: normalizeDateOnly(row.end_date),
        contractStatus: row.contract_status ?? undefined,
        now: tenantToday,
      });
      const status = mapAssignmentStatusToRevenueStatus(assignmentStatus);
      if (!status) {
        continue;
      }

      aggregatedMap.set(row.client_contract_id, {
        client_contract_id: row.client_contract_id,
        contract_id: row.contract_id,
        contract_name: row.contract_name,
        client_id: row.client_id,
        client_name: row.client_name || 'Unknown Client',
        monthly_recurring: 0,
        total_billed_ytd: invoiceMap.get(row.client_contract_id) || 0,
        has_variable_usage: false,
        currency_code: 'USD',
        status,
      });
    }

    // Canonical shared valuation: unit-priced Fixed lines are quantity × unit
    // rate (revision-aware), bundle lines keep their line rate, every line is
    // cadence-normalized, and Usage lines are flagged as variable revenue —
    // the same numbers the contract overview and summary report use.
    const monthlyValues = await getContractMonthlyValuesByAssignment(
      knex,
      tenant,
      Array.from(aggregatedMap.keys()),
    );
    for (const item of aggregatedMap.values()) {
      const valuation = monthlyValues.get(item.client_contract_id);
      if (!valuation) {
        continue;
      }
      item.monthly_recurring = valuation.monthlyValueCents;
      item.has_variable_usage = valuation.hasVariableUsage;
      item.currency_code = valuation.currencyCode;
    }

    const rows: ContractRevenue[] = Array.from(aggregatedMap.values()).map(
      ({ client_contract_id, contract_id, ...rest }) => rest
    );

    const clientIds = Array.from(
      new Set(rows.map((row) => row.client_id).filter((id): id is string => Boolean(id)))
    );
    if (clientIds.length > 0) {
      const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
      for (const row of rows) {
        row.logoUrl = row.client_id ? logoUrlsMap.get(row.client_id) ?? null : null;
      }
    }

    return rows;
  } catch (error) {
    console.error('Error fetching contract revenue report:', error);
    throw error;
  }
});

/**
 * Get contract expiration report data
 * Track upcoming contract expirations and renewal opportunities
 */
export const getContractExpirationReport = withAuth(async (user, { tenant }): Promise<ContractExpiration[] | ActionPermissionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    const today = new Date();

    const dataQuery = db.table('contracts as c')
      .where({ 'cc.is_active': true })
      .andWhere((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false))
      .whereNotNull('c.owner_client_id')
      .whereNotNull('cc.end_date')
      .select(
        'cc.client_contract_id',
        'c.contract_id',
        'c.contract_name',
        'c.status as contract_status',
        'cc.client_id',
        'cl.client_name',
        'cc.is_active',
        'cc.start_date',
        'cc.end_date',
        'cc.decision_due_date',
        'cc.renewal_mode',
        'cc.use_tenant_renewal_defaults',
        'dbs.default_renewal_mode as tenant_default_renewal_mode',
        'cc.status as queue_status'
      )
      .orderBy('cc.end_date', 'asc');
    db.tenantJoin(dataQuery, 'client_contracts as cc', 'c.contract_id', 'cc.contract_id');
    db.tenantJoin(dataQuery, 'clients as cl', 'cc.client_id', 'cl.client_id', { type: 'left' });
    db.tenantJoin(dataQuery, 'default_billing_settings as dbs', 'cc.tenant', 'dbs.tenant', {
      type: 'left',
      rootTenantColumn: 'cc.tenant',
    });
    const data = (await dataQuery) as unknown as ContractExpirationRow[];
    const monthlyValues = await getContractMonthlyValuesByAssignment(
      knex,
      tenant,
      data.map((row) => row.client_contract_id),
    );

    const expirationMap = new Map<string, ContractExpiration>();
    const tenantToday = await getTenantLocalToday(knex, tenant);

    for (const row of data) {
      const assignmentStatus = deriveClientContractStatus({
        isActive: Boolean(row.is_active),
        startDate: normalizeDateOnly(row.start_date),
        endDate: normalizeDateOnly(row.end_date),
        contractStatus: row.contract_status ?? undefined,
        now: tenantToday,
      });
      // Only contracts billing now can expire; 'scheduled' has not started so it is excluded.
      if (assignmentStatus !== 'active') {
        continue;
      }

      if (!row.end_date) {
        continue;
      }
      const endDate = new Date(row.end_date);
      const daysUntilExpiration = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const contractRenewalMode = row.renewal_mode === 'none' || row.renewal_mode === 'manual' || row.renewal_mode === 'auto'
        ? row.renewal_mode
        : null;
      const tenantDefaultRenewalMode =
        row.tenant_default_renewal_mode === 'none'
        || row.tenant_default_renewal_mode === 'manual'
        || row.tenant_default_renewal_mode === 'auto'
          ? row.tenant_default_renewal_mode
          : null;
      const useTenantRenewalDefaults = row.use_tenant_renewal_defaults !== false;
      const effectiveRenewalMode =
        (useTenantRenewalDefaults
          ? (tenantDefaultRenewalMode ?? contractRenewalMode)
          : (contractRenewalMode ?? tenantDefaultRenewalMode))
        ?? 'manual';

      const key = row.client_contract_id;
      const monthlyValue = monthlyValues.get(key)?.monthlyValueCents ?? 0;
      const hasVariableUsage = monthlyValues.get(key)?.hasVariableUsage ?? false;
      const currencyCode = monthlyValues.get(key)?.currencyCode ?? 'USD';
      const existing = expirationMap.get(key);
      if (existing) {
        existing.monthly_value = monthlyValue;
        existing.has_variable_usage = hasVariableUsage;
        existing.currency_code = currencyCode;
        continue;
      }

      expirationMap.set(key, {
        client_contract_id: row.client_contract_id,
        contract_name: row.contract_name,
        client_id: row.client_id,
        client_name: row.client_name || 'Unknown Client',
        end_date: endDate.toISOString().split('T')[0],
        decision_due_date: row.decision_due_date ? new Date(row.decision_due_date).toISOString().split('T')[0] : null,
        renewal_mode: effectiveRenewalMode,
        queue_status: row.queue_status ?? null,
        days_until_expiration: Math.max(0, daysUntilExpiration),
        monthly_value: monthlyValue,
        has_variable_usage: hasVariableUsage,
        currency_code: currencyCode,
        auto_renew: effectiveRenewalMode === 'auto'
      });
    }

    const rows: ContractExpiration[] = Array.from(expirationMap.values()).map(
      ({ client_contract_id: _ignored, ...item }) => item
    );

    const clientIds = Array.from(
      new Set(rows.map((row) => row.client_id).filter((id): id is string => Boolean(id)))
    );
    if (clientIds.length > 0) {
      const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
      for (const row of rows) {
        row.logoUrl = row.client_id ? logoUrlsMap.get(row.client_id) ?? null : null;
      }
    }

    return rows;
  } catch (error) {
    console.error('Error fetching contract expiration report:', error);
    throw error;
  }
});

/**
 * Get bucket usage report data
 * Monitor bucket hours usage and identify overage situations
 */
export const getBucketUsageReport = withAuth(async (user, { tenant }): Promise<BucketUsage[] | ActionPermissionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    // Weighted-burn pools: one row per (client contract assignment × bucket
    // pool). Used/remaining/overage come from the canonical period-scoped
    // weighted bucket_usage ledger — the single source of truth the draw and
    // overage-billing paths write — NEVER from raw time_entries, which are
    // unweighted, unscoped, and include entries that never drew from the pool.
    const todayISO = new Date().toISOString().slice(0, 10);

    const dataQuery = db.table('contracts as c')
      .select(
        'c.contract_id',
        'c.contract_name',
        'cl.client_id',
        'cl.client_name',
        'clb.total_minutes as pool_total_minutes',
        'bu.minutes_used as used_minutes',
        'bu.overage_minutes as overage_minutes',
        'bu.rolled_over_minutes as rolled_over_minutes'
      );
    db.tenantJoin(dataQuery, 'contract_lines as cl_line', 'c.contract_id', 'cl_line.contract_id', { type: 'left' });
    db.tenantJoin(dataQuery, 'contract_line_buckets as clb', 'cl_line.contract_line_id', 'clb.contract_line_id', { type: 'left' });
    db.tenantJoin(dataQuery, 'client_contracts as cc', 'c.contract_id', 'cc.contract_id', { type: 'left' });
    db.tenantJoin(dataQuery, 'clients as cl', 'cc.client_id', 'cl.client_id', { type: 'left' });
    // Current-period ledger row for this pool and this client assignment.
    // period_start/period_end are stored as inclusive calendar dates by
    // findOrCreateCurrentBucketUsageRecord, so containment is <= today <= end.
    db.tenantJoin(dataQuery, 'bucket_usage as bu', 'clb.bucket_id', 'bu.bucket_id', {
      type: 'left',
      on: (join) => {
        join.andOn('bu.client_id', '=', 'cc.client_id');
        join.andOn('bu.period_start', '<=', knex.raw('?', [todayISO]));
        join.andOn('bu.period_end', '>=', knex.raw('?', [todayISO]));
      },
    });
    const data = await dataQuery;

    // Display rounding only — all arithmetic stays in weighted minutes so
    // rounding can neither invent nor hide overage.
    const minutesToHours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;

    const bucketUsages: BucketUsage[] = data
      .filter((row: any) => row.contract_name && row.pool_total_minutes != null) // Only lines that actually have a pool
      .map((row: any) => {
        const poolMinutes = Number(row.pool_total_minutes);
        const rolledOverMinutes = row.rolled_over_minutes != null ? Number(row.rolled_over_minutes) : 0;
        // Effective capacity for the current period: pool size + rollover,
        // exactly as updateBucketUsageMinutes computes overage against.
        const capacityMinutes = poolMinutes + rolledOverMinutes;
        const usedMinutes = row.used_minutes != null ? Number(row.used_minutes) : 0;
        const overageMinutes = row.overage_minutes != null
          ? Number(row.overage_minutes)
          : Math.max(0, usedMinutes - capacityMinutes);
        const remainingMinutes = Math.max(0, capacityMinutes - usedMinutes);
        const utilizationPercentage = capacityMinutes > 0
          ? Math.round((usedMinutes / capacityMinutes) * 100)
          : 0;

        return {
          contract_name: row.contract_name,
          client_id: row.client_id,
          client_name: row.client_name || 'Unknown Client',
          total_hours: minutesToHours(capacityMinutes),
          used_hours: minutesToHours(usedMinutes),
          remaining_hours: minutesToHours(remainingMinutes),
          utilization_percentage: utilizationPercentage,
          overage_hours: minutesToHours(overageMinutes)
        };
      });

    const clientIds = Array.from(
      new Set(bucketUsages.map((row) => row.client_id).filter((id): id is string => Boolean(id)))
    );
    if (clientIds.length > 0) {
      const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
      for (const row of bucketUsages) {
        row.logoUrl = row.client_id ? logoUrlsMap.get(row.client_id) ?? null : null;
      }
    }

    return bucketUsages;
  } catch (error) {
    console.error('Error fetching bucket usage report:', error);
    throw error;
  }
});

export interface HourBlockUsage {
  block_id: string;
  client_id: string;
  client_name: string;
  logoUrl?: string | null;
  service_name: string;
  contract_name: string | null;
  status: string;
  total_hours: number;
  used_hours: number;
  remaining_hours: number;
  utilization_percentage: number;
  /** Cents per hour the block is valued at (minor units). */
  hourly_rate: number;
  currency_code: string;
  /**
   * Value of the unused hours, minor units of `currency_code`: remaining hours x hourly_rate,
   * rounded once on the server (computeRemainingBlockValueMinor). Zero unless the block is
   * active, since an expired or voided block's remaining hours are forfeited.
   */
  remaining_value: number;
  purchased_at: string | null;
  /** First day the block can be drawn (cadence blocks); null = no lower bound. */
  valid_from: string | null;
  expiration_date: string | null;
}

/**
 * Get prepaid hour-block usage report data
 * One row per issued block (ad-hoc and contract-issued) with burn progress.
 * Blocks with no liability (pending, or voided before issuance) are excluded,
 * as are blocks that fell out of the trailing 12-month window (see below) so
 * the report does not accumulate every block the tenant ever bought.
 */
export const getHourBlockUsageReport = withAuth(async (user, { tenant }): Promise<HourBlockUsage[] | ActionPermissionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    const blockQuery = db.table('hour_blocks as hb')
      .select(
        'hb.block_id',
        'hb.client_id',
        'hb.status',
        'hb.total_minutes',
        'hb.remaining_minutes',
        'hb.hourly_rate',
        'hb.currency_code',
        'hb.purchased_at',
        'hb.valid_from',
        'hb.expiration_date',
        'cl.contract_line_name as line_name',
        'c.contract_name',
        'sc.service_name',
        'clients.client_name'
      );
    db.tenantJoin(blockQuery, 'clients', 'hb.client_id', 'clients.client_id', { type: 'left' });
    db.tenantJoin(blockQuery, 'contract_lines as cl', 'hb.contract_line_id', 'cl.contract_line_id', { type: 'left' });
    db.tenantJoin(blockQuery, 'contracts as c', 'cl.contract_id', 'c.contract_id', { type: 'left' });
    db.tenantJoin(blockQuery, 'service_catalog as sc', 'hb.service_id', 'sc.service_id', { type: 'left' });
    blockQuery.whereNotNull('hb.purchased_at').andWhere('hb.status', '!=', 'pending');
    // Default window so the table does not grow without bound as blocks age
    // out: live blocks always, plus blocks that expired, were voided or were
    // purchased within the last 12 months. Callers narrow further in the UI.
    const today = new Date();
    const windowStartDateOnly = new Date(Date.UTC(
      today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0
    )).toISOString().slice(0, 10);
    blockQuery.where((builder) => {
      builder
        .where('hb.status', 'active')
        .orWhere('hb.expiration_date', '>=', windowStartDateOnly)
        .orWhere('hb.voided_at', '>=', windowStartDateOnly)
        .orWhere('hb.purchased_at', '>=', windowStartDateOnly);
    });
    blockQuery.orderBy('clients.client_name', 'asc').orderBy('hb.purchased_at', 'asc');
    const rows = await blockQuery;

    const usages: HourBlockUsage[] = rows.map((row: HourBlockUsageQueryRow) => mapHourBlockUsageRow(row));

    const clientIds = Array.from(new Set(usages.map((row) => row.client_id).filter((id): id is string => Boolean(id))));
    if (clientIds.length > 0) {
      const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
      for (const row of usages) {
        row.logoUrl = row.client_id ? logoUrlsMap.get(row.client_id) ?? null : null;
      }
    }

    return usages;
  } catch (error) {
    console.error('Error fetching hour block usage report:', error);
    throw error;
  }
});

/**
 * Get contract report summary statistics
 */
export const getContractReportSummary = withAuth(async (user, { tenant }): Promise<ContractReportSummary | ActionPermissionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    const revenueData = await getContractRevenueReport();
    if (isActionPermissionError(revenueData)) {
      return revenueData as ActionPermissionError;
    }

    // Committed fixed MRR: active effective commitments only, and never a
    // cross-currency sum — each contract currency aggregates separately.
    const fixedMrrByCurrency = aggregateCentsByCurrency(
      revenueData
        .filter((item) => item.status === 'active')
        .map((item) => ({ currencyCode: item.currency_code, amountCents: item.monthly_recurring })),
    );

    const today = new Date();
    const yearStartDateOnly = new Date(Date.UTC(today.getUTCFullYear(), 0, 1, 0, 0, 0, 0)).toISOString().slice(0, 10);
    const nextYearStartDateOnly = new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0)).toISOString().slice(0, 10);
    const ytdByAssignment = await getContractRevenueYtdByAssignment(
      knex,
      tenant,
      yearStartDateOnly,
      nextYearStartDateOnly
    );

    // YTD is actual billed revenue: include every assignment with billed
    // charges this year (even terminated ones), still separated by currency.
    let ytdRevenueByCurrency: CurrencyAmount[] = [];
    if (ytdByAssignment.size > 0) {
      const currencyQuery = db.table('client_contracts as cc')
        .whereIn('cc.client_contract_id', Array.from(ytdByAssignment.keys()))
        .select('cc.client_contract_id', 'c.currency_code');
      db.tenantJoin(currencyQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');
      const currencyRows = (await currencyQuery) as Array<{ client_contract_id: string; currency_code: string }>;
      const currencyByAssignment = new Map(currencyRows.map((row) => [row.client_contract_id, row.currency_code]));
      ytdRevenueByCurrency = aggregateCentsByCurrency(
        Array.from(ytdByAssignment.entries()).map(([clientContractId, amountCents]) => ({
          currencyCode: currencyByAssignment.get(clientContractId) ?? 'USD',
          amountCents,
        })),
      );
    }

    const activeContractCount = revenueData.filter((item) => item.status === 'active').length;
    const variableUsageContractCount = revenueData.filter(
      (item) => item.status === 'active' && item.has_variable_usage
    ).length;
    const summaryTodayDateOnly = today.toISOString().slice(0, 10);
    const inNinetyDays = new Date(today);
    inNinetyDays.setUTCDate(inNinetyDays.getUTCDate() + 90);
    const summaryNinetyDaysDateOnly = inNinetyDays.toISOString().slice(0, 10);

    const atRiskDecisionQuery = db.table('client_contracts as cc')
      .where({
        'cc.is_active': true,
      })
      .andWhere((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false))
      .whereNotNull('c.owner_client_id')
      .whereNotNull('cc.decision_due_date')
      .andWhere((builder) => {
        builder.whereNull('cc.start_date').orWhere('cc.start_date', '<=', summaryTodayDateOnly);
      })
      .andWhere((builder) => {
        builder.whereNull('cc.end_date').orWhere('cc.end_date', '>=', summaryTodayDateOnly);
      })
      .andWhere('cc.decision_due_date', '>=', summaryTodayDateOnly)
      .andWhere('cc.decision_due_date', '<=', summaryNinetyDaysDateOnly)
      .countDistinct('cc.client_contract_id as count');
    db.tenantJoin(atRiskDecisionQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');
    const atRiskDecisions = await atRiskDecisionQuery.first() as { count: string } | undefined;
    const atRiskDecisionCount = Number(atRiskDecisions?.count ?? 0);

    return {
      fixedMrrByCurrency,
      ytdRevenueByCurrency,
      activeContractCount,
      atRiskDecisionCount,
      variableUsageContractCount
    };
  } catch (error) {
    console.error('Error fetching contract report summary:', error);
    throw error;
  }
});

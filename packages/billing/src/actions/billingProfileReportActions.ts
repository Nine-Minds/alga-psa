'use server';

import type { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { BillingProfileSource } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { listClientBillingProfiles } from '@alga-psa/shared/billingClients/billingProfiles';

/**
 * Spend by billing profile (F053–F060).
 *
 * Read straight from `invoice_charges.billing_profile_id` with no rollup table
 * (F057). Every charge already carries its resolved profile and the chain step
 * that produced it, so a rollup would be a second copy of a number the charge
 * rows already state — and the first thing to drift.
 *
 * Charges are counted on **finalized and later** invoices only. A draft invoice
 * is a working document whose amounts still move; including it would make the
 * report disagree with itself between refreshes.
 */

export type BillingProfileReportError = ActionMessageError | ActionPermissionError;

export interface SpendByProfileRow {
  billingProfileId: string;
  profileName: string;
  isDefaultProfile: boolean;
  /** Net of charges, in cents. */
  netAmount: number;
  taxAmount: number;
  total: number;
  chargeCount: number;
  /**
   * Portion of `netAmount` attributed only because nothing upstream claimed the
   * charge (F059). A large share here means the segment split is not actually
   * configured — the numbers are arithmetically right and analytically useless.
   */
  clientDefaultFallbackAmount: number;
}

export interface SpendByProfileResult {
  rows: SpendByProfileRow[];
  currencyCode: string | null;
  periodStart: string;
  periodEnd: string;
  /** Present only when a comparison period was requested (F055). */
  comparison?: {
    periodStart: string;
    periodEnd: string;
    rows: SpendByProfileRow[];
  };
}

export interface SpendByProfileChargeRow {
  itemId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  description: string | null;
  serviceName: string | null;
  netAmount: number;
  taxAmount: number;
  billingProfileSource: BillingProfileSource | null;
  contractName: string | null;
}

export interface SpendByProfileInput {
  clientId: string;
  periodStart: string;
  periodEnd: string;
  /** Set to compare against an earlier window (F055). */
  comparisonPeriodStart?: string | null;
  comparisonPeriodEnd?: string | null;
}

/** Statuses whose amounts are settled enough to report on. */
const REPORTABLE_INVOICE_STATUSES = ['sent', 'paid', 'partially_paid', 'overdue', 'finalized'];

async function assertCanReadReport(user: any): Promise<void> {
  if (!(await hasPermission(user, 'billing_profile_report', 'read'))) {
    throw new Error('Permission denied: Cannot view spend by billing profile');
  }
}

function reportErrorFrom(error: unknown): BillingProfileReportError | null {
  if (error instanceof Error && error.message.includes('Permission denied')) {
    return permissionError(error.message);
  }
  return null;
}

function normalizeRange(periodStart: string, periodEnd: string): { start: string; end: string } | null {
  if (!periodStart || !periodEnd) return null;
  if (periodStart > periodEnd) return null;
  return { start: periodStart, end: periodEnd };
}

async function fetchSpendRows(
  knex: Knex,
  tenant: string,
  clientId: string,
  start: string,
  end: string,
): Promise<SpendByProfileRow[]> {
  const db = tenantDb(knex, tenant);

  const profiles = await listClientBillingProfiles(knex, tenant, clientId, {
    includeInactive: true,
  });
  const profilesById = new Map(profiles.map((profile) => [profile.billing_profile_id, profile]));

  const query = db.table('invoice_charges as ic');
  db.tenantJoin(query, 'invoices as i', 'i.invoice_id', 'ic.invoice_id');

  const rows = await query
    .where('i.client_id', clientId)
    .whereIn('i.status', REPORTABLE_INVOICE_STATUSES)
    .where('i.invoice_date', '>=', start)
    .where('i.invoice_date', '<', end)
    .whereNotNull('ic.billing_profile_id')
    .groupBy('ic.billing_profile_id')
    .select(
      'ic.billing_profile_id',
      knex.raw('COALESCE(SUM(ic.net_amount), 0)::bigint AS net_amount'),
      knex.raw('COALESCE(SUM(ic.tax_amount), 0)::bigint AS tax_amount'),
      knex.raw('COUNT(ic.item_id)::bigint AS charge_count'),
      knex.raw(
        `COALESCE(SUM(CASE WHEN ic.billing_profile_source = 'client_default' THEN ic.net_amount ELSE 0 END), 0)::bigint AS client_default_amount`,
      ),
    );

  return rows
    .map((row: any) => {
      const profile = profilesById.get(row.billing_profile_id);
      const netAmount = Number(row.net_amount ?? 0);
      const taxAmount = Number(row.tax_amount ?? 0);
      return {
        billingProfileId: row.billing_profile_id as string,
        profileName: profile?.name ?? 'Removed profile',
        isDefaultProfile: Boolean(profile?.is_default),
        netAmount,
        taxAmount,
        total: netAmount + taxAmount,
        chargeCount: Number(row.charge_count ?? 0),
        clientDefaultFallbackAmount: Number(row.client_default_amount ?? 0),
      } satisfies SpendByProfileRow;
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Totals per profile over a period, optionally against a comparison window.
 *
 * Returns an empty row set — not an error — for a client with no reportable
 * charges, so the UI can distinguish "nothing billed yet" from "you may not
 * look at this".
 */
export const getSpendByBillingProfile = withAuth(async (
  user,
  { tenant },
  input: SpendByProfileInput,
): Promise<SpendByProfileResult | BillingProfileReportError> => {
  try {
    await assertCanReadReport(user);

    const range = normalizeRange(input.periodStart, input.periodEnd);
    if (!range) {
      return actionError('Choose a period whose start is on or before its end.');
    }

    const { knex } = await createTenantKnex();
    const rows = await fetchSpendRows(knex, tenant, input.clientId, range.start, range.end);

    const currencyRow = await tenantDb(knex, tenant)
      .table('clients')
      .where({ client_id: input.clientId })
      .first('default_currency_code');

    const result: SpendByProfileResult = {
      rows,
      currencyCode: (currencyRow?.default_currency_code as string | null) ?? null,
      periodStart: range.start,
      periodEnd: range.end,
    };

    if (input.comparisonPeriodStart && input.comparisonPeriodEnd) {
      const comparisonRange = normalizeRange(
        input.comparisonPeriodStart,
        input.comparisonPeriodEnd,
      );
      if (!comparisonRange) {
        return actionError('Choose a comparison period whose start is on or before its end.');
      }
      result.comparison = {
        periodStart: comparisonRange.start,
        periodEnd: comparisonRange.end,
        rows: await fetchSpendRows(
          knex,
          tenant,
          input.clientId,
          comparisonRange.start,
          comparisonRange.end,
        ),
      };
    }

    return result;
  } catch (error) {
    const expected = reportErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * The individual charges behind one profile's number (F054).
 *
 * The same filters as the totals, so the drill-down is provably the set that
 * was summed rather than a similar-looking one.
 */
export const getChargesForBillingProfile = withAuth(async (
  user,
  { tenant },
  input: SpendByProfileInput & { billingProfileId: string },
): Promise<SpendByProfileChargeRow[] | BillingProfileReportError> => {
  try {
    await assertCanReadReport(user);

    const range = normalizeRange(input.periodStart, input.periodEnd);
    if (!range) {
      return actionError('Choose a period whose start is on or before its end.');
    }

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const query = db.table('invoice_charges as ic');
    db.tenantJoin(query, 'invoices as i', 'i.invoice_id', 'ic.invoice_id');
    db.tenantJoin(query, 'service_catalog as sc', 'sc.service_id', 'ic.service_id', {
      type: 'left',
    });
    // The contract name lives on the contract, not the charge; showing it is
    // what makes "billed to X because the contract is assigned to it" concrete.
    db.tenantJoin(query, 'client_contracts as cc', 'cc.client_contract_id', 'ic.client_contract_id', {
      type: 'left',
    });
    db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id', { type: 'left' });

    const rows = await query
      .where('i.client_id', input.clientId)
      .where('ic.billing_profile_id', input.billingProfileId)
      .whereIn('i.status', REPORTABLE_INVOICE_STATUSES)
      .where('i.invoice_date', '>=', range.start)
      .where('i.invoice_date', '<', range.end)
      .orderBy('i.invoice_date', 'desc')
      .select(
        'ic.item_id',
        'ic.invoice_id',
        'ic.description',
        'ic.net_amount',
        'ic.tax_amount',
        'ic.billing_profile_source',
        'c.contract_name',
        'i.invoice_number',
        'i.invoice_date',
        'sc.service_name',
      );

    return rows.map((row: any) => ({
      itemId: row.item_id,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number ?? null,
      invoiceDate: row.invoice_date ? String(row.invoice_date) : null,
      description: row.description ?? null,
      serviceName: row.service_name ?? null,
      netAmount: Number(row.net_amount ?? 0),
      taxAmount: Number(row.tax_amount ?? 0),
      billingProfileSource: (row.billing_profile_source as BillingProfileSource | null) ?? null,
      contractName: row.contract_name ?? null,
    }));
  } catch (error) {
    const expected = reportErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

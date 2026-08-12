/**
 * Database loaders for the deferred-revenue report. Every read is tenant
 * scoped through `tenantDb`; the orchestration in getDeferredRevenueReport.ts
 * composes these into the rollforward payload.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { resolvePeriodFee, type BilledFeeCandidate } from './fee';
import { classifyCreditSource, type CreditSourceInvoice } from './creditSource';
import type { BucketPeriodInput } from './hours';
import type { CreditTransactionRow } from './credits';
import type { CreditDetailRow } from './types';

/** Finalized invoice statuses (legacy 'Unpaid' etc. treated as billed). */
const NON_BILLED_INVOICE_STATUSES = new Set(['draft', 'cancelled', 'pending', 'void']);

export const CREDIT_TRANSACTION_TYPES = [
  'credit_issuance',
  'credit_issuance_from_negative_invoice',
  'prepayment',
  'credit_application',
  'credit_expiration',
  'credit_adjustment',
  'credit_transfer',
];

export interface LoadedClient {
  clientId: string;
  clientName: string;
  defaultCurrencyCode: string | null;
}

export interface CreditTrackingDetailRow {
  creditId: string;
  transactionId: string;
  clientId: string;
  currencyCode: string;
  amount: number;
  remainingAmount: number;
  expirationDate: string | null;
  isExpired: boolean;
  transactionType: string;
  issuedDate: string;
  description: string | null;
  invoiceId: string | null;
  metadata: unknown;
}

export interface RawBucketPeriodRow {
  usageId: string;
  contractLineId: string;
  contractId: string;
  contractLineName: string;
  clientId: string;
  serviceId: string;
  serviceName: string;
  periodStart: string;
  periodEnd: string;
  minutesUsed: number;
  rolledOverMinutes: number;
  totalMinutes: number;
  allowRollover: boolean;
  currencyCode: string;
  /** contract_lines.custom_rate in cents, when set. */
  lineCustomRate: number | null;
  /** service_catalog.default_rate in cents, when set. */
  catalogDefaultRate: number | null;
}

export interface RawPricingScheduleRow {
  contractId: string;
  effectiveDate: string;
  endDate: string | null;
  customRate: number | null;
}

export interface RawFixedFeeRow {
  contractLineId: string;
  serviceId: string;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  rate: number;
  quantity: number;
}

export interface RawFixedConfigRow {
  contractLineId: string;
  serviceId: string;
  baseRate: number | null;
  quantity: number;
}

function toStringValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadClients(conn: Knex | Knex.Transaction, tenant: string): Promise<LoadedClient[]> {
  const rows = await tenantDb(conn, tenant)
    .table('clients')
    .select('client_id', 'client_name', 'default_currency_code')
    .where('is_inactive', false);
  return rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    defaultCurrencyCode: row.default_currency_code ?? null,
  }));
}

export async function loadCreditTransactions(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Promise<CreditTransactionRow[]> {
  const rows = await tenantDb(conn, tenant)
    .table('transactions')
    .whereIn('type', CREDIT_TRANSACTION_TYPES)
    .select('transaction_id', 'client_id', 'currency_code', 'type', 'amount', 'created_at');
  return rows.map((row) => ({
    transactionId: row.transaction_id,
    clientId: row.client_id,
    currencyCode: row.currency_code || 'USD',
    type: row.type,
    amount: toNumber(row.amount),
    createdAt: toStringValue(row.created_at),
  }));
}

export async function loadCreditTrackingDetails(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Promise<CreditTrackingDetailRow[]> {
  const db = tenantDb(conn, tenant);
  const query = db.table('credit_tracking as ct');
  db.tenantJoin(query, 'transactions as t', 'ct.transaction_id', 't.transaction_id', { type: 'left' });

  const rows = await query.select(
    'ct.credit_id',
    'ct.transaction_id',
    'ct.client_id',
    'ct.currency_code',
    'ct.amount',
    'ct.remaining_amount',
    'ct.expiration_date',
    'ct.is_expired',
    't.type as transaction_type',
    't.created_at as issued_date',
    't.description',
    't.invoice_id',
    't.metadata',
  );

  return rows.map((row) => ({
    creditId: row.credit_id,
    transactionId: row.transaction_id,
    clientId: row.client_id,
    currencyCode: row.currency_code || 'USD',
    amount: toNumber(row.amount),
    remainingAmount: toNumber(row.remaining_amount),
    expirationDate: row.expiration_date ? toStringValue(row.expiration_date) : null,
    isExpired: Boolean(row.is_expired),
    transactionType: row.transaction_type ?? '',
    issuedDate: toStringValue(row.issued_date),
    description: row.description ?? null,
    invoiceId: row.invoice_id ?? null,
    metadata: row.metadata ?? null,
  }));
}

export async function loadCreditInvoices(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceIds: Array<string | null>,
): Promise<Map<string, CreditSourceInvoice>> {
  const distinct = Array.from(new Set(invoiceIds.filter((id): id is string => Boolean(id))));
  const result = new Map<string, CreditSourceInvoice>();
  if (distinct.length === 0) return result;

  const rows = await tenantDb(conn, tenant)
    .table('invoices')
    .whereIn('invoice_id', distinct)
    .select('invoice_id', 'invoice_number', 'is_prepayment', 'invoice_type');

  for (const row of rows) {
    result.set(row.invoice_id, {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number ?? null,
      isPrepayment: Boolean(row.is_prepayment),
      invoiceType: row.invoice_type ?? null,
    });
  }
  return result;
}

export async function loadBucketPeriods(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Promise<RawBucketPeriodRow[]> {
  const db = tenantDb(conn, tenant);
  const query = db.table('bucket_usage as bu');
  db.tenantJoin(query, 'contract_lines as cl', 'bu.contract_line_id', 'cl.contract_line_id');
  db.tenantJoin(query, 'contracts as ct', 'cl.contract_id', 'ct.contract_id');
  db.tenantJoin(
    query,
    'contract_line_service_configuration as clsc',
    'bu.contract_line_id',
    'clsc.contract_line_id',
    {
      on: (join) => {
        join.andOn('bu.service_catalog_id', '=', 'clsc.service_id');
        join.andOn('clsc.configuration_type', '=', conn.raw('?', ['Bucket']));
      },
    },
  );
  db.tenantJoin(query, 'contract_line_service_bucket_config as bc', 'clsc.config_id', 'bc.config_id');
  db.tenantJoin(query, 'service_catalog as sc', 'bu.service_catalog_id', 'sc.service_id');

  const rows = await query.select(
    'bu.usage_id',
    'bu.contract_line_id',
    'bu.client_id',
    'bu.service_catalog_id',
    'bu.period_start',
    'bu.period_end',
    'bu.minutes_used',
    'bu.rolled_over_minutes',
    'bc.total_minutes',
    'bc.allow_rollover',
    'ct.contract_id',
    'cl.contract_line_name',
    'cl.custom_rate',
    'ct.currency_code',
    'sc.service_name',
    'sc.default_rate',
  );

  return rows.map((row) => ({
    usageId: row.usage_id,
    contractLineId: row.contract_line_id,
    contractId: row.contract_id,
    contractLineName: row.contract_line_name ?? 'Unnamed contract line',
    clientId: row.client_id,
    serviceId: row.service_catalog_id,
    serviceName: row.service_name ?? 'Unnamed service',
    periodStart: toStringValue(row.period_start).slice(0, 10),
    periodEnd: toStringValue(row.period_end).slice(0, 10),
    minutesUsed: toNumber(row.minutes_used),
    rolledOverMinutes: toNumber(row.rolled_over_minutes),
    totalMinutes: toNumber(row.total_minutes),
    allowRollover: Boolean(row.allow_rollover),
    currencyCode: row.currency_code || 'USD',
    lineCustomRate: row.custom_rate !== null && row.custom_rate !== undefined ? toNumber(row.custom_rate) : null,
    catalogDefaultRate: row.default_rate !== null && row.default_rate !== undefined ? toNumber(row.default_rate) : null,
  }));
}

/**
 * Active pricing-schedule custom rates per contract. Mirrors the billing
 * engine's override lookup (billingEngine.ts): the schedule with the latest
 * effective_date that starts before the period's end (exclusive) and ends
 * after the period's start (exclusive) wins, and its custom_rate — in cents —
 * takes precedence over the contract-line custom rate.
 */
export async function loadPricingScheduleRates(
  conn: Knex | Knex.Transaction,
  tenant: string,
  contractIds: Array<string>,
): Promise<RawPricingScheduleRow[]> {
  const distinct = Array.from(new Set(contractIds.filter(Boolean)));
  if (distinct.length === 0) return [];

  const rows = await tenantDb(conn, tenant)
    .table('contract_pricing_schedules')
    .whereIn('contract_id', distinct)
    .select('contract_id', 'effective_date', 'end_date', 'custom_rate');

  return rows.map((row) => ({
    contractId: row.contract_id,
    effectiveDate: toStringValue(row.effective_date).slice(0, 10),
    endDate: row.end_date ? toStringValue(row.end_date).slice(0, 10) : null,
    customRate: row.custom_rate !== null && row.custom_rate !== undefined ? toNumber(row.custom_rate) : null,
  }));
}

function addDays(dateString: string, days: number): string {
  const date = new Date(Date.parse(`${dateString}T00:00:00.000Z`));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Resolve the pricing-schedule custom rate in effect for an inclusive bucket
 * period, or null when no schedule overrides it.
 */
export function resolvePricingScheduleRate(
  periodStart: string,
  periodEnd: string,
  contractId: string,
  schedules: RawPricingScheduleRow[],
): number | null {
  const startExclusive = periodStart;
  const endExclusive = addDays(periodEnd, 1);

  let best: RawPricingScheduleRow | null = null;
  for (const schedule of schedules) {
    if (schedule.contractId !== contractId) continue;
    if (schedule.customRate === null) continue;
    if (schedule.effectiveDate >= endExclusive) continue;
    if (schedule.endDate !== null && schedule.endDate <= startExclusive) continue;
    if (best === null || schedule.effectiveDate > best.effectiveDate) {
      best = schedule;
    }
  }
  return best?.customRate ?? null;
}

/**
 * Billed fixed-config fees for bucket lines on finalized invoices:
 * invoice_charges → invoice_charge_details.config_id →
 * contract_line_service_configuration (configuration_type = 'Fixed').
 */
export async function loadBilledBucketFees(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Promise<BilledFeeCandidate[]> {
  const db = tenantDb(conn, tenant);
  const query = db.table('invoice_charge_details as iid');
  db.tenantJoin(query, 'contract_line_service_configuration as clsc', 'iid.config_id', 'clsc.config_id');
  db.tenantJoin(query, 'invoice_charges as ic', 'iid.item_id', 'ic.item_id');
  db.tenantJoin(query, 'invoices as inv', 'ic.invoice_id', 'inv.invoice_id');

  const rows = await query
    .where('clsc.configuration_type', 'Fixed')
    .whereNotIn('inv.status', Array.from(NON_BILLED_INVOICE_STATUSES))
    .select(
      'clsc.contract_line_id',
      'clsc.service_id',
      'iid.service_period_start',
      'iid.service_period_end',
      'iid.rate',
      'iid.quantity',
    );

  return rows.map((row) => ({
    contractLineId: row.contract_line_id,
    serviceId: row.service_id,
    servicePeriodStart: row.service_period_start ? toStringValue(row.service_period_start).slice(0, 10) : '',
    servicePeriodEnd: row.service_period_end ? toStringValue(row.service_period_end).slice(0, 10) : '',
    feeCents: toNumber(row.rate) * Math.max(1, toNumber(row.quantity) || 1),
  }));
}

/**
 * Configured base rate per bucket line×service from the line's Fixed config
 * (contract_line_service_fixed_config.base_rate × quantity), in cents. The
 * report's fee fallback resolves: contract-line custom rate → this →
 * service-catalog default rate.
 */
export async function loadFixedConfigBaseRates(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Promise<Map<string, number | null>> {
  const db = tenantDb(conn, tenant);

  const fixedConfigsQuery = db.table('contract_line_service_configuration as clsc');
  db.tenantJoin(
    fixedConfigsQuery,
    'contract_line_service_fixed_config as fc',
    'clsc.config_id',
    'fc.config_id',
    { type: 'left' },
  );
  const fixedConfigs = await fixedConfigsQuery
    .where('clsc.configuration_type', 'Fixed')
    .select('clsc.contract_line_id', 'clsc.service_id', 'clsc.quantity as config_quantity', 'fc.base_rate');

  const byLineService = new Map<string, number | null>();

  for (const row of fixedConfigs) {
    const quantity = Math.max(1, toNumber(row.config_quantity) || 1);
    const baseRate = row.base_rate !== null && row.base_rate !== undefined ? toNumber(row.base_rate) : null;
    byLineService.set(`${row.contract_line_id}\u0000${row.service_id}`, baseRate !== null ? baseRate * quantity : null);
  }

  return byLineService;
}

export interface BuildDeferredRevenueInput {
  clients: LoadedClient[];
  creditTransactions: CreditTransactionRow[];
  creditTracking: CreditTrackingDetailRow[];
  creditInvoices: Map<string, CreditSourceInvoice>;
  bucketPeriods: RawBucketPeriodRow[];
  billedFees: BilledFeeCandidate[];
  /** fixed-config base rate × quantity, keyed by `${contractLineId}\u0000${serviceId}`. */
  fixedConfigBaseRates: Map<string, number | null>;
  /** contract_pricing_schedules rows for every bucket-period contract. */
  pricingSchedules: RawPricingScheduleRow[];
}

export async function loadDeferredRevenueData(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Promise<BuildDeferredRevenueInput> {
  const [clients, creditTransactions, creditTracking, bucketPeriods, billedFees, fixedConfigBaseRates] =
    await Promise.all([
      loadClients(conn, tenant),
      loadCreditTransactions(conn, tenant),
      loadCreditTrackingDetails(conn, tenant),
      loadBucketPeriods(conn, tenant),
      loadBilledBucketFees(conn, tenant),
      loadFixedConfigBaseRates(conn, tenant),
    ]);

  const pricingSchedules = await loadPricingScheduleRates(
    conn,
    tenant,
    bucketPeriods.map((period) => period.contractId),
  );

  const invoiceIds = [
    ...creditTracking.map((credit) => credit.invoiceId),
    ...creditTracking.map((credit) =>
      typeof credit.metadata === 'object' && credit.metadata !== null
        ? (credit.metadata as Record<string, unknown>).source_invoice_id
        : null,
    ),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);

  const creditInvoices = await loadCreditInvoices(conn, tenant, invoiceIds);

  return {
    clients,
    creditTransactions,
    creditTracking,
    creditInvoices,
    bucketPeriods,
    billedFees,
    fixedConfigBaseRates,
    pricingSchedules,
  };
}

/**
 * Resolve the fallback (not-yet-billed) period fee for a bucket line×service
 * in the billing engine's rate-resolution order: pricing-schedule custom rate
 * → contract-line custom rate → fixed-config base rate × quantity →
 * service-catalog default rate.
 */
export function resolveConfiguredFee(
  period: RawBucketPeriodRow,
  baseRateCents: number | null,
  pricingScheduleRate: number | null,
): number | null {
  if (pricingScheduleRate !== null) return pricingScheduleRate;
  if (period.lineCustomRate !== null) return period.lineCustomRate;
  if (baseRateCents !== null) return baseRateCents;
  if (period.catalogDefaultRate !== null) return period.catalogDefaultRate;
  return null;
}

/** Build the per-period inputs for the hours rollforward with fees resolved. */
export function buildBucketPeriodInputs(
  data: BuildDeferredRevenueInput,
): BucketPeriodInput[] {
  return data.bucketPeriods.map((period) => {
    const pricingScheduleRate = resolvePricingScheduleRate(
      period.periodStart,
      period.periodEnd,
      period.contractId,
      data.pricingSchedules,
    );
    const configuredFee = resolveConfiguredFee(
      period,
      data.fixedConfigBaseRates.get(`${period.contractLineId}\u0000${period.serviceId}`) ?? null,
      pricingScheduleRate,
    );
    const resolved = resolvePeriodFee(
      period.periodStart,
      period.periodEnd,
      period.contractLineId,
      period.serviceId,
      data.billedFees,
      configuredFee,
    );
    return {
      ...period,
      periodFee: resolved.feeCents,
      feeSource: resolved.feeSource,
    };
  });
}

/** Build the credit detail rows for the report payload. */
export function buildCreditDetailRows(
  creditTracking: CreditTrackingDetailRow[],
  creditInvoices: Map<string, CreditSourceInvoice>,
): CreditDetailRow[] {
  return creditTracking.map((credit) => {
    const classification = classifyCreditSource(
      credit.transactionType,
      credit.invoiceId,
      credit.metadata,
      creditInvoices,
    );
    return {
      creditId: credit.creditId,
      transactionId: credit.transactionId,
      clientId: credit.clientId,
      issuedDate: credit.issuedDate,
      description: credit.description,
      amount: credit.amount,
      remainingAmount: credit.remainingAmount,
      expirationDate: credit.expirationDate,
      isExpired: credit.isExpired,
      sourceKind: classification.sourceKind,
      qboReachable: classification.qboReachable,
      invoiceNumber: classification.invoiceNumber,
      currencyCode: credit.currencyCode,
    };
  });
}

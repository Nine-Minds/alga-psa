import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { getClientDefaultBillingProfileId } from '../lib/billing/billingProfileLookup';
import {
  evaluateContractInvoiceAdjustments,
  type AutomaticDiscountPolicy,
  type DiscountScope,
  type InvoiceAdjustmentCharge,
} from '../lib/billing/compute/contractInvoiceAdjustments';

/**
 * Shared evaluation and persistence for automatic invoice adjustments.
 *
 * Generation, draft refresh and manual saves all reconcile through here, so the
 * stored discount rows and the customer-facing totals cannot drift: configured
 * discounts keep their explicit scope and their invoice-period eligibility
 * (never "today"), are de-duplicated across contract-line links, and are
 * evaluated by the same `evaluateContractInvoiceAdjustments` used by the pure
 * tests.
 *
 * Automatic lines are idempotent by `(tenant, invoice_id, source kind, source
 * id)`, the unique index established by the provenance migration.
 */

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table<Row>(table);
}

interface StoredChargeRow {
  item_id: string;
  service_id: string | null;
  client_contract_id: string | null;
  description: string;
  quantity: number | string | null;
  unit_price: number | string | null;
  net_amount: number | string | null;
  is_discount: boolean;
  is_manual: boolean;
  is_taxable: boolean | null;
  adjustment_source_kind: string | null;
}

export interface AdjustmentWindow {
  start: string;
  end: string;
}

/**
 * Normalizes a driver-returned date (Date, timestamp string or date-only
 * string) to `YYYY-MM-DD`. `String(date).slice(0, 10)` is not safe here: a
 * `Date` stringifies to "Tue Sep 01 …", not an ISO date.
 */
function toDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export async function loadInvoiceServiceWindow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
  invoice: { invoice_date?: unknown },
): Promise<AdjustmentWindow> {
  const row = await tenantDb(conn, tenant)
    .table('invoice_charge_details as d')
    .join('invoice_charges as c', function () {
      this.on('c.item_id', '=', 'd.item_id').andOn('c.tenant', '=', 'd.tenant');
    })
    .where({ 'c.invoice_id': invoiceId, 'c.tenant': tenant })
    .whereNotNull('d.service_period_start')
    .whereNotNull('d.service_period_end')
    .min({ start: 'd.service_period_start' })
    .max({ end: 'd.service_period_end' })
    .first();

  const detailStart = toDateOnly(row?.start);
  const detailEnd = toDateOnly(row?.end);
  if (detailStart && detailEnd) {
    return { start: detailStart, end: detailEnd };
  }
  const date = toDateOnly(invoice?.invoice_date) ?? Temporal.Now.plainDateISO().toString();
  return { start: date, end: date };
}

function toAdjustmentCharges(rows: StoredChargeRow[]): InvoiceAdjustmentCharge[] {
  return rows.map((charge) => ({
    item_id: charge.item_id,
    service_id: charge.service_id,
    client_contract_id: charge.client_contract_id,
    description: charge.description,
    quantity: Number(charge.quantity) || 0,
    unit_price: Number(charge.unit_price) || 0,
    net_amount: Number(charge.net_amount) || 0,
    is_discount: Boolean(charge.is_discount),
    is_manual: Boolean(charge.is_manual),
    is_taxable: Boolean(charge.is_taxable),
    adjustment_source_kind: charge.adjustment_source_kind as InvoiceAdjustmentCharge['adjustment_source_kind'],
  }));
}

async function loadInvoiceCharges(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<StoredChargeRow[]> {
  return tenantScopedTable<StoredChargeRow>(conn, tenant, 'invoice_charges')
    .where({ invoice_id: invoiceId, tenant })
    .select(
      'item_id',
      'service_id',
      'client_contract_id',
      'description',
      'quantity',
      'unit_price',
      'net_amount',
      'is_discount',
      'is_manual',
      'is_taxable',
      'adjustment_source_kind',
    );
}

function resolveDiscountScope(row: Record<string, unknown>): DiscountScope {
  const scope = row.scope;
  if (scope === 'contract' || scope === 'service' || scope === 'item' || scope === 'invoice') {
    return scope;
  }
  // Legacy unversioned discounts keep their invoice-wide base. The contract-line
  // link stays an eligibility trigger, never an implicit narrowing.
  return 'invoice';
}

/**
 * Builds scoped policies from configured discount rows. The same discount can
 * be returned once per linked contract line; it is de-duplicated by discount id
 * so the unique settlement index is never violated.
 */
export function buildAutomaticDiscountPolicies(
  discountRows: Array<Record<string, any>>,
): AutomaticDiscountPolicy[] {
  const policies = new Map<string, AutomaticDiscountPolicy>();
  for (const row of discountRows) {
    if (policies.has(row.discount_id)) continue;
    const scope = resolveDiscountScope(row);
    policies.set(row.discount_id, {
      discount_id: row.discount_id,
      discount_name: row.discount_name,
      discount_type: row.discount_type,
      value: Number(row.value) || 0,
      scope,
      applies_to_service_id: scope === 'service' ? (row.scope_service_id ?? null) : null,
      applies_to_item_id: scope === 'item' ? (row.applies_to_item_id ?? null) : null,
      client_contract_id: scope === 'contract' ? (row.client_contract_id ?? null) : null,
      priority: row.priority ?? null,
    });
  }
  return [...policies.values()];
}

async function loadApplicableDiscountRows(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  window: AdjustmentWindow,
): Promise<Array<Record<string, any>>> {
  const db = tenantDb(conn, tenant);
  const query = db.table('discounts');
  db.tenantJoin(query, 'contract_line_discounts as cld', 'discounts.discount_id', 'cld.discount_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'cld.contract_line_id');
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cl.contract_id');
  db.tenantJoin(query, 'client_contracts as cc', 'cc.contract_id', 'c.contract_id');

  return query
    .where({
      'cc.client_id': clientId,
      'cc.tenant': tenant,
      'discounts.is_active': true,
    })
    // Invoice-period eligibility (not "today"): half-open on the discount end,
    // inclusive on the window end, matching the billing engine.
    .andWhere('discounts.start_date', '<=', window.end)
    .andWhere(function (this: Knex.QueryBuilder) {
      this.whereNull('discounts.end_date').orWhere('discounts.end_date', '>', window.start);
    })
    .select('discounts.*', 'cld.contract_line_id', 'cc.client_contract_id');
}

interface DesiredSettlementRow {
  sourceId: string;
  description: string;
  netAmount: number;
  reason: string;
  periodStart: string | null;
  periodEnd: string | null;
  isDiscount: boolean;
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  scope?: DiscountScope;
  baseAmount?: number | null;
  metadata?: Record<string, unknown> | null;
}

async function applySettlementRows(
  tx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
  sourceKind: 'discount',
  desired: DesiredSettlementRow[],
): Promise<number> {
  const existing: Array<Record<string, any>> = await tenantScopedTable(tx, tenant, 'invoice_charges')
    .where({ invoice_id: invoiceId, tenant, adjustment_source_kind: sourceKind })
    .whereNotNull('adjustment_source_id')
    .select('item_id', 'adjustment_source_id');

  const existingBySource = new Map<string, Record<string, any>>(
    existing.map((row): [string, Record<string, any>] => [String(row.adjustment_source_id), row]),
  );
  const desiredIds = new Set(desired.map((row) => row.sourceId));
  const now = Temporal.Now.instant().toString();

  const invoice = await tenantScopedTable(tx, tenant, 'invoices')
    .where({ invoice_id: invoiceId, tenant })
    .first('client_id');
  const billingProfileId = invoice?.client_id
    ? await getClientDefaultBillingProfileId(tx, tenant, invoice.client_id as string)
    : null;

  for (const row of desired) {
    const existingRow = existingBySource.get(row.sourceId);
    const values: Record<string, unknown> = {
      description: row.description,
      quantity: 1,
      unit_price: row.isDiscount
        ? (row.discountType === 'percentage' ? 0 : row.netAmount)
        : row.netAmount,
      net_amount: row.netAmount,
      total_price: row.netAmount,
      tax_amount: 0,
      tax_rate: 0,
      is_taxable: false,
      is_discount: row.isDiscount,
      is_manual: false,
      discount_type: row.isDiscount ? (row.discountType ?? null) : null,
      discount_percentage:
        row.isDiscount && row.discountType === 'percentage' ? (row.discountValue ?? null) : null,
      billing_profile_id: billingProfileId,
      billing_profile_source: 'client_default',
      adjustment_source_kind: sourceKind,
      adjustment_source_id: row.sourceId,
      adjustment_source_revision: 1,
      adjustment_scope: row.scope ?? null,
      adjustment_base_amount: row.baseAmount ?? null,
      adjustment_reason: row.reason,
      adjustment_period_start: row.periodStart,
      adjustment_period_end: row.periodEnd,
      manual_line_metadata: row.metadata ? JSON.stringify(row.metadata) : null,
      updated_at: now,
    };

    if (existingRow) {
      await tenantScopedTable(tx, tenant, 'invoice_charges')
        .where({ item_id: existingRow.item_id, invoice_id: invoiceId, tenant })
        .update(values);
    } else {
      await tenantScopedTable(tx, tenant, 'invoice_charges').insert({
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: null,
        client_contract_id: null,
        tenant,
        created_at: now,
        created_by: null,
        ...values,
      });
    }
  }

  // Remove only this source kind's stale automatic settlements; manual rows and
  // other sources are untouched.
  for (const row of existing) {
    if (desiredIds.has(String(row.adjustment_source_id))) continue;
    await tenantScopedTable(tx, tenant, 'invoice_charges')
      .where({ item_id: row.item_id, invoice_id: invoiceId, tenant, adjustment_source_kind: sourceKind })
      .delete();
  }

  return desired.reduce((sum, row) => sum + row.netAmount, 0);
}

interface InvoiceForSettlement {
  is_manual: boolean;
  client_id: string;
  invoice_date?: unknown;
}

/**
 * Re-evaluates configured automatic discounts and upserts their settlement
 * rows. Returns the total discount magnitude (positive) applied.
 */
export async function reconcileAutomaticInvoiceDiscounts(
  tx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<number> {
  const invoice = (await tenantScopedTable<Record<string, any>>(tx, tenant, 'invoices')
    .where({ invoice_id: invoiceId, tenant })
    .first()) as InvoiceForSettlement | undefined;
  if (!invoice) return 0;

  const charges = await loadInvoiceCharges(tx, tenant, invoiceId);
  const provenance = charges.filter((charge) => charge.adjustment_source_kind === 'discount');
  const contractOrigin = !invoice.is_manual;
  if (provenance.length === 0 && !contractOrigin) return 0;

  const window = await loadInvoiceServiceWindow(tx, tenant, invoiceId, invoice);
  const discountRows = await loadApplicableDiscountRows(tx, tenant, invoice.client_id, window);
  const policies = buildAutomaticDiscountPolicies(discountRows);
  const result = evaluateContractInvoiceAdjustments({
    charges: toAdjustmentCharges(charges),
    automaticDiscounts: policies,
  });

  const desired: DesiredSettlementRow[] = result.discounts.map((discount) => ({
    sourceId: discount.discount_id,
    description: discount.discount_name,
    netAmount: -discount.amount,
    reason: `Automatic discount: ${discount.discount_name}${discount.base_amount !== undefined ? ` (${discount.scope} scope, base ${discount.base_amount})` : ''}`,
    periodStart: window.start,
    periodEnd: window.end,
    isDiscount: true,
    discountType: discount.discount_type,
    discountValue: discount.value,
    scope: discount.scope,
    baseAmount: discount.base_amount,
  }));

  const applied = await applySettlementRows(tx, tenant, invoiceId, 'discount', desired);
  return Math.abs(applied);
}

/**
 * Reconciles configured automatic discounts in one transaction. Generation and
 * manual saves call this so every representation uses the same evaluator and
 * provenance.
 */
export async function reconcileAutomaticInvoiceAdjustments(
  tx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<{ automaticDiscountAmount: number }> {
  const automaticDiscountAmount = await reconcileAutomaticInvoiceDiscounts(tx, tenant, invoiceId);
  return { automaticDiscountAmount };
}

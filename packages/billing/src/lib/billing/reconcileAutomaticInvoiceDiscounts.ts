import { Temporal } from '@js-temporal/polyfill';
import { resolveInvoiceDiscounts } from './resolveInvoiceDiscounts';
import type { DiscountEvaluationCharge } from './compute/computeDiscountsAndAdjustments';
import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  evaluateContractInvoiceAdjustments,
  type AutomaticDiscountPolicy,
  type InvoiceAdjustmentCharge,
} from './compute/contractInvoiceAdjustments';
import { getClientDefaultBillingProfileId } from './billingProfileLookup';
import { contractAdjustmentDateOnly } from './reconcileContractChangeAdjustments';

/**
 * Reconciles configured automatic contract discounts on an editable draft
 * through the shared evaluator, against the actual persisted (and reconciled)
 * charge rows. Generation, draft refresh and scheduler-driven reconciliation
 * all call this before tax so cancelling a discounted true-up removes its old
 * discount, editing it re-derives the discount, fixed-discount caps hold, and
 * repeated refresh is idempotent via the source-linked settlement identity.
 *
 * Finalized/paid/exported invoices are never touched. Returns the positive
 * discount magnitude applied.
 */

const DISCOUNT_KIND = 'discount';

function table(conn: Knex | Knex.Transaction, tenant: string, name: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(name);
}

const dateOnly = contractAdjustmentDateOnly;

interface EditableInvoice {
  client_id: string;
  currency_code: string | null;
  windowStart: string;
  windowEnd: string;
  invoiceDate: string;
}

async function loadEditableInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<EditableInvoice | null> {
  const invoice = (await table(trx, tenant, 'invoices')
    .where({ tenant, invoice_id: invoiceId })
    .first(
      'client_id',
      'currency_code',
      'billing_period_start',
      'billing_period_end',
      'invoice_date',
      'status',
      'finalized_at',
    )) as
    | {
        client_id: string;
        currency_code: string | null;
        billing_period_start: unknown;
        billing_period_end: unknown;
        invoice_date: unknown;
        status: string | null;
        finalized_at: string | Date | null;
      }
    | undefined;
  if (!invoice) return null;
  if (invoice.finalized_at || invoice.status !== 'draft') return null;
  return {
    client_id: invoice.client_id,
    currency_code: invoice.currency_code,
    windowStart: dateOnly(invoice.billing_period_start) || dateOnly(invoice.invoice_date),
    windowEnd: dateOnly(invoice.billing_period_end) || dateOnly(invoice.invoice_date),
    invoiceDate: dateOnly(invoice.invoice_date),
  };
}

interface StoredCharge {
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
}

async function loadNonDiscountCharges(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<StoredCharge[]> {
  return (await table(trx, tenant, 'invoice_charges')
    .where({ tenant, invoice_id: invoiceId })
    .whereNot('is_discount', true)
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
    )) as StoredCharge[];
}

async function loadDiscountCoverage(
  trx: Knex.Transaction, tenant: string, invoiceId: string,
): Promise<DiscountEvaluationCharge[]> {
  const details = await tenantDb(trx, tenant).table('invoice_charge_details as d')
    .join('invoice_charges as c', function () {
      this.on('c.item_id', '=', 'd.item_id').andOn('c.tenant', '=', 'd.tenant');
    })
    .leftJoin('contract_line_service_configuration as cfg', function () {
      this.on('cfg.config_id', '=', 'd.config_id').andOn('cfg.tenant', '=', 'd.tenant');
    })
    .leftJoin('recurring_service_periods as p', function () {
      this.on('p.invoice_charge_detail_id', '=', 'd.item_detail_id').andOn('p.tenant', '=', 'd.tenant');
    })
    .where({ 'c.invoice_id': invoiceId })
    .select('cfg.contract_line_id', 'p.obligation_id', 'd.service_period_start', 'd.service_period_end');
  const coverage: DiscountEvaluationCharge[] = details.map(row => ({
    client_contract_line_id: row.contract_line_id ?? row.obligation_id ?? undefined,
    servicePeriodStart: row.service_period_start ? dateOnly(row.service_period_start) : undefined,
    servicePeriodEnd: row.service_period_end ? dateOnly(row.service_period_end) : undefined,
  }));
  if (await trx.schema.hasTable('contract_recurring_unit_adjustments')) {
    const adjustments = await tenantDb(trx, tenant).table('invoice_charges as c')
      .join('contract_recurring_unit_adjustments as a', function () {
        this.on(trx.raw('??::text = ??', ['a.revision_id', 'c.adjustment_source_id'])).andOn('a.tenant', '=', 'c.tenant');
      })
      .where({ 'c.invoice_id': invoiceId, 'c.adjustment_source_kind': 'contract_change' })
      .select('a.contract_line_id', 'c.adjustment_period_start', 'c.adjustment_period_end');
    coverage.push(...adjustments.map(row => ({
      client_contract_line_id: row.contract_line_id,
      servicePeriodStart: dateOnly(row.adjustment_period_start),
      servicePeriodEnd: Temporal.PlainDate.from(dateOnly(row.adjustment_period_end)).subtract({ days: 1 }).toString(),
    })));
  }
  return coverage;
}

function toEvaluatorCharges(rows: StoredCharge[]): InvoiceAdjustmentCharge[] {
  return rows.map((row) => ({
    item_id: row.item_id,
    service_id: row.service_id,
    client_contract_id: row.client_contract_id,
    description: row.description,
    quantity: Number(row.quantity) || 0,
    unit_price: Number(row.unit_price) || 0,
    net_amount: Number(row.net_amount) || 0,
    is_discount: false,
    is_manual: Boolean(row.is_manual),
    is_taxable: Boolean(row.is_taxable),
  }));
}

/**
 * Reconcile configured automatic discounts on an editable draft. Returns the
 * positive discount magnitude applied.
 */
export async function reconcileAutomaticInvoiceAdjustments(params: {
  trx: Knex.Transaction;
  tenant: string;
  invoiceId: string;
}): Promise<number> {
  const { trx, tenant, invoiceId } = params;
  const invoice = await loadEditableInvoice(trx, tenant, invoiceId);
  if (!invoice) return 0;

  const charges = await loadNonDiscountCharges(trx, tenant, invoiceId);
  const coverage = await loadDiscountCoverage(trx, tenant, invoiceId);
  const discountRows = await resolveInvoiceDiscounts(trx, tenant, invoice.client_id, {
    tenant, startDate: invoice.windowStart, endDate: invoice.windowEnd,
  }, coverage);
  const policies: AutomaticDiscountPolicy[] = discountRows.map((row, index) => ({
    discount_id: row.discount_id,
    discount_name: row.discount_name,
    discount_type: row.discount_type,
    value: Number(row.value) || 0,
    valueUnit: 'fraction',
    scope: 'invoice',
    priority: index,
  }));
  const result = evaluateContractInvoiceAdjustments({
    charges: toEvaluatorCharges(charges),
    automaticDiscounts: policies,
  });

  const hasProvenance = await trx.schema.hasColumn('invoice_charges', 'adjustment_source_kind');
  const now = new Date().toISOString();
  const billingProfileId = await getClientDefaultBillingProfileId(trx, tenant, invoice.client_id);

  const existing = (await table(trx, tenant, 'invoice_charges')
    .where({ tenant, invoice_id: invoiceId, is_discount: true, is_manual: false })
    .select('*')) as Array<{
    item_id: string;
    description: string | null;
    adjustment_source_kind: string | null;
    adjustment_source_id: string | null;
  }>;
  const sourceLinked = new Map(
    existing
      .filter((row) => row.adjustment_source_kind === DISCOUNT_KIND && row.adjustment_source_id)
      .map((row) => [String(row.adjustment_source_id), row.item_id]),
  );
  const legacyByDescription = new Map<string, string[]>();
  for (const row of existing) {
    if (row.adjustment_source_kind != null) continue;
    const key = (row.description ?? '').trim();
    legacyByDescription.set(key, [...(legacyByDescription.get(key) ?? []), row.item_id]);
  }

  let applied = 0;
  const desiredSourceIds = new Set(result.discounts.map((discount) => discount.discount_id));
  const adoptedLegacyItemIds = new Set<string>();
  for (const discount of result.discounts) {
    const netAmount = -Math.round(discount.amount);
    applied += discount.amount;
    const values = {
      service_id: null,
      client_contract_id: null,
      description: discount.discount_name,
      quantity: 1,
      unit_price: discount.discount_type === 'percentage' ? 0 : netAmount,
      net_amount: netAmount,
      total_price: netAmount,
      tax_amount: 0,
      tax_rate: 0,
      is_taxable: false,
      is_discount: true,
      is_manual: false,
      discount_type: hasProvenance ? discount.discount_type : null,
      discount_percentage:
        hasProvenance && discount.discount_type === 'percentage' ? discount.value : null,
      billing_profile_id: billingProfileId,
      billing_profile_source: billingProfileId ? 'client_default' : null,
      ...(hasProvenance ? {
        adjustment_source_kind: DISCOUNT_KIND,
        adjustment_source_id: discount.discount_id,
        adjustment_source_revision: 1,
        adjustment_scope: 'invoice',
        adjustment_base_amount: discount.base_amount,
        adjustment_reason: `Automatic discount: ${discount.discount_name} (${discount.scope} scope, base ${discount.base_amount})`,
      } : {}),
      updated_at: now,
      invoice_id: invoiceId,
      tenant,
    };
    const legacyCandidate = sourceLinked.get(discount.discount_id)
      ? undefined
      : legacyByDescription.get(discount.discount_name.trim())?.shift();
    const existingItemId = sourceLinked.get(discount.discount_id) ?? legacyCandidate;
    if (legacyCandidate) adoptedLegacyItemIds.add(legacyCandidate);
    if (existingItemId) {
      await table(trx, tenant, 'invoice_charges')
        .where({ tenant, invoice_id: invoiceId, item_id: existingItemId })
        .update(values);
    } else {
      await table(trx, tenant, 'invoice_charges').insert({
        item_id: randomUUID(),
        created_by: null,
        created_at: now,
        ...values,
      });
    }
  }

  // Remove automatic discount rows no longer granted (cancelled/expired/superseded).
  for (const row of existing) {
    const sourceId = row.adjustment_source_id;
    if (row.adjustment_source_kind === DISCOUNT_KIND && sourceId) {
      if (desiredSourceIds.has(String(sourceId))) continue;
      await table(trx, tenant, 'invoice_charges')
        .where({ tenant, invoice_id: invoiceId, item_id: row.item_id })
        .delete();
    } else if (row.adjustment_source_kind == null) {
      if (adoptedLegacyItemIds.has(row.item_id)) continue;
      await table(trx, tenant, 'invoice_charges')
        .where({ tenant, invoice_id: invoiceId, item_id: row.item_id, is_discount: true, is_manual: false })
        .modify(query => { if (hasProvenance) query.whereNull('adjustment_source_kind'); })
        .delete();
    }
  }

  return applied;
}

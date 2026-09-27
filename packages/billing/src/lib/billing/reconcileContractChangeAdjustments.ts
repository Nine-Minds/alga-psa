import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Transactional reconciliation of mid-period recurring-unit true-ups onto an
 * editable contract draft.
 *
 * The durable ledger (`contract_recurring_unit_adjustments`) is the source of
 * truth for one automatic `contract_change` settlement per canonical revision.
 * This module materialises, updates and removes the source-linked
 * `invoice_charges` row so draft refresh, revision edit/cancellation, repeated
 * generation and invoice regeneration all converge on exactly one row per
 * source. Finalized/paid/exported invoices are never touched, and a settlement
 * is never moved onto a competing invoice: a pending adjustment is claimed by
 * the earliest eligible editable draft only.
 */

export interface ContractChangeLedgerRow {
  adjustment_id: string;
  contract_line_id: string;
  service_id: string;
  config_id: string;
  contract_id: string | null;
  client_contract_id: string | null;
  client_id: string | null;
  currency_code: string;
  revision_id: string;
  revision_version: number;
  adjustment_period_start: string;
  adjustment_period_end: string;
  mid_period_effective_date: string;
  previous_quantity: number;
  new_quantity: number;
  quantity_delta: number;
  unit_rate_cents: number | string;
  covered_days: number;
  full_period_days: number;
  amount_cents: number | string;
  price_policy: string;
  reason: string;
  status: string;
  settled_invoice_id: string | null;
}

export interface ReconcileContractAdjustmentsResult {
  changed: boolean;
  settledInvoiceId: string | null;
  /** Signed minor-unit total of the adjustments materialized on the invoice. */
  amountCents: number;
}

function table(conn: Knex | Knex.Transaction, tenant: string, name: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(name);
}

function toDateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

interface EditableInvoice {
  invoice_id: string;
  client_id: string;
  client_contract_id: string | null;
  currency_code: string | null;
  invoice_date: string | Date | null;
}

async function loadEditableInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<EditableInvoice | null> {
  const invoice = (await table(trx, tenant, 'invoices')
    .where({ tenant, invoice_id: invoiceId })
    .first(
      'invoice_id',
      'client_id',
      'client_contract_id',
      'currency_code',
      'invoice_date',
      'status',
      'finalized_at',
    )) as (EditableInvoice & { status: string | null; finalized_at: string | Date | null }) | undefined;
  if (!invoice) return null;
  if (invoice.finalized_at || invoice.status !== 'draft') return null;
  return invoice;
}

/**
 * Contract lines represented on an invoice: a detail's service-config link is
 * the canonical signal, plus any source-linked adjustment already on the
 * invoice so a removed line's stale row can be cleaned up.
 */
async function loadIncludedLineIds(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<Set<string>> {
  const detailRows = (await tenantDb(trx, tenant)
    .table('invoice_charge_details as d')
    .join('invoice_charges as c', function () {
      this.on('c.item_id', '=', 'd.item_id').andOn('c.tenant', '=', 'd.tenant');
    })
    .join('contract_line_service_configuration as cfg', function () {
      this.on('cfg.config_id', '=', 'd.config_id').andOn('cfg.tenant', '=', 'd.tenant');
    })
    .where({ 'c.invoice_id': invoiceId, 'c.tenant': tenant })
    .whereNotNull('d.config_id')
    .distinct('cfg.contract_line_id', 'cfg.config_id')) as Array<{
    contract_line_id: string | null;
    config_id: string | null;
  }>;
  const lineIds = new Set<string>();
  for (const row of detailRows) {
    if (row.contract_line_id) lineIds.add(row.contract_line_id);
  }
  const sourceRows = (await table(trx, tenant, 'invoice_charges')
    .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'contract_change' })
    .select('adjustment_source_id')) as Array<{ adjustment_source_id: string | null }>;
  const revisionIds = sourceRows
    .map((row) => row.adjustment_source_id)
    .filter((id): id is string => Boolean(id));
  if (revisionIds.length > 0) {
    const ledger = (await table(trx, tenant, 'contract_recurring_unit_adjustments')
      .where({ tenant })
      .whereIn('revision_id', revisionIds)
      .select('contract_line_id')) as Array<{ contract_line_id: string }>;
    for (const row of ledger) lineIds.add(row.contract_line_id);
  }
  return lineIds;
}

/**
 * The earliest eligible editable draft for the same client/contract/currency
 * that represents the adjustment's line and whose window has begun. Used to
 * guarantee exactly one settlement across competing drafts.
 */
async function isSelectedAdjustmentTarget(
  trx: Knex.Transaction,
  tenant: string,
  invoice: EditableInvoice,
  adjustment: ContractChangeLedgerRow,
): Promise<boolean> {
  const drafts = (await table(trx, tenant, 'invoices')
    .where({ tenant, client_id: invoice.client_id, status: 'draft' })
    .whereNull('finalized_at')
    .whereNot('invoice_id', invoice.invoice_id)
    .orderBy('invoice_date', 'asc')
    .orderBy('created_at', 'asc')
    .orderBy('invoice_id', 'asc')
    .select('invoice_id')) as Array<{ invoice_id: string }>;
  for (const draft of drafts) {
    const lines = await loadIncludedLineIds(trx, tenant, draft.invoice_id);
    if (lines.has(adjustment.contract_line_id)) {
      return false;
    }
  }
  return true;
}

function buildChargeValues(
  tenant: string,
  invoiceId: string,
  adjustment: ContractChangeLedgerRow,
  serviceName: string,
  now: string,
): Record<string, unknown> {
  const netAmount = Math.round(Number(adjustment.amount_cents) || 0);
  const delta = Number(adjustment.quantity_delta) || 0;
  return {
    service_id: adjustment.service_id,
    client_contract_id: adjustment.client_contract_id ?? null,
    description: `Mid-period quantity change: ${serviceName}`,
    quantity: Math.abs(delta),
    unit_price: Math.round(Number(adjustment.unit_rate_cents) || 0),
    net_amount: netAmount,
    total_price: netAmount,
    tax_amount: 0,
    tax_rate: 0,
    tax_region: null,
    is_taxable: true,
    is_manual: false,
    is_discount: false,
    adjustment_source_kind: 'contract_change',
    adjustment_source_id: adjustment.revision_id,
    adjustment_source_revision: Number(adjustment.revision_version) || 1,
    adjustment_scope: 'service',
    adjustment_base_amount: Math.abs(delta) * Math.round(Number(adjustment.unit_rate_cents) || 0),
    adjustment_reason: adjustment.reason,
    adjustment_period_start: toDateOnly(adjustment.adjustment_period_start),
    adjustment_period_end: toDateOnly(adjustment.adjustment_period_end),
    manual_line_metadata: JSON.stringify({
      adjustmentId: adjustment.adjustment_id,
      previousQuantity: Number(adjustment.previous_quantity),
      newQuantity: Number(adjustment.new_quantity),
      quantityDelta: delta,
      unitRateCents: Math.round(Number(adjustment.unit_rate_cents) || 0),
      coveredDays: Number(adjustment.covered_days),
      fullPeriodDays: Number(adjustment.full_period_days),
      midPeriodEffectiveDate: toDateOnly(adjustment.mid_period_effective_date),
    }),
    updated_at: now,
    invoice_id: invoiceId,
    tenant,
  };
}

/**
 * Reconcile the mid-period true-up ledger against one invoice. No-op for a
 * finalized/paid/exported invoice or a non-existent invoice.
 */
export async function reconcileContractChangeAdjustmentsForInvoice(params: {
  trx: Knex.Transaction;
  tenant: string;
  invoiceId: string;
}): Promise<ReconcileContractAdjustmentsResult> {
  const { trx, tenant, invoiceId } = params;
  const invoice = await loadEditableInvoice(trx, tenant, invoiceId);
  if (!invoice) return { changed: false, settledInvoiceId: null, amountCents: 0 };

  const includedLineIds = await loadIncludedLineIds(trx, tenant, invoiceId);

  const settledRows = (await table(trx, tenant, 'contract_recurring_unit_adjustments')
    .where({ tenant, settled_invoice_id: invoiceId })
    .select('*')) as ContractChangeLedgerRow[];
  // A settled invoice that no longer exists (deleted/regenerated) releases its
  // adjustments back to pending below.
  const pendingRows = (await table(trx, tenant, 'contract_recurring_unit_adjustments')
    .where({ tenant, status: 'pending' })
    .select('*')) as ContractChangeLedgerRow[];

  const desired = new Map<string, ContractChangeLedgerRow>();
  for (const row of settledRows) {
    if (row.status === 'cancelled') continue;
    desired.set(row.revision_id, row);
  }
  const pendingToClaim: ContractChangeLedgerRow[] = [];
  for (const row of pendingRows) {
    if (row.client_id && invoice.client_id && row.client_id !== invoice.client_id) continue;
    if (row.contract_line_id && !includedLineIds.has(row.contract_line_id)) continue;
    if (
      row.client_contract_id &&
      invoice.client_contract_id &&
      row.client_contract_id !== invoice.client_contract_id
    ) {
      continue;
    }
    if (row.currency_code && invoice.currency_code && row.currency_code !== invoice.currency_code) {
      continue;
    }
    if (toDateOnly(row.adjustment_period_start) >= toDateOnly(invoice.invoice_date ?? '')) {
      // The affected period has not begun by the invoice date; leave pending.
      continue;
    }
    if (!(await isSelectedAdjustmentTarget(trx, tenant, invoice, row))) continue;
    pendingToClaim.push(row);
  }

  const serviceIds = [...new Set([...settledRows, ...pendingToClaim].map((row) => row.service_id))];
  const serviceRows = serviceIds.length
    ? ((await table(trx, tenant, 'service_catalog')
        .where({ tenant })
        .whereIn('service_id', serviceIds)
        .select('service_id', 'service_name')) as Array<{
        service_id: string;
        service_name: string | null;
      }>)
    : [];
  const serviceNameById = new Map(serviceRows.map((row) => [row.service_id, row.service_name ?? 'recurring item']));

  const now = new Date().toISOString();
  const existingRows = (await table(trx, tenant, 'invoice_charges')
    .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'contract_change' })
    .whereNotNull('adjustment_source_id')
    .select('item_id', 'adjustment_source_id')) as Array<{
    item_id: string;
    adjustment_source_id: string | null;
  }>;
  const existingByRevision = new Map(
    existingRows.map((row) => [String(row.adjustment_source_id), row.item_id]),
  );

  let changed = false;
  let adjustmentTotal = 0;

  // Materialise/refresh every desired adjustment.
  for (const row of [...desired.values(), ...pendingToClaim]) {
    adjustmentTotal += Math.round(Number(row.amount_cents) || 0);
    const values = buildChargeValues(tenant, invoiceId, row, serviceNameById.get(row.service_id) ?? 'recurring item', now);
    const existingItemId = existingByRevision.get(row.revision_id);
    let chargeId: string;
    if (existingItemId) {
      chargeId = existingItemId;
      await table(trx, tenant, 'invoice_charges')
        .where({ tenant, invoice_id: invoiceId, item_id: existingItemId })
        .update(values);
      existingByRevision.delete(row.revision_id);
      changed = true;
    } else {
      chargeId = randomUUID();
      await table(trx, tenant, 'invoice_charges').insert({
        item_id: chargeId,
        created_by: null,
        created_at: now,
        ...values,
      });
      changed = true;
    }
    if (row.status === 'pending' || row.settled_invoice_id !== invoiceId) {
      await table(trx, tenant, 'contract_recurring_unit_adjustments')
        .where({ tenant, adjustment_id: row.adjustment_id })
        .update({
          status: 'settled',
          settled_invoice_id: invoiceId,
          settled_charge_id: chargeId,
          settled_at: now,
          updated_at: now,
        });
    }
  }

  // Remove source-linked rows this invoice no longer owns (cancelled revision,
  // line removed, or settlement moved to another draft).
  for (const [, itemId] of existingByRevision) {
    await table(trx, tenant, 'invoice_charges')
      .where({ tenant, invoice_id: invoiceId, item_id: itemId, adjustment_source_kind: 'contract_change' })
      .delete();
    changed = true;
  }

  return {
    changed,
    settledInvoiceId: desired.size + pendingToClaim.length > 0 ? invoiceId : null,
    amountCents: adjustmentTotal,
  };
}

/**
 * Release adjustments settled on a now-missing or non-editable invoice back to
 * pending so the next eligible draft can claim them. Used when a draft is
 * deleted rather than refreshed.
 */
export async function releaseOrphanedContractAdjustments(params: {
  trx: Knex.Transaction;
  tenant: string;
}): Promise<void> {
  const { trx, tenant } = params;
  const settled = (await table(trx, tenant, 'contract_recurring_unit_adjustments')
    .where({ tenant, status: 'settled' })
    .whereNotNull('settled_invoice_id')
    .select('adjustment_id', 'settled_invoice_id')) as Array<{
    adjustment_id: string;
    settled_invoice_id: string;
  }>;
  if (settled.length === 0) return;
  const invoiceIds = [...new Set(settled.map((row) => row.settled_invoice_id))];
  const invoices = (await table(trx, tenant, 'invoices')
    .where({ tenant })
    .whereIn('invoice_id', invoiceIds)
    .select('invoice_id')) as Array<{ invoice_id: string }>;
  // Only a truly missing invoice releases its settlement. A finalized invoice
  // keeps its settlement permanently.
  const existing = new Set(invoices.map((row) => row.invoice_id));
  const orphaned = settled.filter((row) => !existing.has(row.settled_invoice_id));
  for (const row of orphaned) {
    await table(trx, tenant, 'contract_recurring_unit_adjustments')
      .where({ tenant, adjustment_id: row.adjustment_id })
      .update({
        status: 'pending',
        settled_invoice_id: null,
        settled_charge_id: null,
        settled_at: null,
        updated_at: new Date().toISOString(),
      });
  }
}

export { toDateOnly as contractAdjustmentDateOnly };

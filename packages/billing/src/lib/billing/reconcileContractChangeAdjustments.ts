import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getClientDefaultTaxRegionCode } from '@alga-psa/shared/billingClients/clientTax';
import { resolveContractLineChargeProfile } from './billingProfileLookup';

/**
 * Transactional reconciliation of mid-period recurring-unit true-ups onto an
 * editable contract draft.
 *
 * The durable ledger (`contract_recurring_unit_adjustments`) is the source of
 * truth for one automatic `contract_change` settlement per canonical revision.
 * A single deterministic target selector picks the earliest eligible editable
 * draft for the same client, contract assignment, currency and represented
 * line, including the current invoice in the ordering; only that target
 * materialises the row (claimed with a compare-and-set on the ledger row).
 * Preview, persisted discounts and reconciliation all resolve the same target
 * so an already-settled true-up is never billed twice.
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

export interface ContractChangeWindow {
  start: string;
  end: string;
}

interface DraftWindow extends ContractChangeWindow {
  invoice_id: string | null;
  client_contract_id: string | null;
  currency_code: string | null;
  invoice_date: string;
  created_at: string;
}

function table(conn: Knex | Knex.Transaction, tenant: string, name: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(name);
}

export function contractAdjustmentDateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

const dateOnly = contractAdjustmentDateOnly;
const timestamp = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

function orderDrafts(a: DraftWindow, b: DraftWindow): number {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  if (a.end !== b.end) return a.end < b.end ? -1 : 1;
  // An existing draft always owns its window ahead of a not-yet-created
  // candidate for the same window.
  if ((a.invoice_id === null) !== (b.invoice_id === null)) {
    return a.invoice_id === null ? 1 : -1;
  }
  if (a.invoice_date !== b.invoice_date) return a.invoice_date < b.invoice_date ? -1 : 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return String(a.invoice_id ?? '').localeCompare(String(b.invoice_id ?? ''));
}

interface EditableInvoice extends DraftWindow {
  client_id: string;
}

async function loadEditableInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<EditableInvoice | null> {
  const invoice = (await table(trx, tenant, 'invoices')
    .where({ tenant, invoice_id: invoiceId })
    .forUpdate()
    .first(
      'invoice_id',
      'client_id',
      'client_contract_id',
      'currency_code',
      'billing_period_start',
      'billing_period_end',
      'invoice_date',
      'created_at',
      'status',
      'finalized_at',
    )) as
    | (EditableInvoice & {
        billing_period_start: unknown;
        billing_period_end: unknown;
        status: string | null;
        finalized_at: string | Date | null;
      })
    | undefined;
  if (!invoice) return null;
  if (invoice.finalized_at || invoice.status !== 'draft') return null;
  return {
    invoice_id: invoice.invoice_id,
    client_id: invoice.client_id,
    client_contract_id: invoice.client_contract_id,
    currency_code: invoice.currency_code,
    start: dateOnly(invoice.billing_period_start),
    end: dateOnly(invoice.billing_period_end),
    invoice_date: dateOnly(invoice.invoice_date),
    created_at: timestamp(invoice.created_at),
  };
}

/**
 * Contract lines represented on each invoice. A detail's service-config link is
 * the canonical signal. An adjustment itself cannot make an invoice eligible.
 */
async function loadIncludedLinesByInvoice(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceIds: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const id of invoiceIds) result.set(id, new Set());
  if (invoiceIds.length === 0) return result;

  const detailRows = (await tenantDb(conn, tenant)
    .table('invoice_charge_details as d')
    .join('invoice_charges as c', function () {
      this.on('c.item_id', '=', 'd.item_id').andOn('c.tenant', '=', 'd.tenant');
    })
    .leftJoin('contract_line_service_configuration as cfg', function () {
      this.on('cfg.config_id', '=', 'd.config_id').andOn('cfg.tenant', '=', 'd.tenant');
    })
    .leftJoin('recurring_service_periods as p', function () {
      this.on('p.invoice_charge_detail_id', '=', 'd.item_detail_id').andOn('p.tenant', '=', 'd.tenant');
    })
    .whereIn('c.invoice_id', invoiceIds)
    .select('c.invoice_id', 'cfg.contract_line_id', 'p.obligation_id')) as Array<{
    invoice_id: string;
    contract_line_id: string | null;
    obligation_id: string | null;
  }>;
  for (const row of detailRows) {
    const lineId = row.contract_line_id ?? row.obligation_id;
    if (lineId) result.get(row.invoice_id)?.add(lineId);
  }

  return result;
}

/**
 * The deterministic target selector. Returns the adjustment ids whose
 * authoritative target is the candidate window, and the target window for any
 * adjustment that was asked about.
 */
export async function resolveContractChangeAdjustmentTargets(params: {
  conn: Knex | Knex.Transaction;
  tenant: string;
  clientId: string;
  currencyCode: string;
  window: ContractChangeWindow;
  lineIds: string[];
  /** Client-contract assignments billed on the candidate window. */
  clientContractIds?: string[];
  /** Rows to evaluate; when omitted the pending/settled rows for the lines. */
  adjustments?: ContractChangeLedgerRow[];
  /** Set during persistence; previews may resolve a not-yet-created window. */
  invoiceId?: string;
}): Promise<{
  adjustments: ContractChangeLedgerRow[];
  targetInvoiceIdByAdjustment: Map<string, string | null>;
  targetWindowStartByAdjustment: Map<string, string>;
}> {
  const { conn, tenant, clientId, currencyCode, window, lineIds } = params;
  const assignmentIds = params.clientContractIds ? new Set(params.clientContractIds) : null;
  if (lineIds.length === 0) {
    return {
      adjustments: [],
      targetInvoiceIdByAdjustment: new Map(),
      targetWindowStartByAdjustment: new Map(),
    };
  }

  const adjustments = params.adjustments ?? ((await table(conn, tenant, 'contract_recurring_unit_adjustments')
    .where({ tenant })
    .whereIn('status', ['pending', 'settled'])
    .whereIn('contract_line_id', lineIds)
    .andWhere('amount_cents', '!=', 0)
    .select('*')) as ContractChangeLedgerRow[]);
  if (adjustments.length === 0) {
    return {
      adjustments: [],
      targetInvoiceIdByAdjustment: new Map(),
      targetWindowStartByAdjustment: new Map(),
    };
  }

  // Editable drafts for this client, with their canonical invoice windows.
  const draftRows = (await table(conn, tenant, 'invoices')
    .where({ tenant, client_id: clientId, status: 'draft' })
    .whereNull('finalized_at')
    .select(
      'invoice_id',
      'client_contract_id',
      'currency_code',
      'billing_period_start',
      'billing_period_end',
      'invoice_date',
      'created_at',
    )) as Array<{
    invoice_id: string;
    client_contract_id: string | null;
    currency_code: string | null;
    billing_period_start: unknown;
    billing_period_end: unknown;
    invoice_date: unknown;
    created_at: unknown;
  }>;
  const drafts: DraftWindow[] = draftRows.map((row) => ({
    invoice_id: row.invoice_id,
    client_contract_id: row.client_contract_id,
    currency_code: row.currency_code,
    start: dateOnly(row.billing_period_start),
    end: dateOnly(row.billing_period_end),
    invoice_date: dateOnly(row.invoice_date),
    created_at: timestamp(row.created_at),
  }));
  const includedLines = await loadIncludedLinesByInvoice(
    conn,
    tenant,
    drafts.map((draft) => draft.invoice_id as string),
  );

  const assignmentRows = drafts.length ? await table(conn, tenant, 'invoice_charges')
    .whereIn('invoice_id', drafts.map(draft => draft.invoice_id!))
    .whereNotNull('client_contract_id')
    .select('invoice_id', 'client_contract_id') : [];
  const draftAssignments = new Map<string, Set<string>>();
  for (const draft of drafts) {
    draftAssignments.set(draft.invoice_id!, new Set(draft.client_contract_id ? [draft.client_contract_id] : []));
  }
  for (const row of assignmentRows) draftAssignments.get(row.invoice_id)?.add(row.client_contract_id);

  const targetInvoiceIdByAdjustment = new Map<string, string | null>();
  const targetWindowStartByAdjustment = new Map<string, string>();
  const included: ContractChangeLedgerRow[] = [];

  for (const adjustment of adjustments) {
    // Supplied ledger rows are not trusted to have been scoped by the caller.
    if ((adjustment.client_id && adjustment.client_id !== clientId) ||
        adjustment.currency_code !== currencyCode ||
        !lineIds.includes(adjustment.contract_line_id) ||
        dateOnly(adjustment.adjustment_period_start) >= window.end ||
        (adjustment.client_contract_id &&
          (!assignmentIds || !assignmentIds.has(adjustment.client_contract_id)))) continue;
    const eligibleDraft = (draft: DraftWindow) =>
      draft.currency_code === adjustment.currency_code &&
      draft.end > dateOnly(adjustment.adjustment_period_start) &&
      (!adjustment.client_contract_id || draftAssignments.get(draft.invoice_id!)?.has(adjustment.client_contract_id)) &&
      includedLines.get(draft.invoice_id!)?.has(adjustment.contract_line_id);
    if (adjustment.status === 'settled' && adjustment.settled_invoice_id) {
      const settledDraft = drafts.find((draft) => draft.invoice_id === adjustment.settled_invoice_id);
      if (settledDraft) {
        targetInvoiceIdByAdjustment.set(adjustment.adjustment_id, settledDraft.invoice_id);
        targetWindowStartByAdjustment.set(adjustment.adjustment_id, settledDraft.start);
        if (eligibleDraft(settledDraft) &&
            (params.invoiceId ? settledDraft.invoice_id === params.invoiceId :
              settledDraft.start === window.start && settledDraft.end === window.end)) {
          included.push(adjustment);
        }
      } else {
        // Settled on a finalized or now-missing invoice: not this window.
        targetInvoiceIdByAdjustment.set(adjustment.adjustment_id, null);
        targetWindowStartByAdjustment.set(adjustment.adjustment_id, '');
      }
      continue;
    }

    const candidates: DraftWindow[] = drafts.filter(eligibleDraft);
    if (!params.invoiceId) candidates.push({
      invoice_id: null,
      client_contract_id: adjustment.client_contract_id,
      currency_code: currencyCode,
      start: window.start,
      end: window.end,
      invoice_date: '',
      created_at: '',
    });
    candidates.sort(orderDrafts);
    const target = candidates[0];
    if (!target) continue;
    targetInvoiceIdByAdjustment.set(adjustment.adjustment_id, target.invoice_id);
    targetWindowStartByAdjustment.set(adjustment.adjustment_id, target.start);
    if (params.invoiceId ? target.invoice_id === params.invoiceId :
        target.start === window.start && target.end === window.end) {
      included.push(adjustment);
    }
  }

  return { adjustments: included, targetInvoiceIdByAdjustment, targetWindowStartByAdjustment };
}

/**
 * Engine-facing: the ledger rows whose authoritative target is this billing
 * window. Used for preview and for the discount base so the engine never prices
 * a settlement that belongs to an earlier editable draft.
 */
export async function resolveContractChangeChargesForWindow(params: {
  conn: Knex | Knex.Transaction;
  tenant: string;
  clientId: string;
  currencyCode: string;
  window: ContractChangeWindow;
  lineIds: string[];
  /** Client-contract assignments billed on the candidate window. */
  clientContractIds?: string[];
}): Promise<ContractChangeLedgerRow[]> {
  try {
    if (!(await params.conn.schema.hasTable('contract_recurring_unit_adjustments'))) return [];
    const resolved = await resolveContractChangeAdjustmentTargets(params);
    return resolved.adjustments;
  } catch (error) {
    if ((error as { code?: string })?.code === '42P01') return [];
    throw error;
  }
}

/**
 * Resolve service taxability/region and billing mapping for the true-up the
 * same way the recurring charge does, so tax is never applied to a
 * non-taxable service and a service region is not overwritten by the client
 * default.
 */
async function resolveAdjustmentMetadata(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  contractLineId: string,
  serviceId: string,
  clientContractId: string | null,
): Promise<{
  is_taxable: boolean;
  tax_region: string | null;
  billing_profile_id: string | null;
  billing_profile_source: string | null;
  location_id: string | null;
}> {
  const service = (await table(trx, tenant, 'service_catalog')
    .where({ tenant, service_id: serviceId })
    .first('tax_rate_id')) as { tax_rate_id: string | null } | undefined;
  let serviceRegion: string | null = null;
  if (service?.tax_rate_id) {
    const rate = (await table(trx, tenant, 'tax_rates')
      .where({ tenant, tax_rate_id: service.tax_rate_id })
      .first('region_code')) as { region_code: string | null } | undefined;
    serviceRegion = rate?.region_code ?? null;
  }
  // The covered line carries its own location, exactly like the recurring
  // charge; the location's region is the same fallback the engine uses.
  const line = (await table(trx, tenant, 'contract_lines')
    .where({ tenant, contract_line_id: contractLineId })
    .first('location_id')) as { location_id: string | null } | undefined;
  const locationId = line?.location_id ?? null;
  let locationRegion: string | null = null;
  if (locationId) {
    const location = (await table(trx, tenant, 'client_locations')
      .where({ tenant, location_id: locationId })
      .first('region_code')) as { region_code: string | null } | undefined;
    locationRegion = location?.region_code ?? null;
  }
  const clientRegion = serviceRegion
    ? null
    : locationRegion ?? (await getClientDefaultTaxRegionCode(trx, tenant, clientId));
  const profile = await resolveContractLineChargeProfile(trx, tenant, clientId, {
    contractLineId, clientContractId,
  });
  return {
    is_taxable: Boolean(serviceRegion),
    tax_region: serviceRegion ?? clientRegion,
    billing_profile_id: profile.billingProfileId,
    billing_profile_source: profile.source,
    location_id: locationId,
  };
}

function buildChargeValues(
  tenant: string,
  invoiceId: string,
  adjustment: ContractChangeLedgerRow,
  serviceName: string,
  metadata: {
    is_taxable: boolean;
    tax_region: string | null;
    billing_profile_id: string | null;
    billing_profile_source: string | null;
    location_id: string | null;
  },
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
    tax_region: metadata.tax_region,
    is_taxable: metadata.is_taxable,
    is_manual: false,
    is_discount: false,
    billing_profile_id: metadata.billing_profile_id,
    billing_profile_source: metadata.billing_profile_source,
    location_id: metadata.location_id,
    adjustment_source_kind: 'contract_change',
    adjustment_source_id: adjustment.revision_id,
    adjustment_source_revision: Number(adjustment.revision_version) || 1,
    adjustment_scope: 'service',
    adjustment_base_amount: Math.abs(delta) * Math.round(Number(adjustment.unit_rate_cents) || 0),
    adjustment_reason: adjustment.reason,
    adjustment_period_start: dateOnly(adjustment.adjustment_period_start),
    adjustment_period_end: dateOnly(adjustment.adjustment_period_end),
    manual_line_metadata: JSON.stringify({
      adjustmentId: adjustment.adjustment_id,
      previousQuantity: Number(adjustment.previous_quantity),
      newQuantity: Number(adjustment.new_quantity),
      quantityDelta: delta,
      unitRateCents: Math.round(Number(adjustment.unit_rate_cents) || 0),
      coveredDays: Number(adjustment.covered_days),
      fullPeriodDays: Number(adjustment.full_period_days),
      midPeriodEffectiveDate: dateOnly(adjustment.mid_period_effective_date),
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
  if (!(await trx.schema.hasTable('contract_recurring_unit_adjustments'))) {
    return { changed: false, settledInvoiceId: null, amountCents: 0 };
  }
  const invoice = await loadEditableInvoice(trx, tenant, invoiceId);
  if (!invoice) return { changed: false, settledInvoiceId: null, amountCents: 0 };

  const includedLineIds = (
    await loadIncludedLinesByInvoice(trx, tenant, [invoiceId])
  ).get(invoiceId) ?? new Set<string>();

  const ledgerRows = (await table(trx, tenant, 'contract_recurring_unit_adjustments')
    .where({ tenant })
    .whereIn('status', ['pending', 'settled'])
    .andWhere('amount_cents', '!=', 0)
    .orderBy('adjustment_id')
    .forUpdate()
    .select('*')) as ContractChangeLedgerRow[];

  const assignments = await table(trx, tenant, 'invoice_charges')
    .where({ tenant, invoice_id: invoiceId })
    .whereNotNull('client_contract_id')
    .distinct('client_contract_id');
  const assignmentIds = new Set<string>([invoice.client_contract_id, ...assignments.map(row => row.client_contract_id)].filter(Boolean) as string[]);
  // Reassignment/removal on an editable owner releases the source for a later
  // eligible draft. Finalized invoices returned above are never released.
  for (const row of ledgerRows) {
    if (row.settled_invoice_id !== invoiceId) continue;
    if ((row.client_id && row.client_id !== invoice.client_id) ||
        row.currency_code !== invoice.currency_code ||
        !includedLineIds.has(row.contract_line_id) ||
        dateOnly(row.adjustment_period_start) >= invoice.end ||
        (row.client_contract_id && !assignmentIds.has(row.client_contract_id))) {
      await table(trx, tenant, 'contract_recurring_unit_adjustments')
        .where({ tenant, adjustment_id: row.adjustment_id, settled_invoice_id: invoiceId })
        .update({ status: 'pending', settled_invoice_id: null, settled_charge_id: null, settled_at: null });
      row.status = 'pending';
      row.settled_invoice_id = null;
    }
  }
  const { adjustments: targeted } = await resolveContractChangeAdjustmentTargets({
    conn: trx,
    tenant,
    clientId: invoice.client_id,
    currencyCode: invoice.currency_code ?? '',
    window: { start: invoice.start, end: invoice.end },
    lineIds: [...includedLineIds],
    adjustments: ledgerRows,
    invoiceId,
    clientContractIds: [...assignmentIds],
  });
  const desired: ContractChangeLedgerRow[] = [...targeted];
  const serviceIds = [...new Set(desired.map((row) => row.service_id))];
  const serviceRows = serviceIds.length
    ? ((await table(trx, tenant, 'service_catalog')
        .where({ tenant })
        .whereIn('service_id', serviceIds)
        .select('service_id', 'service_name')) as Array<{
        service_id: string;
        service_name: string | null;
      }>)
    : [];
  const serviceNameById = new Map(
    serviceRows.map((row) => [row.service_id, row.service_name ?? 'recurring item']),
  );

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

  for (const row of desired) {
    const metadata = await resolveAdjustmentMetadata(
      trx,
      tenant,
      invoice.client_id,
      row.contract_line_id,
      row.service_id,
      row.client_contract_id,
    );
    const values = buildChargeValues(
      tenant,
      invoiceId,
      row,
      serviceNameById.get(row.service_id) ?? 'recurring item',
      metadata,
      now,
    );

    let claimed = row.status === 'settled' && row.settled_invoice_id === invoiceId;
    if (!claimed) {
      // Compare-and-set: only the first transaction to flip the row from
      // pending (or its prior owner) to this invoice may materialize it.
      const updated = await table(trx, tenant, 'contract_recurring_unit_adjustments')
        .where({ tenant, adjustment_id: row.adjustment_id })
        .whereIn('status', ['pending', 'settled'])
        .where(function () {
          this.where('settled_invoice_id', invoiceId).orWhereNull('settled_invoice_id');
        })
        .update({
          status: 'settled',
          settled_invoice_id: invoiceId,
          settled_at: now,
          updated_at: now,
        });
      claimed = Number(updated) > 0;
      if (!claimed) continue;
    }

    const existingItemId = existingByRevision.get(row.revision_id);
    let chargeId: string;
    if (existingItemId) {
      chargeId = existingItemId;
      await table(trx, tenant, 'invoice_charges')
        .where({ tenant, invoice_id: invoiceId, item_id: existingItemId })
        .update(values);
      existingByRevision.delete(row.revision_id);
    } else {
      chargeId = randomUUID();
      await table(trx, tenant, 'invoice_charges').insert({
        item_id: chargeId,
        created_by: null,
        created_at: now,
        ...values,
      });
    }
    await table(trx, tenant, 'contract_recurring_unit_adjustments')
      .where({ tenant, adjustment_id: row.adjustment_id })
      .update({ settled_charge_id: chargeId, updated_at: now });
    adjustmentTotal += Math.round(Number(row.amount_cents) || 0);
    changed = true;
  }

  // Remove rows this invoice no longer owns.
  for (const [, itemId] of existingByRevision) {
    await table(trx, tenant, 'invoice_charges')
      .where({ tenant, invoice_id: invoiceId, item_id: itemId, adjustment_source_kind: 'contract_change' })
      .delete();
    changed = true;
  }
  return {
    changed,
    settledInvoiceId: desired.length > 0 ? invoiceId : null,
    amountCents: adjustmentTotal,
  };
}

/**
 * Release adjustments settled on a now-missing invoice back to pending so the
 * next eligible draft can claim them. Finalized invoices keep their
 * settlements permanently. Wired into the delete/regenerate lifecycle.
 */
export async function releaseOrphanedContractAdjustments(params: {
  trx: Knex.Transaction;
  tenant: string;
}): Promise<void> {
  const { trx, tenant } = params;
  if (!(await trx.schema.hasTable('contract_recurring_unit_adjustments'))) return;
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
  const existing = new Set(invoices.map((row) => row.invoice_id));
  const orphaned = settled.filter((row) => !existing.has(row.settled_invoice_id));
  for (const row of orphaned) {
    await table(trx, tenant, 'contract_recurring_unit_adjustments')
      .where({ tenant, adjustment_id: row.adjustment_id, status: 'settled', settled_invoice_id: row.settled_invoice_id })
      .update({
        status: 'pending',
        settled_invoice_id: null,
        settled_charge_id: null,
        settled_at: null,
        updated_at: new Date().toISOString(),
      });
  }
}

export { table as contractAdjustmentTable };

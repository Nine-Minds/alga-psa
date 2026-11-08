import { loadInvoiceChargeLineIds } from './invoiceChargeLineage';
import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import type { IBillingCharge, IFixedPriceCharge } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { getClientDefaultBillingProfileId } from '../lib/billing/billingProfileLookup';
import {
  evaluateContractInvoiceAdjustments,
  storedDiscountValueToPolicyValue,
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
  contract_line_ids?: string[];
  manual_line_metadata?: unknown;
  adjustment_period_start?: unknown;
  adjustment_period_end?: unknown;
  service_periods?: Array<{ start: string; end: string }>;
  period_allocations?: InvoiceAdjustmentCharge['period_allocations'];
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
  const detailEndInclusive = toDateOnly(row?.end);
  // invoice_charge_details stores service-period ends inclusively. The shared
  // adjustment/discount evaluator uses half-open windows, so normalize exactly
  // once here.
  const detailEnd = detailEndInclusive
    ? Temporal.PlainDate.from(detailEndInclusive).add({ days: 1 }).toString()
    : null;
  // A carried companion true-up has no canonical recurring detail row by
  // design. Its persisted half-open provenance period still participates in
  // discount eligibility, so include it in the covered service window.
  const adjustmentRows = await tenantDb(conn, tenant)
    .table('invoice_charges')
    .where({ invoice_id: invoiceId, tenant, adjustment_source_kind: 'contract_change' })
    .whereNotNull('adjustment_period_start')
    .whereNotNull('adjustment_period_end')
    .select('adjustment_period_start', 'adjustment_period_end') as Array<{
      adjustment_period_start: unknown;
      adjustment_period_end: unknown;
    }>;
  const coverageStarts = [detailStart, ...adjustmentRows.map((item) => toDateOnly(item.adjustment_period_start))]
    .filter((value): value is string => Boolean(value))
    .sort();
  const coverageEnds = [detailEnd, ...adjustmentRows.map((item) => toDateOnly(item.adjustment_period_end))]
    .filter((value): value is string => Boolean(value))
    .sort();
  if (coverageStarts.length > 0 && coverageEnds.length > 0) {
    return { start: coverageStarts[0], end: coverageEnds[coverageEnds.length - 1] };
  }
  const date = toDateOnly(invoice?.invoice_date) ?? Temporal.Now.plainDateISO().toString();
  return { start: date, end: Temporal.PlainDate.from(date).add({ days: 1 }).toString() };
}

function toAdjustmentCharges(
  rows: StoredChargeRow[],
  fallbackOrdinaryPeriods: Array<{ start: string; end: string }>,
): InvoiceAdjustmentCharge[] {
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
    contract_line_ids: charge.contract_line_ids,
    period_allocations: charge.period_allocations?.map((part) => ({
      ...part, service_periods: part.service_periods.length ? part.service_periods : fallbackOrdinaryPeriods,
    })),
    // Ordinary charges without their own detail inherit the invoice's ordinary
    // coverage (or its date-only fallback). This keeps invoice-wide discounts
    // inclusive of eligible unattributed/manual additions while excluding
    // carried true-ups from expanding their dates.
    service_periods: charge.service_periods?.length
      ? charge.service_periods
      : charge.adjustment_source_kind !== 'contract_change' ? fallbackOrdinaryPeriods : charge.service_periods,
  }));
}

async function loadInvoiceCharges(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<StoredChargeRow[]> {
  const rows: StoredChargeRow[] = await tenantScopedTable<StoredChargeRow>(conn, tenant, 'invoice_charges')
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
      'adjustment_period_start',
      'adjustment_period_end',
      'manual_line_metadata',
    );
  if (rows.length === 0) return rows;
  const lineIdsByCharge = await loadInvoiceChargeLineIds(conn, tenant, invoiceId);
  const detailRows = await tenantDb(conn, tenant).table('invoice_charge_details as d')
    .join('invoice_charges as c', function () {
      this.on('c.item_id', '=', 'd.item_id').andOn('c.tenant', '=', 'd.tenant');
    })
    .leftJoin('invoice_charge_fixed_details as f', function () {
      this.on('f.item_detail_id', '=', 'd.item_detail_id').andOn('f.tenant', '=', 'd.tenant');
    })
    .where({ 'c.invoice_id': invoiceId, 'c.tenant': tenant })
    .orderBy('d.service_period_start').orderBy('d.service_period_end').orderBy('d.item_detail_id')
    .select('d.item_id', 'd.service_period_start', 'd.service_period_end', 'f.allocated_amount') as Array<{
      item_id: string; service_period_start: unknown; service_period_end: unknown; allocated_amount: unknown;
    }>;
  const allocationsByItem = new Map<string, NonNullable<InvoiceAdjustmentCharge['period_allocations']>>();
  for (const detail of detailRows) {
    if (detail.allocated_amount == null) continue;
    const start = toDateOnly(detail.service_period_start);
    const inclusiveEnd = toDateOnly(detail.service_period_end);
    const parts = allocationsByItem.get(detail.item_id) ?? [];
    parts.push({ net_amount: Number(detail.allocated_amount), service_periods: start && inclusiveEnd
      ? [{ start, end: Temporal.PlainDate.from(inclusiveEnd).add({ days: 1 }).toString() }] : [] });
    allocationsByItem.set(detail.item_id, parts);
  }
  const periodsByItem = new Map<string, Array<{ start: string; end: string }>>();
  for (const detail of detailRows) {
    const start = toDateOnly(detail.service_period_start);
    const inclusiveEnd = toDateOnly(detail.service_period_end);
    if (!start || !inclusiveEnd) continue;
    const periods = periodsByItem.get(detail.item_id) ?? [];
    periods.push({ start, end: Temporal.PlainDate.from(inclusiveEnd).add({ days: 1 }).toString() });
    periodsByItem.set(detail.item_id, periods);
  }
  return rows.map((row) => {
    const lineIds = lineIdsByCharge.get(row.item_id) ?? new Set<string>();
    const metadata = typeof row.manual_line_metadata === 'string'
      ? (() => { try { return JSON.parse(row.manual_line_metadata as string); } catch { return {}; } })()
      : row.manual_line_metadata;
    const partial = metadata && typeof metadata === 'object' ? (metadata as any).partialPeriod : null;
    if (typeof partial?.contract_line_id === 'string') lineIds.add(partial.contract_line_id);
    const start = toDateOnly(row.adjustment_period_start);
    const end = toDateOnly(row.adjustment_period_end);
    const sourcePeriod = row.adjustment_source_kind === 'contract_change' && start && end ? [{ start, end }] : [];
    return { ...row, period_allocations: allocationsByItem.get(row.item_id), contract_line_ids: [...lineIds], service_periods: sourcePeriod.length ? sourcePeriod : (periodsByItem.get(row.item_id) ?? []) };
  });
}

function resolveDiscountScope(row: Record<string, unknown>): DiscountScope {
  const scope = row.scope;
  if (scope === 'contract' || scope === 'line' || scope === 'service' || scope === 'item' || scope === 'invoice') {
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
    const sourceId = String(row.source_identity ?? row.discount_id);
    if (policies.has(sourceId)) continue;
    // The attachment makes this definition applicable to a represented
    // client-contract assignment and supplies its stable settlement identity.
    // It does not narrow the configured calculation base: invoice scope must
    // still include eligible unattributed manual charges, while contract scope
    // is enforced by the shared evaluator against client_contract_id.
    const scope = resolveDiscountScope(row);
    policies.set(sourceId, {
      // Assignment identity is distinct from the shared definition identity:
      // one definition can settle once for each represented client contract.
      discount_id: sourceId,
      discount_name: row.discount_name,
      discount_type: row.discount_type,
      value: storedDiscountValueToPolicyValue(row.discount_type, row.value),
      scope,
      applies_to_service_id: row.scope === 'service' ? (row.scope_service_id ?? null) : null,
      contract_line_id: scope === 'line' ? (row.contract_line_id ?? null) : null,
      applies_to_item_id: scope === 'item' ? (row.applies_to_item_id ?? null) : null,
      client_contract_id: row.assignment_client_contract_id
        ?? (row.scope != null ? row.client_contract_id ?? null : null),
      priority: row.priority ?? null,
      // Explicitly scoped policies honor their configured active window at
      // charge level. Old unversioned rows retain their historical invoice-wide
      // behavior for compatibility.
      effective_period: row.scope != null && (row.start_date != null || row.end_date != null)
        ? {
          start: toDateOnly(row.start_date) ?? '0001-01-01',
          end: toDateOnly(row.end_date) ?? '9999-12-31',
        }
        : null,
    });
  }
  return [...policies.values()];
}

/**
 * Concrete contract lines represented on this invoice.
 *
 * The canonical signal is a charge detail's service-config link
 * (`invoice_charge_details.config_id -> contract_line_service_configuration.contract_line_id`).
 * A contract that has a concrete detail line on the invoice contributes only
 * those lines, so a discount on a sibling line that is absent from the invoice
 * cannot apply.
 *
 * When a represented client-contract assignment has no detail link at all (for
 * example a legacy charge persisted without details) the invoice cannot say
 * which of that contract's lines it covers, so its whole line set is admitted:
 * this is the documented contract-wide fallback, not an implicit narrowing.
 */
async function loadRepresentedContractLineIds(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
  invoice: InvoiceForSettlement,
): Promise<string[]> {
  const detailRows = await tenantDb(conn, tenant)
    .table('invoice_charge_details as d')
    .join('invoice_charges as c', function () {
      this.on('c.item_id', '=', 'd.item_id').andOn('c.tenant', '=', 'd.tenant');
    })
    .join('contract_line_service_configuration as cfg', function () {
      this.on('cfg.config_id', '=', 'd.config_id').andOn('cfg.tenant', '=', 'd.tenant');
    })
    .join('contract_lines as cl', function () {
      this.on('cl.contract_line_id', '=', 'cfg.contract_line_id').andOn('cl.tenant', '=', 'cfg.tenant');
    })
    .where({ 'c.invoice_id': invoiceId, 'c.tenant': tenant })
    .whereNotNull('d.config_id')
    .distinct('cl.contract_line_id', 'cl.contract_id');

  const contractLineIds = new Set<string>();
  const contractsWithDetailLines = new Set<string>();
  for (const row of detailRows as Array<{ contract_line_id: string | null; contract_id: string | null }>) {
    if (row.contract_line_id) contractLineIds.add(row.contract_line_id);
    if (row.contract_id) contractsWithDetailLines.add(row.contract_id);
  }

  const assignmentIds = new Set<string>();
  const chargeRows = await tenantScopedTable<{ client_contract_id: string | null }>(
    conn,
    tenant,
    'invoice_charges',
  )
    .where({ invoice_id: invoiceId, tenant })
    .whereNotNull('client_contract_id')
    .distinct('client_contract_id');
  for (const row of chargeRows) {
    if (row.client_contract_id) assignmentIds.add(row.client_contract_id);
  }
  if (invoice.client_contract_id) assignmentIds.add(invoice.client_contract_id);

  if (assignmentIds.size > 0) {
    const assignments = await tenantScopedTable<{ contract_id: string | null }>(
      conn,
      tenant,
      'client_contracts',
    )
      .where({ tenant })
      .whereIn('client_contract_id', [...assignmentIds])
      .select('contract_id');

    const fallbackContractIds = new Set<string>();
    for (const assignment of assignments) {
      if (assignment.contract_id && !contractsWithDetailLines.has(assignment.contract_id)) {
        fallbackContractIds.add(assignment.contract_id);
      }
    }

    if (fallbackContractIds.size > 0) {
      const fallbackLines = await tenantScopedTable<{ contract_line_id: string | null }>(
        conn,
        tenant,
        'contract_lines',
      )
        .where({ tenant })
        .whereIn('contract_id', [...fallbackContractIds])
        .select('contract_line_id');
      for (const line of fallbackLines) {
        if (line.contract_line_id) contractLineIds.add(line.contract_line_id);
      }
    }
  }

  return [...contractLineIds];
}

async function loadApplicableDiscountRows(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  window: AdjustmentWindow,
  representedContractLineIds: string[],
  representedClientContractIds: string[],
): Promise<Array<Record<string, any>>> {
  const db = tenantDb(conn, tenant);
  const lineRows = representedContractLineIds.length === 0 ? [] : await db.table('discounts')
    .join('contract_line_discounts as cld', function () {
      this.on('discounts.discount_id', '=', 'cld.discount_id').andOn('discounts.tenant', '=', 'cld.tenant');
    })
    .join('contract_lines as cl', function () {
      this.on('cl.contract_line_id', '=', 'cld.contract_line_id').andOn('cl.tenant', '=', 'cld.tenant');
    })
    .join('client_contracts as cc', function () {
      this.on('cc.client_contract_id', '=', 'cld.client_contract_id').andOn('cc.tenant', '=', 'cld.tenant');
    })
    .where({
      'cc.client_id': clientId,
      'cc.tenant': tenant,
      'discounts.is_active': true,
    })
    // Eligibility is line-level: a discount linked to a line of a represented
    // contract that has no charge on this invoice must not apply.
    .whereIn('cld.contract_line_id', representedContractLineIds)
    .whereIn('cc.client_contract_id', representedClientContractIds)
    // Both windows are half-open: [discount start, end) intersects
    // [invoice start, end) only when start < window.end and end > window.start.
    .andWhere('discounts.start_date', '<', window.end)
    .andWhere(function (this: Knex.QueryBuilder) {
      this.whereNull('discounts.end_date').orWhere('discounts.end_date', '>', window.start);
    })
    .select('discounts.*', 'cc.client_contract_id', 'cld.contract_line_id');

  // Contract assignments are eligible from billed charges attributed to that
  // client-contract, independent of contract lines/details. Their assignment
  // UUID is the settlement source key for this independent client-contract copy.
  const assignmentQuery = db.table('contract_discount_assignments as a');
  db.tenantJoin(assignmentQuery, 'discounts as d', 'd.discount_id', 'a.discount_id');
  db.tenantJoin(assignmentQuery, 'client_contracts as cc', 'cc.client_contract_id', 'a.client_contract_id');
  const assignmentRows = representedClientContractIds.length === 0 ? [] : await assignmentQuery
    .where('cc.client_id', clientId)
    .whereIn('cc.client_contract_id', representedClientContractIds)
    .where('d.is_active', true)
    .where('d.start_date', '<', window.end)
    .andWhere(function (this: Knex.QueryBuilder) {
      this.whereNull('d.end_date').orWhere('d.end_date', '>', window.start);
    })
    .select(
      'd.discount_id', 'd.discount_name', 'd.discount_type', 'd.value', 'd.start_date', 'd.end_date',
      'd.scope', 'd.scope_service_id', 'd.applies_to_item_id', 'd.priority',
      'a.assignment_id as source_identity', 'cc.client_contract_id as assignment_client_contract_id',
    );
  return [...lineRows, ...assignmentRows];
}

/** Read-only preview using the same configured policies and evaluator as settlement. */
export async function previewAutomaticInvoiceDiscounts(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  charges: IBillingCharge[],
  invoiceDate: string,
) {
  const configIds = [...new Set(charges.map((charge) => charge.config_id).filter((id): id is string => Boolean(id)))];
  const configs = configIds.length === 0 ? [] : await tenantDb(conn, tenant)
    .table('contract_line_service_configuration')
    .whereIn('config_id', configIds)
    .select('config_id', 'contract_line_id');
  const configLineIds = new Map<string, string>(configs.map((row) => [row.config_id, row.contract_line_id]));
  const fixedParents = new Map<string, InvoiceAdjustmentCharge>();
  const inputs: InvoiceAdjustmentCharge[] = [];
  // Line id each charge's discount allocation resolves to (fixed parents merge).
  const chargeItemIds: string[] = [];
  charges.forEach((charge, index) => {
    chargeItemIds[index] = `preview-charge-${index}`;
    const lineId = (charge.config_id && configLineIds.get(charge.config_id)) || charge.client_contract_line_id;
    const servicePeriods = charge.contractChangeAdjustment
      ? (() => {
        const start = toDateOnly(charge.contractChangeAdjustment.periodStart);
        const end = toDateOnly(charge.contractChangeAdjustment.periodEnd);
        return start && end ? [{ start, end }] : [];
      })()
      : (charge.recurringDetailPeriods?.length ? charge.recurringDetailPeriods : [charge]).flatMap((period) => {
        const start = toDateOnly(period.servicePeriodStart);
        const inclusiveEnd = toDateOnly(period.servicePeriodEnd);
        return start && inclusiveEnd ? [{ start, end: Temporal.PlainDate.from(inclusiveEnd).add({ days: 1 }).toString() }] : [];
      });
    const input: InvoiceAdjustmentCharge = {
      item_id: `preview-charge-${index}`,
      service_id: charge.serviceId,
      client_contract_id: charge.client_contract_id,
      contract_line_ids: lineId ? [lineId] : [],
      description: charge.serviceName,
      quantity: charge.quantity ?? 1,
      unit_price: charge.rate,
      net_amount: charge.total,
      is_manual: false,
      is_taxable: charge.is_taxable,
      adjustment_source_kind: charge.contractChangeAdjustment ? 'contract_change' : null,
      service_periods: servicePeriods,
    };
    // persistFixedInvoiceCharges consolidates recurring fixed allocations into
    // one serviceless parent per assignment + line. Match that discount base,
    // including rounding/stacking and service scopes, before evaluating it.
    if (charge.type === 'fixed' && !charge.contractChangeAdjustment && lineId
      && (charge.config_id || charge.servicePeriodStart || charge.servicePeriodEnd || charge.billingTiming)) {
      const key = `${charge.client_contract_id ?? '__no_assignment__'}:${lineId}`;
      const amount = Number((charge as IFixedPriceCharge).allocated_amount ?? charge.total);
      const parent = fixedParents.get(key);
      if (parent) {
        parent.period_allocations!.push({ net_amount: amount, service_periods: servicePeriods });
        chargeItemIds[index] = parent.item_id;
        parent.net_amount += amount;
        parent.unit_price = parent.net_amount;
        parent.is_taxable ||= input.is_taxable;
        const periods = new Map((parent.service_periods ?? []).map((period) => [`${period.start}:${period.end}`, period]));
        for (const period of input.service_periods ?? []) periods.set(`${period.start}:${period.end}`, period);
        parent.service_periods = [...periods.values()];
        return;
      }
      Object.assign(input, { service_id: null, quantity: 1, unit_price: amount, net_amount: amount,
        period_allocations: [{ net_amount: amount, service_periods: servicePeriods }] });
      fixedParents.set(key, input);
    }
    inputs.push(input);
  });
  // Match persisted detail windows (inclusive ends). True-ups have their own
  // provenance period and do not create canonical recurring detail coverage.
  const periods = charges.flatMap((charge) => {
    if (charge.contractChangeAdjustment) {
      const start = toDateOnly(charge.contractChangeAdjustment.periodStart);
      const endExclusive = toDateOnly(charge.contractChangeAdjustment.periodEnd);
      return start && endExclusive ? [{ start, endExclusive }] : [];
    }
    return (charge.recurringDetailPeriods?.length ? charge.recurringDetailPeriods : [charge]).flatMap((period) => {
      const start = toDateOnly(period.servicePeriodStart);
      const endInclusive = toDateOnly(period.servicePeriodEnd);
      if (!start || !endInclusive) return [];
      return [{ start, endExclusive: Temporal.PlainDate.from(endInclusive).add({ days: 1 }).toString() }];
    });
  });
  const starts = periods.map((period) => period.start).sort();
  const ends = periods.map((period) => period.endExclusive).sort();
  const window = starts.length && ends.length
    ? { start: starts[0], end: ends[ends.length - 1] }
    : { start: invoiceDate, end: Temporal.PlainDate.from(invoiceDate).add({ days: 1 }).toString() };
  const rows = await loadApplicableDiscountRows(
    conn, tenant, clientId, window,
    [...new Set(inputs.flatMap((charge) => charge.contract_line_ids ?? []))],
    [...new Set(charges.map((charge) => charge.client_contract_id).filter((id): id is string => Boolean(id)))],
  );
  const ordinaryPeriods = inputs.filter((charge) => charge.adjustment_source_kind !== 'contract_change')
    .flatMap((charge) => charge.service_periods ?? []);
  const fallbackPeriods = ordinaryPeriods.length ? ordinaryPeriods
    : [{ start: invoiceDate, end: Temporal.PlainDate.from(invoiceDate).add({ days: 1 }).toString() }];
  for (const input of inputs) {
    if (input.adjustment_source_kind === 'contract_change') continue;
    if (!input.service_periods?.length) input.service_periods = fallbackPeriods;
    for (const part of input.period_allocations ?? []) {
      if (!part.service_periods.length) part.service_periods = fallbackPeriods;
    }
  }
  return {
    ...evaluateContractInvoiceAdjustments({ charges: inputs, automaticDiscounts: buildAutomaticDiscountPolicies(rows) }),
    chargeItemIds,
  };
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
  clientContractId?: string | null;
}

interface LegacyAutomaticDiscountRow {
  item_id: string;
  description: string | null;
}

/**
 * Automatic discounts persisted before adjustment provenance existed. The
 * legacy generation path wrote `is_discount = true, is_manual = false` rows with
 * no source link, so reconciliation cannot match them by `(source kind, source
 * id)` and would otherwise append a second settlement next to them. Authored
 * manual discounts/credits (`is_manual = true`) are never candidates.
 */
async function loadLegacyAutomaticDiscountRows(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<LegacyAutomaticDiscountRow[]> {
  return tenantScopedTable<LegacyAutomaticDiscountRow>(conn, tenant, 'invoice_charges')
    .where({ invoice_id: invoiceId, tenant, is_discount: true, is_manual: false })
    .whereNull('adjustment_source_kind')
    .select('item_id', 'description')
    .orderBy('created_at', 'asc')
    .orderBy('item_id', 'asc');
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

  // Adopt a legacy automatic discount in place instead of inserting a duplicate.
  // The only stable signal a pre-provenance row carries is its description, which
  // the legacy generation path set to the configured discount name. A row can be
  // claimed at most once, and matching is deterministic by `created_at`/`item_id`.
  // Loaded even when there is nothing desired: this reconcile owns automatic
  // discounts for the invoice, so a legacy row whose source was deactivated or
  // became ineligible must be removed just like a stale source-linked row.
  const legacyRows = await loadLegacyAutomaticDiscountRows(tx, tenant, invoiceId);
  const legacyByDescription = new Map<string, LegacyAutomaticDiscountRow[]>();
  for (const legacy of legacyRows) {
    const key = (legacy.description ?? '').trim();
    const queue = legacyByDescription.get(key) ?? [];
    queue.push(legacy);
    legacyByDescription.set(key, queue);
  }
  const adoptedLegacyItemIds = new Set<string>();
  for (const row of desired) {
    if (existingBySource.has(row.sourceId)) continue;
    const match = legacyByDescription.get(row.description.trim())?.shift();
    if (!match) continue;
    existingBySource.set(row.sourceId, { item_id: match.item_id, adjustment_source_id: row.sourceId });
    adoptedLegacyItemIds.add(match.item_id);
  }

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
      client_contract_id: row.clientContractId ?? null,
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

  // Remove any legacy automatic row this reconcile did not adopt, mirroring the
  // stale source-linked removal above: it was superseded by a source-linked
  // settlement, its source was deactivated, or it is no longer eligible. Leaving
  // it would double the discount, or leave a discount the current configuration
  // no longer grants. The `whereNull` guard makes adoption doubly safe even if
  // the claim set were ever wrong.
  for (const legacy of legacyRows) {
    if (adoptedLegacyItemIds.has(legacy.item_id)) continue;
    await tenantScopedTable(tx, tenant, 'invoice_charges')
      .where({ item_id: legacy.item_id, invoice_id: invoiceId, tenant, is_discount: true, is_manual: false })
      .whereNull('adjustment_source_kind')
      .delete();
  }

  return desired.reduce((sum, row) => sum + row.netAmount, 0);
}

interface InvoiceForSettlement {
  status: string;
  finalized_at?: unknown;
  is_manual: boolean;
  client_id: string;
  client_contract_id?: string | null;
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
  if (!invoice || invoice.status !== 'draft' || invoice.finalized_at) return 0;

  const charges = await loadInvoiceCharges(tx, tenant, invoiceId);
  const provenance = charges.filter((charge) => charge.adjustment_source_kind === 'discount');
  const contractOrigin = !invoice.is_manual;
  if (provenance.length === 0 && !contractOrigin) return 0;

  const window = await loadInvoiceServiceWindow(tx, tenant, invoiceId, invoice);
  const representedContractLineIds = await loadRepresentedContractLineIds(tx, tenant, invoiceId, invoice);
  const discountRows = await loadApplicableDiscountRows(
    tx,
    tenant,
    invoice.client_id,
    window,
    representedContractLineIds,
    [...new Set(charges.map((charge) => charge.client_contract_id).filter((id): id is string => Boolean(id)))],
  );
  const policies = buildAutomaticDiscountPolicies(discountRows);
  const ordinaryCoverage = charges
    .filter((charge) => charge.adjustment_source_kind !== 'contract_change')
    .flatMap((charge) => charge.service_periods ?? []);
  const hasCarriedAdjustment = charges.some((charge) => charge.adjustment_source_kind === 'contract_change');
  const invoiceDate = toDateOnly(invoice.invoice_date);
  const invoiceDateCoverage = invoiceDate
    ? [{ start: invoiceDate, end: Temporal.PlainDate.from(invoiceDate).add({ days: 1 }).toString() }]
    : [window];
  // If an invoice carries a true-up but a regular charge has no detail period,
  // do not let the expanded min/max window imply that the charge covers the
  // true-up's old period. The invoice date is the narrowest defensible fallback.
  const fallbackOrdinaryPeriods = ordinaryCoverage.length
    ? ordinaryCoverage
    : hasCarriedAdjustment ? invoiceDateCoverage : [window];
  const result = evaluateContractInvoiceAdjustments({
    charges: toAdjustmentCharges(charges, fallbackOrdinaryPeriods),
    automaticDiscounts: policies,
  });

  const desired: DesiredSettlementRow[] = result.discounts.map((discount) => ({
    sourceId: discount.discount_id,
    description: discount.discount_name,
    netAmount: -discount.amount,
    // The editor renders this reason for read-only automatic rows; carrying the
    // affected period and eligible base makes the settlement auditable without
    // re-deriving it from the source configuration.
    reason: `Automatic discount: ${discount.discount_name} (${discount.scope} scope, base ${discount.base_amount}, period ${window.start} to ${window.end})`,
    periodStart: window.start,
    periodEnd: window.end,
    isDiscount: true,
    discountType: discount.discount_type,
    discountValue: discount.value,
    scope: discount.scope,
    baseAmount: discount.base_amount,
    // Exact per-charge split resolved by the evaluator. Tax uses it to lower
    // only the taxable base of the lines this discount actually applied to.
    metadata: {
      allocations: discount.allocations.map((allocation) => ({
        itemId: allocation.item_id,
        amount: allocation.amount,
      })),
    },
    clientContractId: policies.find((policy) => policy.discount_id === discount.discount_id)?.client_contract_id ?? null,
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

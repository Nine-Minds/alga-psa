import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { isQuoteItemIncluded } from '../lib/quoteItemInclusion';
import { allocateIncludedQuoteDiscounts, computeQuoteTotals, rowGrossAmount } from '@alga-psa/core';

interface QuoteCalculationContext {
  quote_id: string;
  client_id?: string | null;
  quote_date?: string | null;
  currency_code?: string | null;
  tax_source?: 'internal' | 'external' | 'pending_external' | null;
}

interface QuoteItemRow {
  quote_item_id: string;
  service_id?: string | null;
  quantity: number | string;
  unit_price: number | string;
  is_discount?: boolean | null;
  discount_type?: 'percentage' | 'fixed' | null;
  discount_percentage?: number | string | null;
  applies_to_item_id?: string | null;
  applies_to_service_id?: string | null;
  is_optional?: boolean | null;
  is_selected?: boolean | null;
  is_recurring?: boolean | null;
  billing_frequency?: string | null;
  is_taxable?: boolean | null;
  tax_region?: string | null;
  tax_rate?: number | string | null;
  total_price?: number | string | null;
  net_amount?: number | string | null;
  tax_amount?: number | string | null;
  location_id?: string | null;
}

interface TaxRateThresholdRow {
  tax_rate_id: string;
  min_amount: number | string;
  max_amount?: number | string | null;
  rate: number | string;
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function toQuoteDate(value?: string | null): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function resolveQuoteDiscounts(
  items: QuoteItemRow[]
): { byItemId: Map<string, number>; shareByBaseId: Map<string, number>; totalDiscount: number } {
  const allocation = allocateIncludedQuoteDiscounts(items, (item) => item.quote_item_id);
  const byItemId = new Map<string, number>();
  // Discount reduction each base row absorbed (taxable and exempt rows alike).
  // Tax is computed on the row's amount minus this share: a seller-funded
  // discount lowers the taxable base of the lines it applies to.
  const shareByBaseId = new Map<string, number>();
  for (const result of allocation.discounts) {
    byItemId.set(result.discountId, result.resolvedAmount);
    for (const line of result.allocations) {
      shareByBaseId.set(line.baseItemId, (shareByBaseId.get(line.baseItemId) ?? 0) + line.amount);
    }
  }

  return { byItemId, shareByBaseId, totalDiscount: allocation.totalDiscount };
}

function isDateApplicable(row: { start_date?: string | Date | null; end_date?: string | Date | null }, date: string): boolean {
  const currentDate = new Date(date);
  if (row.start_date && new Date(row.start_date) > currentDate) return false;
  if (row.end_date && new Date(row.end_date) < currentDate) return false;
  return true;
}

function calculateThresholdBasedTax(
  thresholds: Array<{ min_amount: number | string; max_amount?: number | string | null; rate: number | string }>,
  netAmount: number
): { taxAmount: number; taxRate: number } {
  let taxAmount = 0;
  let remainingAmount = netAmount;

  for (const threshold of thresholds) {
    if (remainingAmount <= 0) break;

    const minAmount = toNumber(threshold.min_amount);
    const maxAmount = threshold.max_amount == null ? null : toNumber(threshold.max_amount);
    const taxableAmount = maxAmount == null
      ? remainingAmount
      : Math.min(remainingAmount, Math.max(maxAmount - minAmount, 0));

    taxAmount += Math.ceil((taxableAmount * toNumber(threshold.rate)) / 100);
    remainingAmount -= taxableAmount;
  }

  return {
    taxAmount,
    taxRate: netAmount > 0 ? (taxAmount / netAmount) * 100 : 0,
  };
}

async function getApplicableTaxHoliday(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
  date: string
): Promise<Record<string, unknown> | undefined> {
  const currentDate = new Date(date);
  const holidays = await tenantDb(knexOrTrx, tenant).parentScopedTable('tax_holidays')
    .where({ tax_rate_id: taxRateId })
    .orderBy('start_date');

  return holidays.find((holiday) =>
    new Date(holiday.start_date) <= currentDate && new Date(holiday.end_date) >= currentDate
  );
}

async function calculateComponentTax(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  component: Record<string, unknown>,
  amount: number,
  date: string
): Promise<number> {
  const holiday = await getApplicableTaxHoliday(knexOrTrx, tenant, String(component.tax_rate_id), date);
  if (holiday) return 0;
  return Math.ceil((amount * toNumber(component.rate)) / 100);
}

async function calculateTaxWithConnection(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  netAmount: number,
  date: string,
  regionCode: string | undefined,
  isTaxable: boolean,
  currencyCode?: string | null
): Promise<{ taxAmount: number; taxRate: number }> {
  const db = tenantDb(knexOrTrx, tenant);
  const client = await db.table('clients')
    .where({ client_id: clientId })
    .select('is_tax_exempt')
    .first();

  if (!client) {
    throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
  }

  if (client.is_tax_exempt || !isTaxable) {
    return { taxAmount: 0, taxRate: 0 };
  }

  const taxSettings = await db.table('client_tax_settings')
    .where({ client_id: clientId })
    .select('is_reverse_charge_applicable')
    .first();
  if (taxSettings?.is_reverse_charge_applicable) {
    return { taxAmount: 0, taxRate: 0 };
  }

  if (regionCode) {
    const applicableRates = await db.table('tax_rates')
      .where({ region_code: regionCode, is_active: true })
      .andWhere('start_date', '<=', date)
      .andWhere(function dateRange() {
        this.whereNull('end_date').orWhere('end_date', '>', date);
      })
      .andWhere(function currencyRange() {
        this.whereNull('currency_code');
        if (currencyCode) this.orWhere('currency_code', currencyCode);
      })
      .select('tax_percentage');

    const combinedTaxRate = applicableRates.reduce((sum, rate) => sum + toNumber(rate.tax_percentage), 0);
    return {
      taxAmount: netAmount > 0 ? Math.ceil((netAmount * combinedTaxRate) / 100) : 0,
      taxRate: combinedTaxRate,
    };
  }

  const defaultRateAssoc = await db.table('client_tax_rates')
    .where({ client_id: clientId, is_default: true })
    .whereNull('location_id')
    .select('tax_rate_id')
    .first();

  if (!defaultRateAssoc) {
    return { taxAmount: 0, taxRate: 0 };
  }

  const taxRate = await db.table('tax_rates')
    .where({ tax_rate_id: defaultRateAssoc.tax_rate_id, is_active: true })
    .andWhere('start_date', '<=', date)
    .andWhere(function dateRange() {
      this.whereNull('end_date').orWhere('end_date', '>', date);
    })
    .andWhere(function currencyRange() {
      this.whereNull('currency_code');
      if (currencyCode) this.orWhere('currency_code', currencyCode);
    })
    .first();

  if (!taxRate) {
    return { taxAmount: 0, taxRate: 0 };
  }

  if (taxRate.is_composite) {
    const componentsQuery = db.parentScopedTable<Record<string, unknown>>('composite_tax_mappings as ctm')
      .where('ctm.composite_tax_id', taxRate.tax_rate_id)
      .orderBy('ctm.sequence');
    db.tenantJoin(componentsQuery, 'tax_components as tc', 'ctm.tax_component_id', 'tc.tax_component_id', {
      tenantPredicate: 'literal',
    });
    const components = await componentsQuery.select('tc.*') as Record<string, unknown>[];

    let totalTaxAmount = 0;
    let taxableAmount = netAmount;
    for (const component of components) {
      if (!isDateApplicable(component, date)) continue;
      const componentTax = await calculateComponentTax(knexOrTrx, tenant, component, taxableAmount, date);
      totalTaxAmount += componentTax;
      if (component.is_compound) taxableAmount += componentTax;
    }

    return {
      taxAmount: totalTaxAmount,
      taxRate: netAmount > 0 ? (totalTaxAmount / netAmount) * 100 : 0,
    };
  }

  const thresholds = await db.parentScopedTable<TaxRateThresholdRow>('tax_rate_thresholds')
    .where({ tax_rate_id: taxRate.tax_rate_id })
    .orderBy('min_amount');

  if (thresholds.length > 0) {
    return calculateThresholdBasedTax(thresholds, netAmount);
  }

  if (netAmount <= 0) {
    return { taxAmount: 0, taxRate: toNumber(taxRate.tax_percentage) };
  }

  const taxRatePercentage = toNumber(taxRate.tax_percentage);
  return {
    taxAmount: Math.ceil((netAmount * taxRatePercentage) / 100),
    taxRate: taxRatePercentage,
  };
}

interface ResolvedRowTax {
  /** Tax the row carries when included in the quote (0 for discounts / external tax). */
  taxAmountIfIncluded: number;
  /** Persisted rate, the exact percentage as `quote_items.tax_rate` stores it. */
  taxRate: number;
  /** The exact percentage the engine used, for callers that never persist it. */
  taxPercentage: number;
  taxRegion: string | null;
}

/** Per-row tax inputs the client portal needs to preview a selection locally. */
export interface QuoteItemTaxIfIncluded {
  /** Tax on the row's gross amount, in minor units. */
  taxAmount: number;
  /** Exact percentage behind that amount; 0 when the row carries no internal tax. */
  taxPercentage: number;
}

/**
 * Resolve each base row's tax through the DB-backed tax engine, independent of
 * whether the row is currently included. Shared by the persisted recalculation
 * and by the read-only client-portal preview payload.
 *
 * `discountShareByBaseId` is the reduction each base row absorbed from the
 * included discounts: tax is computed on the discounted base, so a
 * seller-funded discount lowers the taxable amount of the rows it applies to.
 * Discounts only allocate across included bases, so a pending optional row's
 * share is 0 and its "if selected" tax is resolved on its full amount. Pass an
 * empty map for selection-independent, gross-amount tax.
 */
async function resolveQuoteRowTaxes(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: QuoteCalculationContext,
  items: QuoteItemRow[],
  discountAmountById: Map<string, number>,
  discountShareByBaseId: Map<string, number>
): Promise<Map<string, ResolvedRowTax>> {
  const db = tenantDb(knexOrTrx, tenant);
  const client = quote.client_id
    ? await db.table('clients')
        .where({ client_id: quote.client_id })
        .select('region_code')
        .first()
    : null;

  const distinctLocationIds = Array.from(
    new Set(
      items
        .map((item) => item.location_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );
  const locationRegionMap = new Map<string, string | null>();
  if (distinctLocationIds.length > 0) {
    const locationRows = await db.table('client_locations')
      .whereIn('location_id', distinctLocationIds)
      .select('location_id', 'region_code');
    for (const row of locationRows) {
      locationRegionMap.set(
        row.location_id as string,
        (row.region_code as string | null | undefined) ?? null
      );
    }
  }

  const quoteDate = toQuoteDate(quote.quote_date);
  const currencyCode = quote.currency_code ?? 'USD';
  const taxSource = quote.tax_source ?? 'internal';
  const resolved = new Map<string, ResolvedRowTax>();

  for (const item of items) {
    const isDiscount = item.is_discount === true;
    // Preserve manual override: if tax_region was explicitly set on the item, keep it.
    // Otherwise fall back to the item's location.region_code, then to the client default.
    const locationRegionCode = item.location_id
      ? (locationRegionMap.get(item.location_id) ?? null)
      : null;
    const taxRegion = item.tax_region ?? locationRegionCode ?? client?.region_code ?? null;

    const resolvedTotalPrice = isDiscount
      ? (discountAmountById.get(item.quote_item_id) ?? 0)
      : rowGrossAmount(item);

    let taxAmount = 0;
    let taxRate = toNumber(item.tax_rate);
    let taxPercentage = taxRate;

    if (!isDiscount) {
      if (quote.client_id && taxSource === 'internal') {
        // Taxed on the discounted base; a pending optional row absorbs no
        // discount share, so its hypothetical tax uses the full amount.
        const taxableBase = Math.max(
          0,
          resolvedTotalPrice - (discountShareByBaseId.get(item.quote_item_id) ?? 0)
        );
        const taxResult = await calculateTaxWithConnection(
          knexOrTrx,
          tenant,
          quote.client_id,
          taxableBase,
          quoteDate,
          taxRegion ?? undefined,
          item.is_taxable !== false,
          currencyCode
        );

        taxAmount = taxResult.taxAmount;
        taxPercentage = Number(taxResult.taxRate ?? 0);
        // Store the exact percentage: rounding 6.875 to 7 displayed a rate the
        // line was never charged at. `quote_items.tax_rate` is numeric.
        taxRate = taxPercentage;
      } else if (taxSource !== 'internal') {
        taxAmount = 0;
        taxRate = 0;
        taxPercentage = 0;
      }
    }

    resolved.set(item.quote_item_id, { taxAmountIfIncluded: taxAmount, taxRate, taxPercentage, taxRegion });
  }

  return resolved;
}

/**
 * Read-only: the tax each non-discount quote row would carry if it were
 * included, keyed by quote_item_id, with the exact rate behind it. The client
 * portal feeds both to `computeQuoteTotals` for its local optional-item
 * preview: discounts apply before tax, so the preview re-derives the row's tax
 * on the base its own selection leaves. Writes nothing.
 */
export async function resolveQuoteItemTaxesIfIncluded(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<Map<string, QuoteItemTaxIfIncluded>> {
  const db = tenantDb(knexOrTrx, tenant);
  const quote = await db.table('quotes')
    .where({ quote_id: quoteId })
    .first() as QuoteCalculationContext | undefined;
  if (!quote) {
    return new Map();
  }

  const items = await db.table('quote_items')
    .where({ quote_id: quoteId })
    .orderBy('display_order', 'asc')
    .orderBy('created_at', 'asc') as QuoteItemRow[];

  // Gross-amount tax, with no discount share taken off: which share a row
  // absorbs depends on the selection the client is previewing, so
  // `computeQuoteTotals` applies the discount before tax per selection.
  const resolved = await resolveQuoteRowTaxes(knexOrTrx, tenant, quote, items, new Map(), new Map());
  const result = new Map<string, QuoteItemTaxIfIncluded>();
  for (const item of items) {
    if (item.is_discount === true) continue;
    const rowTax = resolved.get(item.quote_item_id);
    result.set(item.quote_item_id, {
      taxAmount: rowTax?.taxAmountIfIncluded ?? 0,
      taxPercentage: rowTax?.taxPercentage ?? 0,
    });
  }
  return result;
}

export async function recalculateQuoteFinancials(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<void> {
  const db = tenantDb(knexOrTrx, tenant);
  const quote = await db.table('quotes')
    .where({ quote_id: quoteId })
    .first() as QuoteCalculationContext | undefined;

  if (!quote) {
    return;
  }

  const items = await db.table('quote_items')
    .where({ quote_id: quoteId })
    .orderBy('display_order', 'asc')
    .orderBy('created_at', 'asc') as QuoteItemRow[];

  // Resolve discount reductions against the eligible base items they target,
  // independent of each discount row's own persisted cadence fields.
  const { byItemId: discountAmountById, shareByBaseId } = resolveQuoteDiscounts(items);

  // Resolved tax per row (DB-backed), then the stored totals through the
  // shared pure derivation the editor, the document view model and the client
  // portal preview use. Included rows (required, or optional and selected)
  // carry a tax_amount and count toward quotes.subtotal/tax/total_amount; a
  // pending optional row keeps its resolved tax_rate (so the presented "if
  // selected" tax can be derived) but persists tax_amount/net_amount 0 and is
  // excluded from the stored totals.
  const rowTaxes = await resolveQuoteRowTaxes(
    knexOrTrx,
    tenant,
    quote,
    items,
    discountAmountById,
    shareByBaseId
  );

  // The tax handed over is already on the discounted base, so passing the exact
  // rate alongside it lets computeQuoteTotals recognise that and take the
  // amounts as they are instead of discounting them twice.
  const totals = computeQuoteTotals(
    items.map((item) => ({
      ...item,
      id: item.quote_item_id,
      taxRateIfIncluded: rowTaxes.get(item.quote_item_id)?.taxPercentage ?? 0,
      taxAmountIfIncluded: rowTaxes.get(item.quote_item_id)?.taxAmountIfIncluded ?? 0,
    }))
  );

  for (const item of items) {
    const isIncludedInTotals = isQuoteItemIncluded(item);
    const isDiscount = item.is_discount === true;
    const rowTax = rowTaxes.get(item.quote_item_id)!;
    const resolvedTotalPrice = isDiscount
      ? (totals.discountAmountById.get(item.quote_item_id) ?? 0)
      : rowGrossAmount(item);

    await db.table('quote_items')
      .where({ quote_item_id: item.quote_item_id })
      .update({
        total_price: resolvedTotalPrice,
        net_amount: isIncludedInTotals ? resolvedTotalPrice : 0,
        tax_amount: isIncludedInTotals ? rowTax.taxAmountIfIncluded : 0,
        tax_region: rowTax.taxRegion,
        tax_rate: rowTax.taxRate,
        updated_at: knexOrTrx.fn.now(),
      });
  }

  await db.table('quotes')
    .where({ quote_id: quoteId })
    .update({
      subtotal: totals.subtotal,
      discount_total: totals.discountTotal,
      tax: totals.tax,
      total_amount: totals.totalAmount,
      updated_at: knexOrTrx.fn.now(),
    });
}

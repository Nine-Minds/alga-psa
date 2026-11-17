import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { calculateTaxForAmount } from '@alga-psa/shared/billingClients/taxEngine';
import { toQuoteTaxDate } from '@alga-psa/shared/billingClients/quoteTaxResolution';

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

function toNumber(value: unknown): number {
  return Number(value ?? 0);
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

interface ResolvedRowTax {
  /** Tax the row carries when included in the quote (0 for discounts / external tax). */
  taxAmountIfIncluded: number;
  /** Persisted rate, the exact percentage as `quote_items.tax_rate` stores it. */
  taxRate: number;
  /** The exact percentage the engine used, for callers that never persist it. */
  taxPercentage: number;
  taxRegion: string | null;
  /** A taxable row whose region has no active rate: tax is 0, not genuinely nil. */
  taxUnresolved: boolean;
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

  const quoteDate = toQuoteTaxDate(quote.quote_date);
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
    let taxUnresolved = false;

    if (!isDiscount) {
      if (quote.client_id && taxSource === 'internal') {
        // Taxed on the discounted base; a pending optional row absorbs no
        // discount share, so its hypothetical tax uses the full amount.
        const taxableBase = Math.max(
          0,
          resolvedTotalPrice - (discountShareByBaseId.get(item.quote_item_id) ?? 0)
        );
        const taxResult = await calculateTaxForAmount(knexOrTrx, tenant, {
          clientId: quote.client_id,
          netAmount: taxableBase,
          date: quoteDate,
          regionCode: taxRegion ?? undefined,
          isTaxable: item.is_taxable !== false,
          currencyCode,
        });

        if (taxResult.resolved) {
          taxAmount = taxResult.taxAmount;
          taxPercentage = Number(taxResult.taxRate ?? 0);
        } else {
          // No active rate for the region: store 0 and flag the row rather
          // than presenting 0 as a calculated tax.
          taxAmount = 0;
          taxPercentage = 0;
          taxUnresolved = true;
        }
        // Store the exact percentage: rounding 6.875 to 7 displayed a rate the
        // line was never charged at. `quote_items.tax_rate` is numeric.
        taxRate = taxPercentage;
      } else if (taxSource !== 'internal') {
        taxAmount = 0;
        taxRate = 0;
        taxPercentage = 0;
      }
    }

    resolved.set(item.quote_item_id, { taxAmountIfIncluded: taxAmount, taxRate, taxPercentage, taxRegion, taxUnresolved });
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
        // Only an included row's unresolved tax matters: it is what the totals
        // and conversion rely on. A pending optional row is re-resolved when selected.
        tax_unresolved: isIncludedInTotals && rowTax.taxUnresolved,
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

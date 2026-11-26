/**
 * Quote row tax, resolved through the one tax engine.
 *
 * Every quote tax figure comes from here: the persisted recalculation, the
 * editor's read-only totals, the client-portal preview, the PDF/preview "if
 * selected" figures, and the conversion-time check that refuses a quote whose
 * included one-time row has no tax rate (billing, REST and workflow worker).
 *
 * Like `taxEngine`, every entry point takes `knexOrTrx` and `tenant`
 * explicitly and writes nothing, so the workflow worker can import it. It must
 * never import session helpers or anything from `packages/billing`.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  allocateIncludedQuoteDiscounts,
  computeQuoteTotals,
  isQuoteItemIncluded,
  rowGrossAmount,
  type ComputeQuoteTotalsResult,
} from '@alga-psa/core';
import { calculateTaxForAmount, noTaxRateMessage } from './taxEngine';
import { toQuoteTaxDate, type UnresolvedQuoteTaxBlocker } from './quoteTaxResolution';

export interface QuoteTaxContext {
  quote_id?: string;
  client_id?: string | null;
  quote_date?: string | Date | null;
  currency_code?: string | null;
  tax_source?: 'internal' | 'external' | 'pending_external' | null;
}

export interface QuoteTaxRow {
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

export interface ResolvedRowTax {
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

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

/** Discount reductions and the share each base row absorbed (tax is on the discounted base). */
export function resolveQuoteDiscounts(
  items: QuoteTaxRow[]
): { byItemId: Map<string, number>; shareByBaseId: Map<string, number>; totalDiscount: number } {
  const allocation = allocateIncludedQuoteDiscounts(items, (item) => item.quote_item_id);
  const byItemId = new Map<string, number>();
  const shareByBaseId = new Map<string, number>();
  for (const result of allocation.discounts) {
    byItemId.set(result.discountId, result.resolvedAmount);
    for (const line of result.allocations) {
      shareByBaseId.set(line.baseItemId, (shareByBaseId.get(line.baseItemId) ?? 0) + line.amount);
    }
  }
  return { byItemId, shareByBaseId, totalDiscount: allocation.totalDiscount };
}

/**
 * Resolve each base row's tax through the DB-backed tax engine, independent of
 * whether the row is currently included.
 *
 * `discountShareByBaseId` is the reduction each base row absorbed from the
 * included discounts: tax is computed on the discounted base. Discounts only
 * allocate across included bases, so a pending optional row's share is 0 and
 * its "if selected" tax is resolved on its full amount. Pass an empty map for
 * selection-independent, gross-amount tax.
 */
export async function resolveQuoteRowTaxes(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: QuoteTaxContext,
  items: QuoteTaxRow[],
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
          // No active rate for the region: 0, flagged rather than presented as a calculated tax.
          taxAmount = 0;
          taxPercentage = 0;
          taxUnresolved = true;
        }
        // Store the exact percentage: `quote_items.tax_rate` is numeric.
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

export interface ResolvedQuoteTaxes {
  rowTaxes: Map<string, ResolvedRowTax>;
  totals: ComputeQuoteTotalsResult;
  discountAmountById: Map<string, number>;
}

/**
 * Rows plus quote, resolved through the engine: discount allocation, per-row
 * tax on the discounted base, and the quote totals derived from them. Writes
 * nothing. The persisted recalculation and the editor's read-only totals both
 * call this, so they cannot disagree.
 */
export async function resolveQuoteTaxes(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: QuoteTaxContext,
  items: QuoteTaxRow[]
): Promise<ResolvedQuoteTaxes> {
  const { byItemId: discountAmountById, shareByBaseId } = resolveQuoteDiscounts(items);
  const rowTaxes = await resolveQuoteRowTaxes(knexOrTrx, tenant, quote, items, discountAmountById, shareByBaseId);

  // The tax handed over is already on the discounted base, so passing the exact
  // rate alongside it lets computeQuoteTotals take the amounts as they are.
  const totals = computeQuoteTotals(
    items.map((item) => ({
      ...item,
      id: item.quote_item_id,
      taxRateIfIncluded: rowTaxes.get(item.quote_item_id)?.taxPercentage ?? 0,
      taxAmountIfIncluded: rowTaxes.get(item.quote_item_id)?.taxAmountIfIncluded ?? 0,
    }))
  );
  return { rowTaxes, totals, discountAmountById };
}

export interface QuoteConversionTax {
  /** Fresh engine tax per quote row; the invoice carries these, not the stored `tax_amount`. */
  rowTaxes: Map<string, ResolvedRowTax>;
  /** The included one-time row that has no active rate, if any. */
  blocker: UnresolvedQuoteTaxBlocker | null;
}

/**
 * Conversion-time resolution, decided from a fresh engine pass over the quote's
 * rows and never from the persisted `tax_unresolved` flag (stale once a rate is
 * added, absent on quotes saved before the flag existed) or the stored
 * `tax_amount`. A blocker is an included, one-time, non-discount row whose
 * taxable region has no active rate. Unselected optional rows and recurring
 * rows never block (the invoice does not carry them). Writes nothing.
 */
export async function resolveQuoteConversionTax(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: QuoteTaxContext,
  items: QuoteTaxRow[]
): Promise<QuoteConversionTax> {
  const { byItemId, shareByBaseId } = resolveQuoteDiscounts(items);
  const rowTaxes = await resolveQuoteRowTaxes(knexOrTrx, tenant, quote, items, byItemId, shareByBaseId);
  const blocked = items.find(
    (item) =>
      !item.is_recurring &&
      !item.is_discount &&
      isQuoteItemIncluded(item) &&
      rowTaxes.get(item.quote_item_id)?.taxUnresolved === true
  );
  if (!blocked) return { rowTaxes, blocker: null };

  const date = toQuoteTaxDate(quote.quote_date);
  const region = rowTaxes.get(blocked.quote_item_id)?.taxRegion ?? '';
  return {
    rowTaxes,
    blocker: { quoteItemId: blocked.quote_item_id, region, date, message: noTaxRateMessage(region, date) },
  };
}

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  resolveQuoteRowTaxes,
  resolveQuoteTaxes,
  type QuoteTaxContext,
  type QuoteTaxRow,
} from '@alga-psa/shared/billingClients/quoteRowTax';

import { getEffectiveTaxSourceForClient } from '@alga-psa/shared/billingClients/taxSettings';
import { isPendingOptional, isQuoteItemIncluded } from '../lib/quoteItemInclusion';
import { rowGrossAmount } from '@alga-psa/core';

type QuoteCalculationContext = QuoteTaxContext & { quote_id: string };
type QuoteItemRow = QuoteTaxRow;

/** Per-row tax inputs the client portal needs to preview a selection locally. */
export interface QuoteItemTaxIfIncluded {
  /** Tax on the row's gross amount, in minor units. */
  taxAmount: number;
  /** Exact percentage behind that amount; 0 when the row carries no internal tax. */
  taxPercentage: number;
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

  return resolveItemTaxesIfIncluded(knexOrTrx, tenant, quote, items);
}

/**
 * The same read-only resolution for rows already in memory (the document view
 * model holds the loaded quote): each non-discount row's engine tax on its
 * gross amount, i.e. what a pending optional row would cost if selected.
 */
export async function resolveItemTaxesIfIncluded(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: QuoteTaxContext,
  items: QuoteItemRow[]
): Promise<Map<string, QuoteItemTaxIfIncluded>> {
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

  // Resolved tax per row and the stored totals, through the shared engine
  // resolution the editor, the document view model and the client portal
  // preview also use. Included rows carry a tax_amount and count toward
  // quotes.subtotal/tax/total_amount; a pending optional row keeps its resolved
  // tax_rate but persists tax_amount/net_amount 0 and is excluded from the totals.
  const { rowTaxes, totals } = await resolveQuoteTaxes(knexOrTrx, tenant, quote, items);

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

/**
 * Brings a quote's stored totals into line with the shared tax engine.
 *
 * The totals on a `sent` quote were written by an earlier engine (or by an edit
 * made before a rate changed), so the figure a client is about to sign can differ
 * from what the engine says today. Recomputes through the same resolution the
 * editor uses; when subtotal, discounts, tax or total differ from what is stored,
 * persists the corrected figures and returns true, so the caller can tell the
 * signer the quote changed. Returns false, writing nothing, when they agree.
 */
export async function reconcileQuoteTotalsWithEngine(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<boolean> {
  const db = tenantDb(knexOrTrx, tenant);
  const quote = await db.table('quotes')
    .where({ quote_id: quoteId })
    .first() as (QuoteCalculationContext & Record<string, unknown>) | undefined;
  if (!quote) return false;

  const items = await db.table('quote_items')
    .where({ quote_id: quoteId })
    .orderBy('display_order', 'asc')
    .orderBy('created_at', 'asc') as QuoteItemRow[];

  const { totals } = await resolveQuoteTaxes(knexOrTrx, tenant, quote, items);
  const stored = {
    subtotal: Number(quote.subtotal ?? 0),
    discountTotal: Number(quote.discount_total ?? 0),
    tax: Number(quote.tax ?? 0),
    totalAmount: Number(quote.total_amount ?? 0),
  };
  if (
    stored.subtotal === totals.subtotal &&
    stored.discountTotal === totals.discountTotal &&
    stored.tax === totals.tax &&
    stored.totalAmount === totals.totalAmount
  ) {
    return false;
  }

  await recalculateQuoteFinancials(knexOrTrx, tenant, quoteId);
  return true;
}

/** A draft line as the editor holds it; `id` is the editor's stable row key. */
export interface QuoteDraftTaxItem extends Omit<QuoteItemRow, 'quote_item_id'> {
  id: string;
}

export interface QuoteDraftTaxInput {
  client_id?: string | null;
  quote_date?: string | null;
  currency_code?: string | null;
  /** When the draft is a saved quote, its own tax source applies. */
  quote_id?: string | null;
  items: QuoteDraftTaxItem[];
}

export interface QuoteDraftRowTax {
  /** Tax the row carries when included (on the discounted base), minor units. */
  taxAmount: number;
  taxPercentage: number;
  taxRegion: string | null;
  /** Taxable row, no active rate for its region: tax is 0 because it could not be worked out. */
  taxUnresolved: boolean;
}

export interface QuoteDraftTaxResult {
  rows: Record<string, QuoteDraftRowTax>;
  totals: {
    subtotal: number;
    discount_total: number;
    tax: number;
    total_amount: number;
    /** Pending optional rows, "if selected": what they would cost if chosen. */
    optional_subtotal: number;
    optional_tax: number;
    optional_total: number;
  };
}

/**
 * Read-only: the engine's per-row tax and quote totals for the editor's draft
 * rows. Same resolution and totals derivation as `recalculateQuoteFinancials`
 * (it calls the same shared resolver), so the editor shows what saving stores.
 * Writes nothing.
 */
export async function resolveQuoteDraftTax(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  input: QuoteDraftTaxInput
): Promise<QuoteDraftTaxResult> {
  const db = tenantDb(knexOrTrx, tenant);
  let taxSource: QuoteCalculationContext['tax_source'] = null;
  if (input.quote_id) {
    const saved = await db.table('quotes').where({ quote_id: input.quote_id }).select('tax_source').first();
    taxSource = (saved?.tax_source as QuoteCalculationContext['tax_source']) ?? null;
  } else if (input.client_id) {
    taxSource = (await getEffectiveTaxSourceForClient(knexOrTrx, tenant, input.client_id)).taxSource;
  }

  const items: QuoteItemRow[] = input.items.map(({ id, ...rest }) => ({ ...rest, quote_item_id: id }));
  const context: QuoteTaxContext = {
    client_id: input.client_id ?? null,
    quote_date: input.quote_date ?? null,
    currency_code: input.currency_code ?? null,
    tax_source: taxSource,
  };
  const { rowTaxes, totals } = await resolveQuoteTaxes(knexOrTrx, tenant, context, items);

  const rows: Record<string, QuoteDraftRowTax> = {};
  for (const item of items) {
    if (item.is_discount === true) continue;
    const rowTax = rowTaxes.get(item.quote_item_id);
    rows[item.quote_item_id] = {
      taxAmount: rowTax?.taxAmountIfIncluded ?? 0,
      taxPercentage: rowTax?.taxPercentage ?? 0,
      taxRegion: rowTax?.taxRegion ?? null,
      taxUnresolved: rowTax?.taxUnresolved === true,
    };
  }

  const pending = items.filter((item) => item.is_discount !== true && isPendingOptional(item));
  const optionalSubtotal = pending.reduce((sum, item) => sum + rowGrossAmount(item), 0);
  const optionalTax = pending.reduce((sum, item) => sum + (rows[item.quote_item_id]?.taxAmount ?? 0), 0);

  return {
    rows,
    totals: {
      subtotal: totals.subtotal,
      discount_total: totals.discountTotal,
      tax: totals.tax,
      total_amount: totals.totalAmount,
      optional_subtotal: optionalSubtotal,
      optional_tax: optionalTax,
      optional_total: optionalSubtotal + optionalTax,
    },
  };
}

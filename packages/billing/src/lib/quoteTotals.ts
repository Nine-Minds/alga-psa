/**
 * One derivation of a quote's money figures from its rows.
 *
 * The persisted recalculation, the document view model (PDF), the editor
 * draft and quote conversion all previously built their own discount
 * allocation inputs and summed their own totals, and they drifted: the editor
 * and the PDF showed a required-only base while the stored total (quote list,
 * client portal) and conversion counted selected add-ons. This module is the
 * single place that turns rows into allocation inputs and into the presented
 * totals, on top of the shared inclusion rule in `quoteItemInclusion`.
 *
 * Definitions (all amounts in minor units):
 *
 * - `subtotal`      = Σ price of **included** base rows (required rows and
 *                     selected optional rows).
 * - `discount_total`= Σ resolved discount allocations. Discounts allocate only
 *                     across included bases, so a pending add-on never absorbs
 *                     a discount until it is selected.
 * - `tax`           = Σ tax of included base rows.
 * - `total_amount`  = subtotal − discount_total + tax. This is the number the
 *                     quote list, the editor, the PDF, the portal and the
 *                     converted contract/invoice all agree on.
 * - `optional_*`    = the **pending** (unselected optional) add-ons: price plus
 *                     the tax each would carry if selected. Presented as
 *                     "Optional if selected"; never part of `total_amount`.
 */
import {
  allocateQuoteDiscounts,
  type DiscountBaseItemInput,
  type QuoteDiscountAllocation,
  type QuoteDiscountInput,
} from '../services/quoteDiscountAllocation';
import { isPendingOptional, isQuoteItemIncluded, type QuoteItemInclusionInput } from './quoteItemInclusion';

export type QuoteTotalsRowInput = QuoteItemInclusionInput & {
  service_id?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  is_recurring?: boolean | null;
  is_discount?: boolean | null;
  discount_type?: 'percentage' | 'fixed' | string | null;
  discount_percentage?: number | string | null;
  applies_to_item_id?: string | null;
  applies_to_service_id?: string | null;
};

export interface QuoteTotalsSummary {
  subtotal: number;
  discount_total: number;
  tax: number;
  total_amount: number;
  optional_subtotal: number;
  optional_tax: number;
  optional_total: number;
}

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** `quantity × unit_price` of a row in minor units (as persisted in `total_price`). */
export const rowGrossAmount = (item: Pick<QuoteTotalsRowInput, 'quantity' | 'unit_price'>): number =>
  toFiniteNumber(item.quantity) * toFiniteNumber(item.unit_price);

/**
 * Allocation inputs for `allocateQuoteDiscounts`: included base rows and
 * included discount rows. `idOf` supplies the row key (persisted rows use
 * `quote_item_id`; editor drafts fall back to their local id).
 */
export function buildQuoteDiscountAllocationInputs<T extends QuoteTotalsRowInput>(
  items: T[],
  idOf: (item: T) => string,
): { bases: DiscountBaseItemInput[]; discounts: QuoteDiscountInput[] } {
  const bases = items
    .filter((item) => !item.is_discount && isQuoteItemIncluded(item))
    .map((item) => ({
      id: idOf(item),
      serviceId: item.service_id ?? null,
      amount: rowGrossAmount(item),
      isRecurring: item.is_recurring === true,
    }));

  const discounts = items
    .filter((item) => item.is_discount === true && isQuoteItemIncluded(item))
    .map((item) => ({
      id: idOf(item),
      discountType: (item.discount_type === 'percentage' ? 'percentage' : 'fixed') as 'percentage' | 'fixed',
      fixedAmount: Math.abs(toFiniteNumber(item.quantity || 1) * toFiniteNumber(item.unit_price)),
      discountPercentage: toFiniteNumber(item.discount_percentage),
      appliesToItemId: item.applies_to_item_id ?? null,
      appliesToServiceId: item.applies_to_service_id ?? null,
    }));

  return { bases, discounts };
}

/** Resolve every included discount across the included bases. */
export function allocateIncludedQuoteDiscounts<T extends QuoteTotalsRowInput>(
  items: T[],
  idOf: (item: T) => string,
): QuoteDiscountAllocation {
  const { bases, discounts } = buildQuoteDiscountAllocationInputs(items, idOf);
  return allocateQuoteDiscounts(bases, discounts);
}

/**
 * The presented totals of a quote. `amountOf`/`taxOf` read a base row's price
 * and tax (persisted `tax_amount` for included rows; the hypothetical tax for
 * pending add-ons — see `quoteItemTax`).
 */
export function summarizeQuoteTotals<T extends QuoteItemInclusionInput & { is_discount?: boolean | null }>(
  items: T[],
  options: {
    amountOf: (item: T) => number;
    taxOf: (item: T) => number;
    discountTotal: number;
  },
): QuoteTotalsSummary {
  const bases = items.filter((item) => !item.is_discount);
  const included = bases.filter((item) => isQuoteItemIncluded(item));
  const pending = bases.filter((item) => isPendingOptional(item));

  const subtotal = included.reduce((sum, item) => sum + options.amountOf(item), 0);
  const tax = included.reduce((sum, item) => sum + options.taxOf(item), 0);
  const optionalSubtotal = pending.reduce((sum, item) => sum + options.amountOf(item), 0);
  const optionalTax = pending.reduce((sum, item) => sum + options.taxOf(item), 0);
  const discountTotal = Math.max(0, Math.round(options.discountTotal));

  return {
    subtotal,
    discount_total: discountTotal,
    tax,
    total_amount: subtotal - discountTotal + tax,
    optional_subtotal: optionalSubtotal,
    optional_tax: optionalTax,
    optional_total: optionalSubtotal + optionalTax,
  };
}

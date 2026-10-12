/**
 * Presented tax for a quote line, independent of persisted inclusion.
 *
 * `recalculateQuoteFinancials` persists `tax_amount = 0` for rows the legacy
 * inclusion rule leaves out of the stored totals (optional rows that are not
 * selected) while still persisting the row's resolved `tax_rate`. The
 * "Optional (if selected)" figures in the editor and on the PDF must quote
 * what the row *would* cost if selected, so they cannot reuse that zero.
 *
 * - `hypotheticalTaxAmount` derives tax from the row's own price and rate,
 *   rounded up to the cent exactly like the persisted calculation.
 * - `presentedTaxAmount` returns the persisted amount for included rows (the
 *   server-computed figure, which may reflect holidays/composite rates) and
 *   the hypothetical amount otherwise.
 */
import { isQuoteItemIncluded, type QuoteItemInclusionInput } from './quoteItemInclusion';

export type QuoteItemTaxInput = QuoteItemInclusionInput & {
  total_price?: number | string | null;
  tax_amount?: number | string | null;
  tax_rate?: number | string | null;
  is_taxable?: boolean | null;
};

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Tax the row would carry at its own rate, in minor units (ceil to the cent). */
export const hypotheticalTaxAmount = (item: QuoteItemTaxInput): number => {
  if (item.is_taxable === false) return 0;
  const amount = toFiniteNumber(item.total_price);
  const rate = toFiniteNumber(item.tax_rate);
  if (amount <= 0 || rate <= 0) return 0;
  return Math.ceil((amount * rate) / 100);
};

/** Persisted tax for included rows; hypothetical tax for unselected optional rows. */
export const presentedTaxAmount = (item: QuoteItemTaxInput): number =>
  isQuoteItemIncluded(item) ? toFiniteNumber(item.tax_amount) : hypotheticalTaxAmount(item);

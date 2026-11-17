import { isQuoteItemIncluded } from '@alga-psa/core';
import { noTaxRateMessage } from './taxEngine';

/** The instant a quote's tax is calculated for: its quote date, else now. */
export function toQuoteTaxDate(value?: string | Date | null): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * A quote row that blocks conversion to an invoice: an included one-time base
 * row whose taxable region had no active rate when the quote was last
 * recalculated. Unselected optional rows and recurring rows never block (the
 * invoice does not carry them).
 */
export interface UnresolvedQuoteTaxBlocker {
  quoteItemId: string;
  region: string;
  date: string;
  /** The same message invoice generation gives for a region with no rate. */
  message: string;
}

export function findUnresolvedQuoteTaxBlocker(
  items: Array<{
    quote_item_id: string;
    is_recurring?: boolean | null;
    is_discount?: boolean | null;
    is_optional?: boolean | null;
    is_selected?: boolean | null;
    tax_region?: string | null;
    tax_unresolved?: boolean | null;
  }>,
  quoteDate?: string | Date | null,
): UnresolvedQuoteTaxBlocker | null {
  const blocked = items.find(
    (item) =>
      item.tax_unresolved === true &&
      !item.is_recurring &&
      !item.is_discount &&
      isQuoteItemIncluded(item),
  );
  if (!blocked) return null;
  const date = toQuoteTaxDate(quoteDate);
  const region = blocked.tax_region ?? '';
  return {
    quoteItemId: blocked.quote_item_id,
    region,
    date,
    message: noTaxRateMessage(region, date),
  };
}

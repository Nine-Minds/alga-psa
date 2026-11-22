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
 * row whose taxable region has no active rate now (see
 * `findFreshUnresolvedQuoteTaxBlocker` in `quoteRowTax.ts`). Unselected optional rows and recurring rows never block (the
 * invoice does not carry them).
 */
export interface UnresolvedQuoteTaxBlocker {
  quoteItemId: string;
  region: string;
  date: string;
  /** The same message invoice generation gives for a region with no rate. */
  message: string;
}

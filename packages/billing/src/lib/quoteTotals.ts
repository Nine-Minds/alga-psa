/**
 * The quote totals derivation lives in `@alga-psa/core` so the client portal
 * (a client component) and the billing package share one definition. This
 * module only re-exports it for existing billing-internal imports.
 */
// LEVERAGE: friction quote-core-shims — billing keeps re-export shims only so callers need no edits; drop once callers import @alga-psa/core directly.
export {
  allocateIncludedQuoteDiscounts,
  buildQuoteDiscountAllocationInputs,
  computeQuoteTotals,
  rowGrossAmount,
  summarizeQuoteTotals,
  type ComputeQuoteTotalsGroup,
  type ComputeQuoteTotalsItem,
  type ComputeQuoteTotalsResult,
  type QuoteTotalsRowInput,
  type QuoteTotalsSummary,
} from '@alga-psa/core';

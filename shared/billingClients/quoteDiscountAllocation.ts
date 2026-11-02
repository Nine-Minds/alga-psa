/**
 * Pure quote discount allocation and the row -> allocation-input derivation.
 *
 * The single implementation lives in `@alga-psa/core` (it also backs the shared
 * quote totals the client portal renders). This module re-exports it so the
 * workflow runtime's quote conversion (`quoteConversionDiscounts`) and other
 * `@alga-psa/shared` consumers keep their import path.
 */
export {
  allocateQuoteDiscounts,
  allocateIncludedQuoteDiscounts,
  buildQuoteDiscountAllocationInputs,
  rowGrossAmount,
  type DiscountBaseItemInput,
  type QuoteDiscountAllocation,
  type QuoteDiscountAllocationResult,
  type QuoteDiscountInput,
  type QuoteDiscountItemAllocation,
  type QuoteDiscountType,
  type QuoteTotalsRowInput,
} from '@alga-psa/core';

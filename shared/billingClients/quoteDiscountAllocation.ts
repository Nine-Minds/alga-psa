/**
 * Pure quote discount allocation and the row -> allocation-input derivation
 * live in `@alga-psa/core`, which backs billing, the client portal, and shared
 * workflow consumers. This module re-exports the single implementation so
 * existing `@alga-psa/shared/billingClients/quoteDiscountAllocation` imports
 * keep their path.
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

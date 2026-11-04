/**
 * Quote discount allocation and the row -> allocation-input derivation live in
 * `@alga-psa/core` (the client portal and billing share them there). This
 * module re-exports them so the workflow runtime's quote conversion and
 * existing `@alga-psa/shared/billingClients/quoteDiscountAllocation` imports
 * keep one implementation.
 */
export {
  allocateIncludedQuoteDiscounts,
  allocateQuoteDiscounts,
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

/**
 * Quote discount allocation lives in `@alga-psa/core` (it backs the shared
 * quote totals). This module only re-exports it for existing billing imports.
 */
export {
  allocateQuoteDiscounts,
  type DiscountBaseItemInput,
  type QuoteDiscountAllocation,
  type QuoteDiscountAllocationResult,
  type QuoteDiscountInput,
  type QuoteDiscountItemAllocation,
  type QuoteDiscountType,
} from '@alga-psa/core';

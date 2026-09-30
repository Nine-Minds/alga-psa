/**
 * The quote-item inclusion rule lives in `@alga-psa/core` so the client portal
 * (a client component) and the billing package share one definition. This
 * module only re-exports it for existing billing-internal imports.
 */
export {
  isOptional,
  isPendingOptional,
  isQuoteItemIncluded,
  isRequired,
  isSelected,
  type QuoteItemInclusionInput,
} from '@alga-psa/core';

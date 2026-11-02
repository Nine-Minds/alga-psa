/**
 * The pure quote discount allocation moved to `@alga-psa/shared` so the
 * workflow runtime's quote conversion and the billing package derive discount
 * shares from one implementation. This module re-exports it for existing
 * billing-internal imports.
 */
export * from '@alga-psa/shared/billingClients/quoteDiscountAllocation';

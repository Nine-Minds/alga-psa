export const DUPLICATE_RECURRING_INVOICE_CODE = 'DUPLICATE_RECURRING_INVOICE';

/**
 * Namespaced message key for the duplicate-recurring-invoice error. The recurring
 * billing run branches on this rather than on the sentence, which the localization
 * boundary rewrites.
 */
export const DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY = 'msp/billing:errors.duplicateRecurringInvoice';

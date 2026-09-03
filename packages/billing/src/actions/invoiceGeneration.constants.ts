export const DUPLICATE_RECURRING_INVOICE_CODE = 'DUPLICATE_RECURRING_INVOICE';

/**
 * Namespaced message key for the duplicate-recurring-invoice error. The recurring
 * billing run branches on this rather than on the sentence, which the localization
 * boundary rewrites.
 */
export const DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY = 'msp/billing:errors.duplicateRecurringInvoice';

/**
 * Namespaced message key for the missing-billing-recipient failure. The boundary
 * mapper attaches it to the returned action error so the recurring billing run can
 * recognize the coded validation failure (`NO_BILLING_EMAIL`) without matching the
 * English sentence, which the localization boundary rewrites.
 */
export const NO_BILLING_EMAIL_MESSAGE_KEY = 'msp/invoicing:manualInvoices.errors.NO_BILLING_EMAIL';

/**
 * Namespaced message key for the missing-usage-records preview failure
 * (`USAGE_RECORDS_MISSING`). Usage billing is record-driven: a usage-billed
 * service with no usage record in the due period produces no charge, and the
 * UI needs the coded failure to render the period and an actionable route to
 * record usage instead of a bare "Nothing to bill".
 */
export const USAGE_RECORDS_MISSING_MESSAGE_KEY = 'msp/invoicing:manualInvoices.errors.USAGE_RECORDS_MISSING';

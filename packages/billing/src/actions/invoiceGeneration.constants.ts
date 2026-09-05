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

/**
 * Namespaced message key for the mixed-invoice omission acknowledgement failure
 * (`USAGE_RECORDS_MISSING_ACK_REQUIRED`). A window with billable fixed/hourly
 * charges but unreported usage services must not silently finalize a partial
 * period: interactive generation retries with an explicit acknowledgement, and
 * the automated recurring run reports the coded incomplete-usage failure.
 */
export const USAGE_RECORDS_MISSING_ACK_REQUIRED_MESSAGE_KEY =
  'msp/invoicing:manualInvoices.errors.USAGE_RECORDS_MISSING_ACK_REQUIRED';

/**
 * Namespaced message key for the stale-preview consistency failure
 * (`USAGE_PERIOD_TOTAL_STALE`). Finalization must consume exactly the
 * period-total revision the preview priced; when the stored total was edited,
 * deleted, or already consumed after the preview, generation refuses and the
 * operator re-previews.
 */
export const USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY =
  'msp/invoicing:manualInvoices.errors.USAGE_PERIOD_TOTAL_STALE';

/**
 * Namespaced message key for a per-service usage pricing failure
 * (`USAGE_CALCULATION_ERROR`). A service whose recorded usage cannot be priced
 * is a calculation error, never "unreported": preview surfaces the typed state
 * and generation refuses rather than silently omitting the recorded charge.
 */
export const USAGE_CALCULATION_ERROR_MESSAGE_KEY =
  'msp/invoicing:manualInvoices.errors.USAGE_CALCULATION_ERROR';

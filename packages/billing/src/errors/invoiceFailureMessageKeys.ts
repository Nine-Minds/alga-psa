import type {
  HandledManualInvoiceErrorCode,
  ManualInvoiceErrorCode,
} from './manualInvoiceErrors';

/**
 * The single code <-> localized message-key registry for invoice failures.
 *
 * The invoice-generation boundary turns a coded `ManualInvoiceError` into a keyed
 * action error, and the recurring billing run recovers the code from that key.
 * Both directions live here so they cannot drift apart. Recognition is by key,
 * never by the English sentence, which the localization boundary rewrites.
 */

const MANUAL_INVOICE_ERROR_KEY_PREFIX = 'msp/invoicing:manualInvoices.errors.';

/** Deliberately not under `manualInvoices.errors.*`; the UI already owns this copy. */
const TIME_APPROVAL_REQUIRED_KEY =
  'msp/invoicing:automaticInvoices.executionRows.blockedUntilApproval';

/**
 * A duplicate recurring invoice is a skip signal for the run (the window is
 * already invoiced), never a failure, so it has no failure code.
 */
export const DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY = 'msp/billing:errors.duplicateRecurringInvoice';

/** Every code the registry carries (everything except the `UNEXPECTED` catch-all). */
export const HANDLED_INVOICE_FAILURE_CODES: readonly HandledManualInvoiceErrorCode[] = [
  'NO_BILLING_EMAIL',
  'TIME_APPROVAL_REQUIRED',
  'USAGE_RECORDS_MISSING',
  'USAGE_RECORDS_MISSING_ACK_REQUIRED',
  'USAGE_PERIOD_TOTAL_STALE',
  'RECURRING_PRICING_STALE',
  'USAGE_CALCULATION_ERROR',
  'RECURRING_PERIODS_NOT_MATERIALIZED',
  'NO_ACTIVE_CONTRACT_LINES',
  'NOTHING_TO_BILL',
  'FIXED_LINE_RATE_UNRESOLVED',
  'FIXED_LINE_NO_SERVICES',
  'CLIENT_NOT_FOUND',
  'BILLING_PROFILE_NOT_FOUND',
  'SERVICE_NOT_FOUND',
  'INVALID_QUANTITY',
  'NO_TAX_RATE',
  'TAX_RATE_COVERAGE_GAP',
  'DISCOUNT_TARGET_NOT_FOUND',
  'INVOICE_NUMBER_CONFLICT',
  'SOURCE_ALREADY_BILLED',
  'SOURCE_NOT_ELIGIBLE',
  'SOURCE_CURRENCY_MISMATCH',
  'PERMISSION_DENIED',
];

export function messageKeyForInvoiceFailureCode(code: ManualInvoiceErrorCode): string {
  if (code === 'TIME_APPROVAL_REQUIRED') {
    return TIME_APPROVAL_REQUIRED_KEY;
  }
  return `${MANUAL_INVOICE_ERROR_KEY_PREFIX}${code}`;
}

const CODE_BY_MESSAGE_KEY: ReadonlyMap<string, ManualInvoiceErrorCode> = new Map(
  [...HANDLED_INVOICE_FAILURE_CODES, 'UNEXPECTED' as const].map((code) => [
    messageKeyForInvoiceFailureCode(code),
    code,
  ]),
);

/** Returns the failure code a message key stands for, or null when it stands for none. */
export function invoiceFailureCodeFromMessageKey(
  key: string | null | undefined,
): ManualInvoiceErrorCode | null {
  if (!key) return null;
  return CODE_BY_MESSAGE_KEY.get(key) ?? null;
}

export type InvoiceFailureMessageKeyClassification =
  | { kind: 'failure'; code: ManualInvoiceErrorCode }
  | { kind: 'skip' }
  | { kind: 'unknown' };

export function classifyInvoiceFailureMessageKey(
  key: string | null | undefined,
): InvoiceFailureMessageKeyClassification {
  if (key === DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY) {
    return { kind: 'skip' };
  }
  const code = invoiceFailureCodeFromMessageKey(key);
  return code ? { kind: 'failure', code } : { kind: 'unknown' };
}

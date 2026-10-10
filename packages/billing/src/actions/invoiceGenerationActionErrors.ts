// Not a 'use server' module on purpose: these are synchronous helpers shared by the
// invoice-generation and recurring-run server actions, and unit-testable on their own.
import { randomUUID } from 'node:crypto';
import {
  actionError,
  permissionError,
  type ActionMessageErrorShape,
  type ActionPermissionErrorShape,
} from '@alga-psa/ui/lib/errorHandling';
import { UnresolvedCatalogPricingError } from '../lib/billing/billingEngine';
import {
  ManualInvoiceError,
  type HandledManualInvoiceErrorCode,
} from '../errors/manualInvoiceErrors';
import type { HandledRecurringFailureCode } from './recurringBillingRunActions.shared';
import {
  DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY,
  NO_BILLING_EMAIL_MESSAGE_KEY,
  TIME_APPROVAL_REQUIRED_MESSAGE_KEY,
  USAGE_RECORDS_MISSING_MESSAGE_KEY,
  USAGE_RECORDS_MISSING_ACK_REQUIRED_MESSAGE_KEY,
  USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY,
  RECURRING_PRICING_STALE_MESSAGE_KEY,
  USAGE_CALCULATION_ERROR_MESSAGE_KEY,
  FIXED_LINE_RATE_UNRESOLVED_MESSAGE_KEY,
  FIXED_LINE_NO_SERVICES_MESSAGE_KEY,
  RECURRING_PERIODS_NOT_MATERIALIZED_MESSAGE_KEY,
  NO_ACTIVE_CONTRACT_LINES_MESSAGE_KEY,
  NOTHING_TO_BILL_MESSAGE_KEY,
} from './invoiceGeneration.constants';

export type InvoiceGenerationActionError = ActionMessageErrorShape | ActionPermissionErrorShape;

/**
 * Short opaque reference for an unexpected failure. The operator quotes it to
 * support; the same value is written next to the full cause in the server log.
 */
export function newSupportReference(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

export function unexpectedInvoiceFailureMessage(ref: string): string {
  return `Something went wrong generating the invoice. Quote reference ${ref} when contacting support.`;
}

/**
 * Expected preview refusals the billing engine raises as bare sentences. Each
 * gets a stable code (the UI translates by it) and an English message that says
 * what to do next, used when the UI has no translation for the code.
 */
export const EXPLAINED_PREVIEW_FAILURES: ReadonlyArray<{
  matches: (message: string) => boolean;
  code: Extract<
    HandledRecurringFailureCode,
    'RECURRING_PERIODS_NOT_MATERIALIZED' | 'NO_ACTIVE_CONTRACT_LINES' | 'NOTHING_TO_BILL'
  >;
  message: string;
  messageKey: string;
}> = [
  {
    matches: (message) => message.startsWith('Recurring service periods were not materialized'),
    code: 'RECURRING_PERIODS_NOT_MATERIALIZED',
    messageKey: RECURRING_PERIODS_NOT_MATERIALIZED_MESSAGE_KEY,
    message:
      "Service periods haven't been generated for this billing window yet. Use Fix all on the Automatic Invoices page, or check Billing > Service Periods, then preview again.",
  },
  {
    matches: (message) =>
      message === 'No active contract lines found for this client in the selected billing period.',
    code: 'NO_ACTIVE_CONTRACT_LINES',
    messageKey: NO_ACTIVE_CONTRACT_LINES_MESSAGE_KEY,
    message:
      'No contract line is active for this billing period. Check the contract start and end dates and that the contract is active.',
  },
  {
    matches: (message) => message === 'Nothing to bill',
    code: 'NOTHING_TO_BILL',
    messageKey: NOTHING_TO_BILL_MESSAGE_KEY,
    message:
      'Nothing is ready to invoice for this window. Contracts billed in arrears can only be invoiced after their service period ends, so check the billing timing and dates.',
  },
];

export function explainedPreviewFailureFromMessage(
  message: string,
): { message: string; code: HandledRecurringFailureCode; messageKey: string } | null {
  // LEVERAGE: friction engine-failure-identity — the engine identifies these refusals only by
  // their English sentence, so preview must string-match; typed errors from the engine would
  // remove this table.
  const explained = EXPLAINED_PREVIEW_FAILURES.find((entry) => entry.matches(message));
  return explained
    ? { message: explained.message, code: explained.code, messageKey: explained.messageKey }
    : null;
}

/**
 * Maps a coded billing validation error (`ManualInvoiceError`) to the localized
 * message key the recurring run uses to recover the structured failure. Codes the
 * recurring flow does not handle deliberately have no key, so they fall back to the
 * generic action-error string.
 */
export function manualInvoiceErrorMessageKey(
  code: HandledManualInvoiceErrorCode,
): string | undefined {
  switch (code) {
    case 'NO_BILLING_EMAIL':
      return NO_BILLING_EMAIL_MESSAGE_KEY;
    case 'TIME_APPROVAL_REQUIRED':
      return TIME_APPROVAL_REQUIRED_MESSAGE_KEY;
    case 'USAGE_RECORDS_MISSING':
      return USAGE_RECORDS_MISSING_MESSAGE_KEY;
    case 'USAGE_RECORDS_MISSING_ACK_REQUIRED':
      return USAGE_RECORDS_MISSING_ACK_REQUIRED_MESSAGE_KEY;
    case 'USAGE_PERIOD_TOTAL_STALE':
      return USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY;
    case 'RECURRING_PRICING_STALE':
      return RECURRING_PRICING_STALE_MESSAGE_KEY;
    case 'USAGE_CALCULATION_ERROR':
      return USAGE_CALCULATION_ERROR_MESSAGE_KEY;
    case 'FIXED_LINE_RATE_UNRESOLVED':
      return FIXED_LINE_RATE_UNRESOLVED_MESSAGE_KEY;
    case 'FIXED_LINE_NO_SERVICES':
      return FIXED_LINE_NO_SERVICES_MESSAGE_KEY;
    default:
      return undefined;
  }
}

export function invoiceGenerationActionErrorFrom(error: unknown): InvoiceGenerationActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }

    // Coded billing validation error. Only the allowlisted code crosses this
    // boundary as a keyed action error; unsupported codes are re-thrown so the
    // recurring run's generic catch owns them (full logging, generic UI string).
    // Checked before the message matching below, which would otherwise surface a
    // raw, uncoded sentence for codes whose message happens to match a prefix.
    if (error instanceof ManualInvoiceError) {
      const messageKey = manualInvoiceErrorMessageKey(error.code);
      return messageKey
        ? actionError(error.message, messageKey, error.params)
        : null;
    }

    // An expected, actionable refusal, not a failure: a contract covers these
    // items but more than one line matched, so they may not be billed at
    // catalog rate until someone decides (F139). The message names them.
    if (error instanceof UnresolvedCatalogPricingError) {
      return actionError(error.message);
    }

    // Expected engine refusals: keyed so the recurring run recovers the code
    // (and the UI translates it) instead of showing a bare sentence or a generic one.
    const explained = explainedPreviewFailureFromMessage(error.message);
    if (explained) {
      return actionError(explained.message, explained.messageKey);
    }

    if (error.message === 'Billing cycle not found') {
      return actionError('Billing cycle not found. It may have been updated or deleted. Please refresh and try again.', 'msp/invoicing:errors.billingCycle.notFoundRefresh');
    }
    if (error.message === 'Invoice not found') {
      return actionError('Invoice not found. It may have been updated or deleted. Please refresh and try again.', 'msp/invoicing:errors.invoice.notFoundRefresh');
    }
    if (error.message === 'Invalid billing cycle dates') {
      return actionError('Billing cycle has invalid dates. Please review the cycle and try again.', 'msp/invoicing:errors.billingCycle.invalidDates');
    }
    if (
      error.message === 'No recurring execution windows selected' ||
      error.message === 'No billing settings found' ||
      error.message === 'Project billing configuration not found' ||
      error.message === 'Project is configured for recurring invoice generation' ||
      error.message === 'Recurring selector input execution window kind is not supported.' ||
      error.message === 'Unable to generate a unique invoice number after multiple attempts.' ||
      error.message.startsWith('Purchase Order is required') ||
      error.message.startsWith('Client ') ||
      error.message.startsWith('Service "') ||
      error.message.includes('Mixed currency billing is not supported')
    ) {
      return actionError(error.message);
    }

    if (error.message.startsWith('Invoice already exists for this recurring execution window')) {
      // Keyed so the recurring run can recognize it after the boundary translates it.
      return actionError(error.message, DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected invoice values is invalid. Please refresh and try again.', 'msp/invoicing:errors.invoice.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required invoice field: ${dbError.column}.`,
          'msp/invoicing:errors.invoice.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required invoice field.', 'msp/invoicing:errors.invoice.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected invoice, client, contract, or billing record no longer exists. Please refresh and try again.', 'msp/invoicing:errors.invoice.referenceMissing');
  }
  if (dbError?.code === '23505') {
    return actionError('A conflicting invoice already exists. Please refresh and try again.', 'msp/invoicing:errors.invoice.duplicate');
  }

  return null;
}


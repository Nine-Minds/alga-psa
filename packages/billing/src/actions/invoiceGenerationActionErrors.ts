import {
  actionError,
  permissionError,
  type ActionMessageErrorShape,
  type ActionPermissionErrorShape,
} from '@alga-psa/ui/lib/errorHandling';
import { UnresolvedCatalogPricingError } from '../lib/billing/billingEngine';
import { ManualInvoiceError } from '../errors/manualInvoiceErrors';
import { messageKeyForInvoiceFailureCode } from '../errors/invoiceFailureMessageKeys';
import { DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY } from './invoiceGeneration.constants';

export type InvoiceGenerationActionError = ActionMessageErrorShape | ActionPermissionErrorShape;

/**
 * Maps an expected invoice-generation failure to a keyed action error (or null
 * when the failure is not an expected one). Lives outside the `'use server'`
 * action modules so both generation and the recurring billing run can share it.
 */
export function invoiceGenerationActionErrorFrom(error: unknown): InvoiceGenerationActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }

    // Any coded billing validation error crosses this boundary as a keyed action
    // error, so the recurring run can recover the code from the key (never from the
    // English sentence, which the localization boundary rewrites). Checked before the
    // message matching below, which would otherwise surface a raw, uncoded sentence
    // for codes whose message happens to match a prefix.
    if (error instanceof ManualInvoiceError) {
      return actionError(error.message, messageKeyForInvoiceFailureCode(error.code), error.params);
    }

    // An expected, actionable refusal, not a failure: a contract covers these
    // items but more than one line matched, so they may not be billed at
    // catalog rate until someone decides (F139). The message names them.
    if (error instanceof UnresolvedCatalogPricingError) {
      return actionError(error.message);
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
    // LEVERAGE: friction engine-failure-identity — the engine identifies these refusals only
    // by their English sentence, so the boundary must string-match; typed errors from the
    // engine would remove this list.
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


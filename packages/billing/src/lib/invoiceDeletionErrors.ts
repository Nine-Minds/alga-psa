/**
 * Typed errors for the shared invoice delete engine (deleteInvoiceWithKnex).
 *
 * These live outside actions/invoiceModification.ts because that file is a
 * 'use server' module, which may only export async functions.
 */

/**
 * An invoice action refused for an expected business reason. Carries an
 * optional i18n key so UI wrappers can localize it; REST maps it to a 409.
 */
export class ExpectedInvoiceActionError extends Error {
  readonly i18nKey?: string;

  constructor(message: string, i18nKey?: string) {
    super(message);
    this.name = 'ExpectedInvoiceActionError';
    this.i18nKey = i18nKey;
  }
}

/** Thrown by deleteInvoiceWithKnex({ requireDraft: true }) when the invoice is finalized. */
export class InvoiceNotDraftError extends Error {
  readonly invoiceId: string;

  constructor(invoiceId: string) {
    super(`Invoice ${invoiceId} is finalized and cannot be deleted; void it instead.`);
    this.name = 'InvoiceNotDraftError';
    this.invoiceId = invoiceId;
  }
}

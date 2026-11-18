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
  readonly messageParams?: Record<string, string | number>;

  constructor(message: string, i18nKey?: string, messageParams?: Record<string, string | number>) {
    super(message);
    this.name = 'ExpectedInvoiceActionError';
    this.i18nKey = i18nKey;
    this.messageParams = messageParams;
  }
}

/**
 * Thrown by deleteInvoiceWithKnex({ requireDraft: true }) when the invoice is
 * not a true draft: finalized_at is set or status is not 'draft'.
 */
export class InvoiceNotDraftError extends Error {
  readonly invoiceId: string;

  constructor(invoiceId: string) {
    super(`Only draft invoices can be deleted; void the invoice instead.`);
    this.name = 'InvoiceNotDraftError';
    this.invoiceId = invoiceId;
  }
}

/**
 * Thrown by deleteInvoiceWithKnex({ requireDraft: true }) when a draft invoice
 * has recorded invoice_payments (deleting would cascade them away).
 */
export class InvoiceHasPaymentsError extends Error {
  readonly invoiceId: string;

  constructor(invoiceId: string) {
    super('Invoices with recorded payments cannot be deleted');
    this.name = 'InvoiceHasPaymentsError';
    this.invoiceId = invoiceId;
  }
}

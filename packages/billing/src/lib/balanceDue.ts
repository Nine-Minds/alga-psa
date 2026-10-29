/**
 * Pure balance formula, kept free of DB/runtime imports so read paths (REST
 * invoice service, client portal) can share it without pulling in the
 * accounting-sync services barrel.
 */

export interface InvoiceBalanceInputs {
  /** Invoice total in cents */
  totalAmount: number;
  /** Credit applied to the invoice in cents */
  creditApplied: number;
  /** Net payments recorded against the invoice in cents */
  totalPaid: number;
}

/**
 * Amount still owed on an invoice, in cents. Invoice totals are immutable
 * (credit reshape): the document total stays gross and what is owed is
 * derived from credits applied plus net payments.
 */
export function computeBalanceDue(inputs: InvoiceBalanceInputs): number {
  return Math.round(inputs.totalAmount) - Math.round(inputs.creditApplied) - Math.round(inputs.totalPaid);
}

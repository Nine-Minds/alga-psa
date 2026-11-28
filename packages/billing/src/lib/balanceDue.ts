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

/** Lifecycle states that payment status must never overwrite. */
const LIFECYCLE_STATUSES = ['draft', 'cancelled', 'void'] as const;

export type DerivedPaymentStatus = 'paid' | 'partially_applied' | 'sent';

export interface InvoiceStatusInputs extends InvoiceBalanceInputs {
  /** Current stored invoice status (lifecycle state) */
  currentStatus: string | null | undefined;
}

/**
 * Derives the payment-driven invoice status from total, credit applied, net
 * recorded payments and the current lifecycle state.
 *
 * - draft / cancelled / void are lifecycle states and are returned unchanged.
 * - `paid` requires net payments > 0, so a credit note, negative-total or
 *   prepayment invoice with no payments is never turned `paid` just because
 *   its balance is <= 0.
 * - Net payments above the balance still yield `paid` (negative balance due).
 * - No net payments: `sent` (covers a full reversal and a fresh finalize).
 */
export function deriveInvoiceStatus(inputs: InvoiceStatusInputs): string {
  const current = inputs.currentStatus ?? '';
  if ((LIFECYCLE_STATUSES as readonly string[]).includes(current)) {
    return current;
  }
  const totalPaid = Math.round(inputs.totalPaid);
  if (totalPaid > 0) {
    return computeBalanceDue(inputs) <= 0 ? 'paid' : 'partially_applied';
  }
  // No net payments. Keep other non-payment states as they were; payment
  // states fall back to sent.
  if (current === 'paid' || current === 'partially_applied' || current === 'sent' || current === '') {
    return 'sent';
  }
  return current;
}

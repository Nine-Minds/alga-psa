/**
 * Narrow payment-link error shared by the billing payment-action layer and the
 * client-portal payment actions.
 *
 * Lives in its own module (NOT a `'use server'` file): a class export is not
 * allowed from a `'use server'` module, and the error type must be importable
 * by the client-portal server actions.
 */
export type PaymentLinkErrorCode =
  | 'payment_link_creation_failed'
  | 'payment_not_configured';

export class PaymentLinkError extends Error {
  readonly code: PaymentLinkErrorCode;

  constructor(code: PaymentLinkErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PaymentLinkError';
    this.code = code;
  }
}

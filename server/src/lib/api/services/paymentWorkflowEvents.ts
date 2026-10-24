import { builtWorkflowPayload, type PaymentRecordedSource } from '@alga-psa/event-schemas';
import { formatMoneyAmount } from './invoiceWorkflowEvents';

// LEVERAGE: pattern payment-recorded-builder — packages/billing/src/lib/paymentRecordedEvent.ts builds the same payload (billing cannot import server/); belongs in a shared builders layer.
export function buildPaymentRecordedPayload(params: {
  paymentId: string;
  clientId?: string | null;
  receivedAt: string;
  amount: number;
  currency: string;
  method: string;
  receivedByUserId?: string;
  gatewayTransactionId?: string | null;
  /** Explicit provenance; consumers allow-list on it (missing = do not act). */
  source?: PaymentRecordedSource;
}) {
  return builtWorkflowPayload('PAYMENT_RECORDED', {
    paymentId: params.paymentId,
    clientId: params.clientId ?? undefined,
    receivedAt: params.receivedAt,
    amount: formatMoneyAmount(params.amount),
    currency: params.currency,
    method: params.method,
    receivedByUserId: params.receivedByUserId,
    gatewayTransactionId: params.gatewayTransactionId ?? undefined,
    source: params.source,
  });
}

export function buildPaymentAppliedPayload(params: {
  paymentId: string;
  appliedAt: string;
  appliedByUserId?: string;
  applications: Array<{ invoiceId: string; amountApplied: number }>;
}) {
  return builtWorkflowPayload('PAYMENT_APPLIED', {
    paymentId: params.paymentId,
    appliedAt: params.appliedAt,
    appliedByUserId: params.appliedByUserId,
    applications: params.applications.map((application) => ({
      invoiceId: application.invoiceId,
      amountApplied: formatMoneyAmount(application.amountApplied),
    })),
  });
}

export function buildPaymentFailedPayload(params: {
  paymentId?: string;
  invoiceId?: string;
  clientId?: string | null;
  failedAt: string;
  amount: number;
  currency: string;
  method: string;
  failureCode?: string;
  failureMessage?: string;
  retryable?: boolean;
}) {
  return builtWorkflowPayload('PAYMENT_FAILED', {
    paymentId: params.paymentId,
    invoiceId: params.invoiceId,
    clientId: params.clientId ?? undefined,
    failedAt: params.failedAt,
    amount: formatMoneyAmount(params.amount),
    currency: params.currency,
    method: params.method,
    failureCode: params.failureCode,
    failureMessage: params.failureMessage,
    retryable: params.retryable,
  });
}

export function buildPaymentRefundedPayload(params: {
  paymentId: string;
  refundedAt: string;
  refundedByUserId?: string;
  amount: number;
  currency: string;
  reason?: string | null;
}) {
  return builtWorkflowPayload('PAYMENT_REFUNDED', {
    paymentId: params.paymentId,
    refundedAt: params.refundedAt,
    refundedByUserId: params.refundedByUserId,
    amount: formatMoneyAmount(params.amount),
    currency: params.currency,
    reason: params.reason ?? undefined,
  });
}


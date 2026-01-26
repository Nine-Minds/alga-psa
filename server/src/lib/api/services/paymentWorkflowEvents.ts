import { formatMoneyAmount } from './invoiceWorkflowEvents';

export function buildPaymentRecordedPayload(params: {
  paymentId: string;
  clientId?: string | null;
  receivedAt: string;
  amount: number;
  currency: string;
  method: string;
  receivedByUserId?: string;
  gatewayTransactionId?: string | null;
}) {
  return {
    paymentId: params.paymentId,
    clientId: params.clientId ?? undefined,
    receivedAt: params.receivedAt,
    amount: formatMoneyAmount(params.amount),
    currency: params.currency,
    method: params.method,
    receivedByUserId: params.receivedByUserId,
    gatewayTransactionId: params.gatewayTransactionId ?? undefined,
  };
}

export function buildPaymentAppliedPayload(params: {
  paymentId: string;
  appliedAt: string;
  appliedByUserId?: string;
  applications: Array<{ invoiceId: string; amountApplied: number }>;
}) {
  return {
    paymentId: params.paymentId,
    appliedAt: params.appliedAt,
    appliedByUserId: params.appliedByUserId,
    applications: params.applications.map((application) => ({
      invoiceId: application.invoiceId,
      amountApplied: formatMoneyAmount(application.amountApplied),
    })),
  };
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
  return {
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
  };
}

export function buildPaymentRefundedPayload(params: {
  paymentId: string;
  refundedAt: string;
  refundedByUserId?: string;
  amount: number;
  currency: string;
  reason?: string | null;
}) {
  return {
    paymentId: params.paymentId,
    refundedAt: params.refundedAt,
    refundedByUserId: params.refundedByUserId,
    amount: formatMoneyAmount(params.amount),
    currency: params.currency,
    reason: params.reason ?? undefined,
  };
}


import { builtWorkflowPayload, type PaymentRecordedSource } from '@alga-psa/event-schemas';

// LEVERAGE: pattern payment-recorded-builder — same payload as server/src/lib/api/services/paymentWorkflowEvents.ts
// (packages/billing cannot import server/); belongs in a shared builders layer.
export function buildExternalPaymentRecordedPayload(params: {
  paymentId: string;
  clientId?: string | null;
  receivedAt: string;
  /** Amount in cents (positive) */
  amount: number;
  currency: string;
  method: string;
  gatewayTransactionId?: string | null;
  /** Set only when a person recorded the payment (manual entry). */
  receivedByUserId?: string | null;
  /** Omit only when provenance is unknown; consumers default-deny. */
  source?: PaymentRecordedSource;
}) {
  return builtWorkflowPayload('PAYMENT_RECORDED', {
    paymentId: params.paymentId,
    clientId: params.clientId ?? undefined,
    receivedAt: params.receivedAt,
    amount: Number.isFinite(params.amount) ? String(Math.max(0, params.amount)) : '0',
    currency: params.currency,
    method: params.method,
    receivedByUserId: params.receivedByUserId ?? undefined,
    gatewayTransactionId: params.gatewayTransactionId ?? undefined,
    source: params.source,
  });
}

// LEVERAGE: pattern payment-recorded-builder — same payload as
// buildPaymentAppliedPayload in server/src/lib/api/services/paymentWorkflowEvents.ts.
export function buildExternalPaymentAppliedPayload(params: {
  paymentId: string;
  appliedAt: string;
  /** Set only when a person applied the payment (manual entry). */
  appliedByUserId?: string | null;
  applications: Array<{ invoiceId: string; amountApplied: number }>;
}) {
  return builtWorkflowPayload('PAYMENT_APPLIED', {
    paymentId: params.paymentId,
    appliedAt: params.appliedAt,
    appliedByUserId: params.appliedByUserId ?? undefined,
    applications: params.applications.map((application) => ({
      invoiceId: application.invoiceId,
      amountApplied: Number.isFinite(application.amountApplied)
        ? String(Math.max(0, application.amountApplied))
        : '0',
    })),
  });
}

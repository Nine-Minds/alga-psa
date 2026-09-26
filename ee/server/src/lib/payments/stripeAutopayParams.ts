import type Stripe from 'stripe';
import type { ChargeSavedPaymentMethodRequest } from '@alga-psa/types';

export function buildAutopayPaymentIntentRequest(tenantId: string, request: ChargeSavedPaymentMethodRequest): {
  params: Stripe.PaymentIntentCreateParams;
  options: Stripe.RequestOptions;
} {
  return {
    params: {
      amount: request.amount,
      currency: request.currency.toLowerCase(),
      customer: request.customerId,
      payment_method: request.paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        tenant_id: tenantId,
        invoice_id: request.invoiceId,
        client_id: request.clientId,
        billing_profile_id: request.billingProfileId,
        autopay_attempt_id: request.attemptId,
      },
      description: request.description,
    },
    options: { idempotencyKey: request.idempotencyKey },
  };
}

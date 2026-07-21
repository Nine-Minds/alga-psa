import { Buffer } from 'node:buffer';
import process from 'node:process';

import Stripe from 'stripe';

export interface AutoTopupPaymentIntentInput {
  jobId: string;
  attempt: number;
  customerId: string;
  priceId: string;
  tenantId: string;
  deploymentType: 'hosted' | 'appliance';
  accountId: string;
}

export interface GatewayStripeClient {
  constructWebhookEvent(payload: Buffer, signature: string, secret: string): Stripe.Event;
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  getCheckoutPriceId(sessionId: string): Promise<string>;
  createAutoTopupPaymentIntent(
    input: AutoTopupPaymentIntentInput,
  ): Promise<Stripe.PaymentIntent>;
}

function expandableId(
  value: string | { id: string } | null | undefined,
  context: string,
): string {
  const id = typeof value === 'string' ? value : value?.id;
  if (!id?.trim()) {
    throw new Error(`${context} is missing its Stripe id`);
  }
  return id;
}

export interface OfficialGatewayStripeClientOptions {
  secretKey?: string;
}

export class OfficialGatewayStripeClient implements GatewayStripeClient {
  private stripe: Stripe | undefined;

  constructor(private readonly options: OfficialGatewayStripeClientOptions = {}) {}

  private getStripe(): Stripe {
    const secretKey =
      this.options.secretKey?.trim() || process.env.AI_GATEWAY_STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new Error('AI_GATEWAY_STRIPE_SECRET_KEY is not configured');
    }
    this.stripe ??= new Stripe(secretKey);
    return this.stripe;
  }

  constructWebhookEvent(payload: Buffer, signature: string, secret: string): Stripe.Event {
    return this.getStripe().webhooks.constructEvent(payload, signature, secret);
  }

  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.getStripe().subscriptions.retrieve(subscriptionId);
  }

  async getCheckoutPriceId(sessionId: string): Promise<string> {
    const lineItems = await this.getStripe().checkout.sessions.listLineItems(sessionId, {
      limit: 2,
    });
    if (lineItems.data.length !== 1) {
      throw new Error(`AI top-up checkout ${sessionId} must contain exactly one line item`);
    }
    return expandableId(lineItems.data[0]?.price, `Checkout ${sessionId} line-item price`);
  }

  async createAutoTopupPaymentIntent(
    input: AutoTopupPaymentIntentInput,
  ): Promise<Stripe.PaymentIntent> {
    const stripe = this.getStripe();
    const [price, customerResponse] = await Promise.all([
      stripe.prices.retrieve(input.priceId),
      stripe.customers.retrieve(input.customerId),
    ]);
    if (
      price.type !== 'one_time' ||
      !price.active ||
      price.unit_amount === null ||
      price.unit_amount <= 0
    ) {
      throw new Error(`Stripe price ${input.priceId} is not an active fixed-price pack`);
    }
    if (customerResponse.deleted) {
      throw new Error(`Stripe customer ${input.customerId} has been deleted`);
    }
    const paymentMethodId = expandableId(
      customerResponse.invoice_settings.default_payment_method,
      `Stripe customer ${input.customerId} default payment method`,
    );

    return stripe.paymentIntents.create(
      {
        amount: price.unit_amount,
        currency: price.currency,
        customer: input.customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          purpose: 'ai-topup',
          source: 'auto-topup',
          auto_topup_job_id: input.jobId,
          pack_price_id: input.priceId,
          tenant_id: input.tenantId,
          deployment_type: input.deploymentType,
          account_id: input.accountId,
        },
      },
      { idempotencyKey: `ai-auto-topup:${input.jobId}:${input.attempt}` },
    );
  }
}

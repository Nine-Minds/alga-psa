import Stripe from 'stripe';
import { getSecret } from '@alga-psa/shared/core';

let stripeClient: Stripe | null = null;

/**
 * Get or create a Stripe client instance
 * Uses lazy initialization to ensure credentials are available
 */
export async function getStripeClient(): Promise<Stripe> {
  if (!stripeClient) {
    const secretKey = await getSecret('stripe_secret_key', 'STRIPE_SECRET_KEY');

    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY not configured in Temporal worker');
    }

    stripeClient = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia' as any,
      typescript: true,
    });
  }

  return stripeClient;
}

/**
 * Update subscription metadata with tenant information
 * This links the Stripe subscription to the AlgaPSA tenant
 */
export async function updateSubscriptionMetadata(
  subscriptionId: string,
  metadata: {
    tenant_id: string;
    tenant_name?: string;
  }
): Promise<void> {
  const stripe = await getStripeClient();

  await stripe.subscriptions.update(subscriptionId, {
    metadata,
  });
}

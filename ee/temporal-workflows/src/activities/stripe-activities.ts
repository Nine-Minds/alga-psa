/**
 * Stripe Activities for Temporal Workflows
 *
 * These activities interact with the Stripe API to fetch checkout session
 * and subscription details during tenant creation.
 */

import { Context } from '@temporalio/activity';
import Stripe from 'stripe';
import { getSecret } from '@alga-psa/shared/core';

const logger = () => Context.current().log;

let stripeClient: Stripe | null = null;

/**
 * Get or initialize the Stripe client
 */
async function getStripeClient(): Promise<Stripe> {
  if (stripeClient) {
    return stripeClient;
  }

  const log = logger();

  // Get Stripe secret key from secrets
  const secretKey = await getSecret('stripe_secret_key', 'STRIPE_SECRET_KEY');

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not found in secrets or environment');
  }

  log.info('Initializing Stripe client');

  stripeClient = new Stripe(secretKey, {
    apiVersion: '2024-12-18.acacia' as any,
    typescript: true,
  });

  return stripeClient;
}

export interface FetchStripeDetailsInput {
  checkoutSessionId: string;
}

export interface FetchStripeDetailsResult {
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionItemId?: string;
  stripePriceId?: string;
  licenseCount?: number;
}

/**
 * Fetch Stripe customer and subscription details from a checkout session
 *
 * This activity is called during tenant creation to retrieve billing information
 * directly from Stripe instead of relying on it being passed through the workflow input.
 *
 * Benefits:
 * - Single source of truth (Stripe API)
 * - More resilient (can retry if fetch fails)
 * - Simpler integration (only need checkout session ID)
 */
export async function fetchStripeDetailsFromCheckout(
  input: FetchStripeDetailsInput
): Promise<FetchStripeDetailsResult> {
  const log = logger();

  log.info('Fetching Stripe details from checkout session', {
    checkoutSessionId: input.checkoutSessionId
  });

  try {
    const stripe = await getStripeClient();

    // Fetch the checkout session
    const session = await stripe.checkout.sessions.retrieve(input.checkoutSessionId);

    log.info('Checkout session retrieved', {
      sessionId: session.id,
      mode: session.mode,
      status: session.status,
      customerId: session.customer,
      subscriptionId: session.subscription,
    });

    // Extract customer ID
    if (!session.customer) {
      throw new Error(`Checkout session ${input.checkoutSessionId} has no customer`);
    }

    const result: FetchStripeDetailsResult = {
      stripeCustomerId: session.customer as string,
    };

    // If this was a subscription checkout, fetch subscription details
    if (session.subscription) {
      log.info('Fetching subscription details', {
        subscriptionId: session.subscription
      });

      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string,
        { expand: ['items.data.price'] }
      );

      const subscriptionItem = subscription.items.data[0];

      if (!subscriptionItem) {
        log.warn('Subscription has no items', { subscriptionId: subscription.id });
      } else {
        result.stripeSubscriptionId = subscription.id;
        result.stripeSubscriptionItemId = subscriptionItem.id;
        result.stripePriceId = subscriptionItem.price.id;
        result.licenseCount = subscriptionItem.quantity || 1;

        log.info('Subscription details retrieved', {
          subscriptionId: subscription.id,
          subscriptionItemId: subscriptionItem.id,
          priceId: subscriptionItem.price.id,
          quantity: result.licenseCount,
        });
      }
    } else {
      log.info('Checkout session is not a subscription', {
        mode: session.mode
      });
    }

    log.info('Successfully fetched Stripe details', {
      checkoutSessionId: input.checkoutSessionId,
      hasSubscription: !!result.stripeSubscriptionId,
    });

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to fetch Stripe details from checkout session', {
      checkoutSessionId: input.checkoutSessionId,
      error: errorMessage,
    });
    throw new Error(`Failed to fetch Stripe details: ${errorMessage}`);
  }
}

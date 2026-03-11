/**
 * Stripe Activities for Temporal Workflows
 *
 * These activities interact with the Stripe API to fetch checkout session
 * and subscription details during tenant creation.
 */

import { Context } from '@temporalio/activity';
import Stripe from 'stripe';

const logger = () => Context.current().log;

let stripeClient: Stripe | null = null;

/**
 * Get or initialize the Stripe client
 */
function getStripeClient(): Stripe {
  if (stripeClient) {
    return stripeClient;
  }

  const log = logger();

  // Get Stripe secret key from environment variables
  // The temporal worker should have STRIPE_SECRET_KEY configured in its environment
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY environment variable is not configured in the temporal worker. ' +
      'Please add it to the worker deployment configuration.'
    );
  }

  log.info('Initializing Stripe client for temporal worker');

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
  stripeSubscriptionItemId?: string;  // Per-user item
  stripePriceId?: string;             // Per-user price
  stripeBaseItemId?: string;          // Base fee item (multi-item only)
  stripeBasePriceId?: string;         // Base fee price (multi-item only)
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
    const stripe = getStripeClient();

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

      const items = subscription.items.data;

      if (items.length === 0) {
        log.warn('Subscription has no items', { subscriptionId: subscription.id });
      } else if (items.length === 1) {
        // Legacy single-item subscription (per-user only)
        const subscriptionItem = items[0];
        result.stripeSubscriptionId = subscription.id;
        result.stripeSubscriptionItemId = subscriptionItem.id;
        result.stripePriceId = subscriptionItem.price.id;
        result.licenseCount = subscriptionItem.quantity || 1;

        log.info('Legacy subscription details retrieved', {
          subscriptionId: subscription.id,
          subscriptionItemId: subscriptionItem.id,
          priceId: subscriptionItem.price.id,
          quantity: result.licenseCount,
        });
      } else {
        // Multi-item subscription (base fee + per-user)
        // The per-user item has quantity > 1 or is the one with a quantity matching license count
        // The base fee item has quantity === 1 and a different price
        result.stripeSubscriptionId = subscription.id;

        // Known per-user price IDs from env
        const knownUserPriceIds = [
          process.env.STRIPE_LICENSE_PRICE_ID,
          process.env.STRIPE_PRO_USER_PRICE_ID,
          process.env.STRIPE_PREMIUM_USER_PRICE_ID,
        ].filter(Boolean);

        let userItem = items.find(item => knownUserPriceIds.includes(item.price.id));
        let baseItem = items.find(item => !knownUserPriceIds.includes(item.price.id));

        // Fallback: if no known price matched, use quantity heuristic
        if (!userItem) {
          userItem = items.find(item => (item.quantity || 0) > 1) || items[items.length - 1];
          baseItem = items.find(item => item.id !== userItem!.id);
        }

        result.stripeSubscriptionItemId = userItem.id;
        result.stripePriceId = userItem.price.id;
        result.licenseCount = userItem.quantity || 1;

        if (baseItem) {
          result.stripeBaseItemId = baseItem.id;
          result.stripeBasePriceId = baseItem.price.id;
        }

        log.info('Multi-item subscription details retrieved', {
          subscriptionId: subscription.id,
          userItemId: userItem.id,
          userPriceId: userItem.price.id,
          baseItemId: baseItem?.id,
          basePriceId: baseItem?.price.id,
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

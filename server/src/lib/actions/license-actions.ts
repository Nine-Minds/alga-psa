'use server';

import { getLicenseUsage, type LicenseUsage } from '../license/get-license-usage';
import { getSession } from 'server/src/lib/auth/getSession';
import { getStripeService } from '../stripe/StripeService';
import logger from '@alga-psa/shared/core/logger';

/**
 * Server action to get the current license usage for the session tenant
 * @returns License usage information or error
 */
export async function getLicenseUsageAction(): Promise<{
  success: boolean;
  data?: LicenseUsage;
  error?: string
}> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'No tenant in session'
      };
    }

    const usage = await getLicenseUsage(session.user.tenant);

    return {
      success: true,
      data: usage,
    };
  } catch (error) {
    console.error('Error getting license usage:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get license usage',
    };
  }
}

/**
 * Server action to create a Stripe checkout session for license purchase
 * @param quantity - Number of licenses to purchase
 * @returns Checkout session data or error
 */
export async function createLicenseCheckoutSessionAction(
  quantity: number
): Promise<{
  success: boolean;
  data?: {
    clientSecret: string;
    sessionId: string;
    publishableKey: string;
  };
  error?: string;
}> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    // Validate quantity
    if (!quantity || quantity < 1) {
      return {
        success: false,
        error: 'Invalid license quantity',
      };
    }

    logger.info(
      `[createLicenseCheckoutSessionAction] Creating checkout session for tenant ${session.user.tenant}, quantity: ${quantity}`
    );

    const stripeService = getStripeService();

    // Create embedded checkout session
    const checkoutSession = await stripeService.createLicenseCheckoutSession(
      session.user.tenant,
      quantity
    );

    return {
      success: true,
      data: {
        ...checkoutSession,
        publishableKey: stripeService.getPublishableKey(),
      },
    };
  } catch (error) {
    logger.error('[createLicenseCheckoutSessionAction] Error creating checkout session:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create checkout session',
    };
  }
}

/**
 * Server action to get license pricing information
 * @returns License price information or error
 */
export async function getLicensePricingAction(): Promise<{
  success: boolean;
  data?: {
    priceId: string;
    unitAmount: number;
    currency: string;
    interval: string;
  };
  error?: string;
}> {
  try {
    const licensePriceId = process.env.STRIPE_LICENSE_PRICE_ID;

    if (!licensePriceId) {
      return {
        success: false,
        error: 'License pricing not configured',
      };
    }

    const stripeService = getStripeService();

    // For now, return hardcoded values
    // In production, you might want to fetch from Stripe or database
    return {
      success: true,
      data: {
        priceId: licensePriceId,
        unitAmount: 5000, // $50.00 in cents - update this to match your actual pricing
        currency: 'usd',
        interval: 'month',
      },
    };
  } catch (error) {
    logger.error('[getLicensePricingAction] Error getting license pricing:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get license pricing',
    };
  }
}

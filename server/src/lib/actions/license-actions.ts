'use server';

import { getLicenseUsage, type LicenseUsage } from '../license/get-license-usage';
import { getSession } from 'server/src/lib/auth/getSession';
import { getStripeService } from '../stripe/StripeService';
import { getConnection } from 'server/src/lib/db/db';
import logger from '@alga-psa/shared/core/logger';
import {
  IGetSubscriptionInfoResponse,
  IGetPaymentMethodResponse,
  IGetInvoicesResponse,
  IUpdatePaymentMethodResponse,
  ICancelSubscriptionResponse,
  IStripeSubscription,
  IStripePrice,
  IStripeCustomer,
} from 'server/src/interfaces/subscription.interfaces';

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
 * Server action to get invoice preview for license change
 * @param quantity - New total number of licenses
 * @returns Invoice preview data or null if no existing subscription
 */
export async function getInvoicePreviewAction(
  quantity: number
): Promise<{
  success: boolean;
  data?: {
    currentQuantity: number;
    newQuantity: number;
    isIncrease: boolean;
    amountDue: number;
    currency: string;
    currentPeriodEnd: string;
    prorationAmount: number;
    remainingAmount: number;
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

    const stripeService = getStripeService();
    const preview = await stripeService.getUpcomingInvoicePreview(
      session.user.tenant,
      quantity
    );

    if (!preview) {
      return {
        success: false,
        error: 'No existing subscription found',
      };
    }

    return {
      success: true,
      data: {
        ...preview,
        currentPeriodEnd: preview.currentPeriodEnd.toISOString(),
      },
    };
  } catch (error) {
    logger.error('[getInvoicePreviewAction] Error getting invoice preview:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get invoice preview',
    };
  }
}

/**
 * Server action to create a Stripe checkout session for license purchase or update existing subscription
 * @param quantity - Number of licenses to set as total
 * @returns Checkout session data, update confirmation, or error
 */
export async function createLicenseCheckoutSessionAction(
  quantity: number
): Promise<{
  success: boolean;
  data?: {
    type: 'checkout' | 'updated';
    clientSecret?: string;
    sessionId?: string;
    publishableKey?: string;
    scheduledChange?: boolean;
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
      `[createLicenseCheckoutSessionAction] Processing license update for tenant ${session.user.tenant}, quantity: ${quantity}`
    );

    const stripeService = getStripeService();

    // Update existing subscription or create checkout session
    const result = await stripeService.updateOrCreateLicenseSubscription(
      session.user.tenant,
      quantity
    );

    if (result.type === 'updated') {
      // Subscription was updated directly (or scheduled for period end)
      logger.info(
        `[createLicenseCheckoutSessionAction] Subscription ${result.scheduledChange ? 'scheduled' : 'updated'} for tenant ${session.user.tenant}`
      );
      return {
        success: true,
        data: {
          type: 'updated',
          scheduledChange: result.scheduledChange,
        },
      };
    }

    // Checkout session created
    logger.info(`[createLicenseCheckoutSessionAction] Checkout session created for tenant ${session.user.tenant}`);
    return {
      success: true,
      data: {
        type: 'checkout',
        clientSecret: result.clientSecret,
        sessionId: result.sessionId,
        publishableKey: stripeService.getPublishableKey(),
      },
    };
  } catch (error) {
    logger.error('[createLicenseCheckoutSessionAction] Error processing license update:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process license update',
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

    // Get pricing from environment variables
    const unitAmountCents = parseInt(process.env.STRIPE_LICENSE_UNIT_AMOUNT || '5000', 10);
    const currency = process.env.STRIPE_LICENSE_CURRENCY || 'usd';
    const interval = process.env.STRIPE_LICENSE_INTERVAL || 'month';

    return {
      success: true,
      data: {
        priceId: licensePriceId,
        unitAmount: unitAmountCents,
        currency,
        interval,
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

/**
 * Get subscription information for the current tenant
 * Fetches from stripe_subscriptions table
 */
export async function getSubscriptionInfoAction(): Promise<IGetSubscriptionInfoResponse> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    const knex = await getConnection(session.user.tenant);

    // Get active subscription with related price info
    const subscription = await knex<IStripeSubscription>('stripe_subscriptions')
      .where({
        tenant: session.user.tenant,
        status: 'active',
      })
      .first();

    if (!subscription) {
      return {
        success: false,
        error: 'No active subscription found',
      };
    }

    // Get price info
    const price = await knex<IStripePrice>('stripe_prices')
      .where({
        stripe_price_id: subscription.stripe_price_id,
      })
      .first();

    if (!price) {
      return {
        success: false,
        error: 'Price information not found',
      };
    }

    // Calculate monthly amount
    const monthlyAmount = (price.unit_amount / 100) * subscription.quantity;

    return {
      success: true,
      data: {
        subscription_id: subscription.stripe_subscription_external_id,
        status: subscription.status,
        current_period_start: subscription.current_period_start || new Date().toISOString(),
        current_period_end: subscription.current_period_end || new Date().toISOString(),
        next_billing_date: subscription.current_period_end || new Date().toISOString(),
        monthly_amount: monthlyAmount,
        quantity: subscription.quantity,
        cancel_at: subscription.cancel_at,
        canceled_at: subscription.canceled_at,
      },
    };
  } catch (error) {
    logger.error('[getSubscriptionInfoAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get subscription info',
    };
  }
}

/**
 * Get payment method information from Stripe
 * Fetches from Stripe API since we don't store full card details
 */
export async function getPaymentMethodInfoAction(): Promise<IGetPaymentMethodResponse> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    const knex = await getConnection(session.user.tenant);
    const stripeService = getStripeService();

    // Get customer from database
    const customer = await knex<IStripeCustomer>('stripe_customers')
      .where({ tenant: session.user.tenant })
      .first();

    if (!customer) {
      return {
        success: false,
        error: 'No customer record found',
      };
    }

    // Fetch payment methods from Stripe
    const stripe = (stripeService as any).stripe;
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer.stripe_customer_external_id,
      type: 'card',
      limit: 1,
    });

    if (paymentMethods.data.length === 0) {
      return {
        success: false,
        error: 'No payment method on file',
      };
    }

    const paymentMethod = paymentMethods.data[0];
    const card = paymentMethod.card;

    if (!card) {
      return {
        success: false,
        error: 'Invalid payment method',
      };
    }

    return {
      success: true,
      data: {
        card_brand: card.brand,
        card_last4: card.last4,
        card_exp_month: card.exp_month,
        card_exp_year: card.exp_year,
        billing_email: customer.email,
      },
    };
  } catch (error) {
    logger.error('[getPaymentMethodInfoAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get payment method',
    };
  }
}

/**
 * Get recent invoices from Stripe
 * Fetches from Stripe API
 */
export async function getRecentInvoicesAction(limit: number = 10): Promise<IGetInvoicesResponse> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    const knex = await getConnection(session.user.tenant);
    const stripeService = getStripeService();

    // Get customer from database
    const customer = await knex<IStripeCustomer>('stripe_customers')
      .where({ tenant: session.user.tenant })
      .first();

    if (!customer) {
      return {
        success: false,
        error: 'No customer record found',
      };
    }

    // Fetch invoices from Stripe
    const stripe = (stripeService as any).stripe;
    const invoices = await stripe.invoices.list({
      customer: customer.stripe_customer_external_id,
      limit,
    });

    const invoiceData = invoices.data.map((invoice: any) => {
      // Format period label
      const periodDate = new Date(invoice.created * 1000);
      const periodLabel = periodDate.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });

      return {
        invoice_id: invoice.id,
        invoice_number: invoice.number,
        period_label: periodLabel,
        paid_at: invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
          : null,
        amount: invoice.amount_paid / 100, // Convert cents to dollars
        status: invoice.status,
        invoice_pdf_url: invoice.invoice_pdf,
      };
    });

    return {
      success: true,
      data: invoiceData,
    };
  } catch (error) {
    logger.error('[getRecentInvoicesAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get invoices',
    };
  }
}

/**
 * Create a Stripe Customer Portal session for updating payment method
 * Returns a URL to redirect the user to
 */
export async function createCustomerPortalSessionAction(): Promise<IUpdatePaymentMethodResponse> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    const knex = await getConnection(session.user.tenant);
    const stripeService = getStripeService();

    // Get customer from database
    const customer = await knex<IStripeCustomer>('stripe_customers')
      .where({ tenant: session.user.tenant })
      .first();

    if (!customer) {
      return {
        success: false,
        error: 'No customer record found',
      };
    }

    // Create billing portal session
    const stripe = (stripeService as any).stripe;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_external_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/msp/settings?tab=account`,
    });

    return {
      success: true,
      data: {
        portal_url: portalSession.url,
      },
    };
  } catch (error) {
    logger.error('[createCustomerPortalSessionAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create portal session',
    };
  }
}

/**
 * Cancel subscription at period end
 * Updates the subscription to cancel at the end of the current billing period
 */
export async function cancelSubscriptionAction(): Promise<ICancelSubscriptionResponse> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    const knex = await getConnection(session.user.tenant);
    const stripeService = getStripeService();

    // Get active subscription
    const subscription = await knex<IStripeSubscription>('stripe_subscriptions')
      .where({
        tenant: session.user.tenant,
        status: 'active',
      })
      .first();

    if (!subscription) {
      return {
        success: false,
        error: 'No active subscription found',
      };
    }

    // Cancel subscription at period end via Stripe
    const stripe = (stripeService as any).stripe;
    const updatedSubscription = await stripe.subscriptions.update(
      subscription.stripe_subscription_external_id,
      {
        cancel_at_period_end: true,
      }
    );

    // Update local database
    await knex<IStripeSubscription>('stripe_subscriptions')
      .where({
        stripe_subscription_id: subscription.stripe_subscription_id,
      })
      .update({
        cancel_at: new Date(updatedSubscription.cancel_at * 1000),
        updated_at: knex.fn.now(),
      });

    logger.info(
      `[cancelSubscriptionAction] Subscription ${subscription.stripe_subscription_external_id} set to cancel at period end for tenant ${session.user.tenant}`
    );

    return {
      success: true,
      data: {
        subscription_id: subscription.stripe_subscription_external_id,
        cancel_at: new Date(updatedSubscription.cancel_at * 1000).toISOString(),
      },
    };
  } catch (error) {
    logger.error('[cancelSubscriptionAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel subscription',
    };
  }
}

'use server';

import { getLicenseUsage, type LicenseUsage } from '../license/get-license-usage';
import { getSession } from '@/lib/auth/getSession';
import { getStripeService } from '../stripe/StripeService';
import { getConnection } from '@/lib/db/db';
import logger from '@alga-psa/core/logger';
import {
  IGetSubscriptionInfoResponse,
  IGetPaymentMethodResponse,
  IGetInvoicesResponse,
  IUpdatePaymentMethodResponse,
  ICancelSubscriptionResponse,
  IStripeSubscription,
  IStripePrice,
  IStripeCustomer,
  IScheduledLicenseChange,
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

    // Validate quantity - must be a positive integer
    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        success: false,
        error: 'License quantity must be a positive integer (minimum 1)',
      };
    }

    if (quantity > 100000) {
      return {
        success: false,
        error: 'License quantity exceeds maximum allowed (100,000)',
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

    // Validate quantity - must be a positive integer
    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        success: false,
        error: 'License quantity must be a positive integer (minimum 1)',
      };
    }

    // Additional safety check for unreasonably large values
    if (quantity > 100000) {
      return {
        success: false,
        error: 'License quantity exceeds maximum allowed (100,000)',
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
        publishableKey: await stripeService.getPublishableKey(),
      },
    };
  } catch (error: any) {
    logger.error('[createLicenseCheckoutSessionAction] Error processing license update:', error);

    // Handle Stripe payment errors with user-friendly messages
    let errorMessage = 'Failed to process license update';

    if (error instanceof Error) {
      // Check for Stripe-specific payment failure errors
      if (error.message.includes('payment') || error.message.includes('PaymentIntent')) {
        errorMessage = 'Payment failed. Please check your payment method and try again.';
      } else if (error.message.includes('card')) {
        errorMessage = 'Your card was declined. Please update your payment method and try again.';
      } else if (error.message.includes('insufficient')) {
        errorMessage = 'Payment failed due to insufficient funds. Please try a different payment method.';
      } else {
        errorMessage = error.message;
      }
    }

    // Also check Stripe error codes if available
    if (error?.code === 'card_declined' || error?.decline_code) {
      errorMessage = 'Your card was declined. Please update your payment method and try again.';
    } else if (error?.code === 'insufficient_funds') {
      errorMessage = 'Payment failed due to insufficient funds. Please try a different payment method.';
    } else if (error?.code === 'expired_card') {
      errorMessage = 'Your card has expired. Please update your payment method and try again.';
    }

    return {
      success: false,
      error: errorMessage,
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

    // Fetch pricing from Stripe API using the price ID
    const stripeService = getStripeService();
    const stripe = await stripeService.getStripeClient();

    const price = await stripe.prices.retrieve(licensePriceId);

    if (!price) {
      return {
        success: false,
        error: 'Failed to retrieve price from Stripe',
      };
    }

    return {
      success: true,
      data: {
        priceId: price.id,
        unitAmount: price.unit_amount || 0,
        currency: price.currency,
        interval: price.recurring?.interval || 'month',
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
    const stripe = await stripeService.getStripeClient();
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
    const stripe = await stripeService.getStripeClient();
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
    const stripe = await stripeService.getStripeClient();
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
 * Submit cancellation feedback
 * Sends feedback email to support (does NOT actually cancel the subscription)
 */
export async function sendCancellationFeedbackAction(
  reasonText: string,
  reasonCategory?: string
): Promise<{
  success: boolean;
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

    const knex = await getConnection(session.user.tenant);

    // Get subscription details
    const subscription = await knex<IStripeSubscription>('stripe_subscriptions')
      .where({ tenant: session.user.tenant, status: 'active' })
      .first();

    if (!subscription) {
      return {
        success: false,
        error: 'No active subscription found',
      };
    }

    // Get pricing info
    const price = await knex<IStripePrice>('stripe_prices')
      .where({ stripe_price_id: subscription.stripe_price_id })
      .first();

    const monthlyCost = price ? (price.unit_amount / 100) * subscription.quantity : 0;

    // Get tenant info
    const tenant = await knex('tenants')
      .where({ tenant: session.user.tenant })
      .first('client_name', 'email');

    // Import the email function dynamically
    const { sendCancellationFeedbackEmail } = await import('../../../../../server/src/lib/email/sendCancellationFeedbackEmail');

    // Send email to support
    await sendCancellationFeedbackEmail({
      tenantName: tenant?.client_name || 'Unknown',
      tenantEmail: tenant?.email || session.user.email,
      reasonText,
      reasonCategory,
      licenseCount: subscription.quantity,
      monthlyCost,
      cancelAt: (() => {
        const periodEnd = subscription.current_period_end;
        return periodEnd
          ? new Date(periodEnd).toLocaleDateString()
          : 'unknown';
      })(),
    });

    logger.info(
      `[sendCancellationFeedbackAction] Cancellation feedback sent for tenant ${session.user.tenant}`
    );

    return {
      success: true,
    };
  } catch (error) {
    logger.error('[sendCancellationFeedbackAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send cancellation feedback',
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
    const stripe = await stripeService.getStripeClient();
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
        cancel_at: updatedSubscription.cancel_at ? new Date(updatedSubscription.cancel_at * 1000).toISOString() : null,
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

/**
 * Get count of active (non-deactivated) internal users for a tenant
 * Used for validating license reductions
 */
export async function getActiveUserCount(tenantId: string): Promise<number> {
  const knex = await getConnection(tenantId);

  const result = await knex('users')
    .where({
      tenant: tenantId,
      user_type: 'internal',
      is_inactive: false
    })
    .count('user_id as count')
    .first();

  return parseInt(result?.count as string || '0', 10);
}

/**
 * Reduce license count with validation
 * - Validates new quantity < current quantity
 * - Checks active user count constraint
 * - Schedules reduction at period end (Stripe handles automatically)
 */
export async function reduceLicenseCount(
  tenantId: string,
  newQuantity: number
): Promise<{
  success: boolean;
  data?: {
    scheduledChange: boolean;
    effectiveDate: string;
    currentQuantity: number;
    newQuantity: number;
    creditAmount?: number;
    currency?: string;
  };
  error?: string;
  needsDeactivation?: boolean;
  activeUserCount?: number;
  requestedQuantity?: number;
}> {
  try {
    logger.info(
      `[reduceLicenseCount] Processing license reduction for tenant ${tenantId}, new quantity: ${newQuantity}`
    );

    // Validate new quantity is a positive integer
    if (!Number.isInteger(newQuantity) || newQuantity < 1) {
      return {
        success: false,
        error: 'License quantity must be a positive integer (minimum 1)',
      };
    }

    // Additional safety check for unreasonably large values
    if (newQuantity > 100000) {
      return {
        success: false,
        error: 'License quantity exceeds maximum allowed (100,000)',
      };
    }

    const knex = await getConnection(tenantId);

    // Get current license count
    const tenant = await knex('tenants')
      .where({ tenant: tenantId })
      .first('licensed_user_count');

    if (!tenant) {
      return {
        success: false,
        error: 'Tenant not found',
      };
    }

    const currentQuantity = tenant.licensed_user_count || 0;

    // Validate this is actually a reduction
    if (newQuantity >= currentQuantity) {
      return {
        success: false,
        error: `Cannot reduce licenses. Current: ${currentQuantity}, Requested: ${newQuantity}. Use the 'Add Licenses' flow to increase licenses.`,
      };
    }

    // Check active user count
    const activeUserCount = await getActiveUserCount(tenantId);

    if (newQuantity < activeUserCount) {
      const usersToDeactivate = activeUserCount - newQuantity;
      return {
        success: false,
        error: `Cannot reduce to ${newQuantity} licenses. You have ${activeUserCount} active users. Please deactivate ${usersToDeactivate} user${usersToDeactivate > 1 ? 's' : ''} first.`,
        needsDeactivation: true,
        activeUserCount,
        requestedQuantity: newQuantity,
      };
    }

    // Use StripeService to update subscription (scheduled for period end)
    const stripeService = getStripeService();
    const result = await stripeService.updateOrCreateLicenseSubscription(tenantId, newQuantity);

    if (result.type !== 'updated') {
      return {
        success: false,
        error: 'Unexpected result from subscription update',
      };
    }

    // Get subscription details for effective date
    const subscription = await knex<IStripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        status: 'active',
      })
      .first();

    if (!subscription || !subscription.current_period_end) {
      return {
        success: false,
        error: 'Could not determine effective date for license reduction',
      };
    }

    const effectiveDate = new Date(subscription.current_period_end).toISOString();

    logger.info(
      `[reduceLicenseCount] Successfully scheduled license reduction for tenant ${tenantId} from ${currentQuantity} to ${newQuantity}, effective ${effectiveDate}`
    );

    return {
      success: true,
      data: {
        scheduledChange: true,
        effectiveDate,
        currentQuantity,
        newQuantity,
      },
    };
  } catch (error) {
    logger.error('[reduceLicenseCount] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reduce license count',
    };
  }
}

/**
 * Server action to reduce license count for the current tenant
 * Validates and schedules license reduction at period end
 */
export async function reduceLicenseCountAction(
  newQuantity: number
): Promise<{
  success: boolean;
  data?: {
    scheduledChange: boolean;
    effectiveDate: string;
    currentQuantity: number;
    newQuantity: number;
    creditAmount?: number;
    currency?: string;
  };
  error?: string;
  needsDeactivation?: boolean;
  activeUserCount?: number;
  requestedQuantity?: number;
}> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    logger.info(
      `[reduceLicenseCountAction] Reducing licenses for tenant ${session.user.tenant} to ${newQuantity}`
    );

    return await reduceLicenseCount(session.user.tenant, newQuantity);
  } catch (error) {
    logger.error('[reduceLicenseCountAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reduce license count',
    };
  }
}

/**
 * Get scheduled license changes for the current tenant
 * Returns information about any pending license reductions
 */
export async function getScheduledLicenseChangesAction(): Promise<{
  success: boolean;
  data?: IScheduledLicenseChange | null;
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

    logger.info(`[getScheduledLicenseChangesAction] Getting scheduled changes for tenant ${session.user.tenant}`);

    const stripeService = getStripeService();
    const scheduledChanges = await stripeService.getScheduledLicenseChanges(session.user.tenant);

    if (!scheduledChanges) {
      return {
        success: true,
        data: null,
      };
    }

    // Convert to interface format with ISO date string
    return {
      success: true,
      data: {
        current_quantity: scheduledChanges.current_quantity,
        scheduled_quantity: scheduledChanges.scheduled_quantity,
        effective_date: scheduledChanges.effective_date.toISOString(),
        current_monthly_cost: scheduledChanges.current_monthly_cost,
        scheduled_monthly_cost: scheduledChanges.scheduled_monthly_cost,
        monthly_savings: scheduledChanges.monthly_savings,
      },
    };
  } catch (error) {
    logger.error('[getScheduledLicenseChangesAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get scheduled license changes',
    };
  }
}

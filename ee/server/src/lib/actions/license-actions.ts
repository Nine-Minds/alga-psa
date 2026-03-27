'use server';

import { getLicenseUsage, type LicenseUsage } from '../license/get-license-usage';
import { getSession } from '@alga-psa/auth';
import type { AddOnKey } from '@alga-psa/types';
import { checkAccountManagementPermission } from '@alga-psa/auth/actions';
import { getStripeService } from '../stripe/StripeService';
import { getConnection } from '@/lib/db/db';
import logger from '@alga-psa/core/logger';
import { sendCancellationRequestEmail } from '@alga-psa/email/sendCancellationRequestEmail';
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
    if (!(await stripeService.isConfigured())) {
      return {
        success: false,
        error: 'Stripe billing is not configured',
      };
    }
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
        billing_interval: subscription.billing_interval || 'month',
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
    if (!(await stripeService.isConfigured())) {
      return {
        success: false,
        error: 'Stripe billing is not configured',
      };
    }

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
    if (!(await stripeService.isConfigured())) {
      return {
        success: true,
        data: [],
      };
    }

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
    if (!(await stripeService.isConfigured())) {
      return {
        success: false,
        error: 'Stripe billing is not configured',
      };
    }

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
    const { sendCancellationFeedbackEmail } = await import('@alga-psa/email');

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
    if (!(await stripeService.isConfigured())) {
      return {
        success: false,
        error: 'Stripe billing is not configured',
      };
    }

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

    // If the subscription has an attached schedule (e.g. from a pending license decrease),
    // release it first — the schedule is irrelevant if the user is canceling entirely.
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripe_subscription_external_id
    );
    if (stripeSubscription.schedule) {
      const scheduleId = typeof stripeSubscription.schedule === 'string'
        ? stripeSubscription.schedule
        : stripeSubscription.schedule.id;
      try {
        logger.info(
          `[cancelSubscriptionAction][tenant=${session.user.tenant}] Releasing subscription schedule ${scheduleId} before cancellation`
        );
        await stripe.subscriptionSchedules.release(scheduleId);
      } catch (releaseError) {
        throw new Error(
          `Failed to release subscription schedule ${scheduleId}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
        );
      }
    }

    const updatedSubscription = await stripe.subscriptions.update(
      subscription.stripe_subscription_external_id,
      {
        cancel_at_period_end: true,
      }
    );

    // Update local database (clear schedule metadata if present)
    const { scheduled_quantity, schedule_id, ...remainingMetadata } = subscription.metadata || {};
    await knex<IStripeSubscription>('stripe_subscriptions')
      .where({
        stripe_subscription_id: subscription.stripe_subscription_id,
      })
      .update({
        cancel_at: updatedSubscription.cancel_at ? new Date(updatedSubscription.cancel_at * 1000).toISOString() : null,
        metadata: Object.keys(remainingMetadata).length > 0 ? remainingMetadata : null,
        updated_at: knex.fn.now(),
      });

    const cancelAtDate = new Date(updatedSubscription.cancel_at * 1000).toISOString();

    logger.info(
      `[cancelSubscriptionAction][tenant=${session.user.tenant}] Subscription ${subscription.stripe_subscription_external_id} set to cancel at period end`
    );

    // Send cancellation request received email (fire-and-forget, don't block the response)
    try {
      const tenant = await knex('tenants')
        .select('email', 'client_name', 'company_name')
        .where({ tenant: session.user.tenant })
        .first();

      if (tenant?.email) {
        const tenantName = tenant.company_name || tenant.client_name || 'your organization';
        await sendCancellationRequestEmail({
          tenantName,
          recipientName: tenant.client_name || tenantName,
          recipientEmail: tenant.email,
          cancelAtDate,
        });
        logger.info(
          `[cancelSubscriptionAction][tenant=${session.user.tenant}] Cancellation request email sent to ${tenant.email}`
        );
      }
    } catch (emailError) {
      // Don't fail the cancellation if email fails
      logger.warn('[cancelSubscriptionAction] Failed to send cancellation request email:', emailError);
    }

    return {
      success: true,
      data: {
        subscription_id: subscription.stripe_subscription_external_id,
        cancel_at: cancelAtDate,
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
    if (!(await stripeService.isConfigured())) {
      return {
        success: true,
        data: null,
      };
    }
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

/**
 * Upgrade the tenant's subscription to a new tier.
 * Modifies the Stripe subscription items directly (no redirect to Stripe).
 */
export async function upgradeTierAction(
  targetTier: 'pro' | 'premium',
  interval: 'month' | 'year' = 'month'
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const hasPermission = await checkAccountManagementPermission();
    if (!hasPermission) {
      return { success: false, error: 'You do not have permission to change the subscription plan' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    const result = await stripeService.upgradeTier(session.user.tenant, targetTier, interval);
    return result;
  } catch (error) {
    logger.error('[upgradeTierAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upgrade plan',
    };
  }
}

/**
 * Downgrade the tenant's subscription to Solo.
 * Validates active user count in the Stripe service before changing pricing.
 */
export async function downgradeTierAction(
  interval: 'month' | 'year' = 'month'
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const hasPermission = await checkAccountManagementPermission();
    if (!hasPermission) {
      return { success: false, error: 'You do not have permission to change the subscription plan' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    return await stripeService.downgradeTier(session.user.tenant, interval);
  } catch (error) {
    logger.error('[downgradeTierAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to downgrade plan',
    };
  }
}

/**
 * Create an embedded Stripe checkout session for an add-on purchase.
 */
export async function purchaseAddOnAction(
  addOn: AddOnKey,
  interval: 'month' | 'year' = 'month'
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
      return { success: false, error: 'Not authenticated' };
    }

    const hasPermission = await checkAccountManagementPermission();
    if (!hasPermission) {
      return { success: false, error: 'You do not have permission to manage add-ons' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    const result = await stripeService.purchaseAddOn(session.user.tenant, addOn, interval);
    if (!result.success || !result.clientSecret || !result.sessionId) {
      return { success: false, error: result.error || 'Failed to create add-on checkout session' };
    }

    return {
      success: true,
      data: {
        clientSecret: result.clientSecret,
        sessionId: result.sessionId,
        publishableKey: await stripeService.getPublishableKey(),
      },
    };
  } catch (error) {
    logger.error('[purchaseAddOnAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to purchase add-on',
    };
  }
}

/**
 * Cancel an active add-on subscription for the current tenant.
 */
export async function cancelAddOnAction(
  addOn: AddOnKey
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const hasPermission = await checkAccountManagementPermission();
    if (!hasPermission) {
      return { success: false, error: 'You do not have permission to manage add-ons' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    return await stripeService.cancelAddOn(session.user.tenant, addOn);
  } catch (error) {
    logger.error('[cancelAddOnAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel add-on',
    };
  }
}

/**
 * Get a preview of what upgrading to a new tier will cost.
 * Used by the UI to show a confirmation dialog before charging.
 */
export async function getUpgradePreviewAction(
  targetTier: 'pro' | 'premium',
  interval: 'month' | 'year' = 'month'
): Promise<{
  success: boolean;
  error?: string;
  currentMonthly?: number;
  newBasePrice?: number;
  newUserPrice?: number;
  newMonthly?: number;
  userCount?: number;
  currency?: string;
  prorationAmount?: number;
  annualAvailable?: boolean;
  annualBasePrice?: number;
  annualUserPrice?: number;
  annualTotal?: number;
}> {
  try {
    const session = await getSession();
    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    return await stripeService.getUpgradePreview(session.user.tenant, targetTier, interval);
  } catch (error) {
    logger.error('[getUpgradePreviewAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get upgrade preview',
    };
  }
}

/**
 * Switch billing interval (monthly <-> annual) at end of current period
 */
export async function switchBillingIntervalAction(
  newInterval: 'month' | 'year'
): Promise<{ success: boolean; error?: string; effectiveDate?: string }> {
  try {
    const session = await getSession();
    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const hasPermission = await checkAccountManagementPermission();
    if (!hasPermission) {
      return { success: false, error: 'You do not have permission to change the billing interval' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    return await stripeService.switchBillingInterval(session.user.tenant, newInterval);
  } catch (error) {
    logger.error('[switchBillingIntervalAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to switch billing interval',
    };
  }
}

/**
 * Get a preview of switching billing interval
 */
export async function getIntervalSwitchPreviewAction(
  newInterval: 'month' | 'year'
): Promise<{
  success: boolean;
  error?: string;
  currentInterval?: 'month' | 'year';
  currentTotal?: number;
  newTotal?: number;
  newBasePrice?: number;
  newUserPrice?: number;
  userCount?: number;
  effectiveDate?: string;
  savingsPercent?: number;
}> {
  try {
    const session = await getSession();
    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    return await stripeService.getIntervalSwitchPreview(session.user.tenant, newInterval);
  } catch (error) {
    logger.error('[getIntervalSwitchPreviewAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get interval switch preview',
    };
  }
}

/**
 * Start a 30-day Premium trial for a tenant.
 * Called by Nine Minds admin via the extension.
 * Requires master tenant session.
 */
export async function startPremiumTrialAction(
  targetTenantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession();
    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    // Only the master tenant can start trials for other tenants
    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    const masterTenantId = process.env.STRIPE_MASTER_TENANT_ID || process.env.MASTER_TENANT_ID;
    if (session.user.tenant !== masterTenantId) {
      return { success: false, error: 'Only the master tenant can start Premium trials' };
    }

    return await stripeService.startPremiumTrial(targetTenantId);
  } catch (error) {
    logger.error('[startPremiumTrialAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start Premium trial',
    };
  }
}

/**
 * Self-service Premium trial for paying Pro customers.
 * Unlike startPremiumTrialAction (admin-only), this lets the tenant start their own trial.
 * Only allowed for tenants with an active (non-trialing) Pro subscription.
 *
 * The trial keeps Pro prices on Stripe — no billing change during the 30 days.
 * User must explicitly confirm conversion to Premium before trial ends.
 */
export async function startSelfServicePremiumTrialAction(): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession();
    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const hasPermission = await checkAccountManagementPermission();
    if (!hasPermission) {
      return { success: false, error: 'You do not have permission to manage the subscription' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    // Verify the tenant is on an active (non-trialing) Pro subscription
    const knex = await getConnection(session.user.tenant);
    const subscription = await knex<IStripeSubscription>('stripe_subscriptions')
      .where('tenant', session.user.tenant)
      .whereIn('status', ['active', 'trialing'])
      .first();

    if (!subscription) {
      return { success: false, error: 'No active subscription found' };
    }

    if (subscription.status === 'trialing') {
      return { success: false, error: 'Cannot self-start a Premium trial while on a Pro trial. Please contact support.' };
    }

    // Check if already on a Premium trial
    const metadata = subscription.metadata || {};
    if (metadata.premium_trial === 'true') {
      return { success: false, error: 'A Premium trial is already active' };
    }

    return await stripeService.startPremiumTrial(session.user.tenant);
  } catch (error) {
    logger.error('[startSelfServicePremiumTrialAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start Premium trial',
    };
  }
}

/**
 * Confirm conversion to Premium after a 30-day trial.
 * The user has seen the pricing and explicitly agrees to switch.
 * This swaps Stripe subscription items from Pro to Premium prices.
 */
export async function confirmPremiumTrialAction(
  interval: 'month' | 'year' = 'month'
): Promise<{ success: boolean; error?: string; effectiveDate?: string }> {
  try {
    const session = await getSession();
    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const hasPermission = await checkAccountManagementPermission();
    if (!hasPermission) {
      return { success: false, error: 'You do not have permission to manage the subscription' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    return await stripeService.confirmPremiumTrial(session.user.tenant, interval);
  } catch (error) {
    logger.error('[confirmPremiumTrialAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to confirm Premium upgrade',
    };
  }
}

/**
 * Cancel/revert a Premium trial. Flips tenant back to Pro.
 * Since Pro prices were kept on Stripe during trial, no Stripe item changes needed.
 */
export async function revertPremiumTrialAction(): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession();
    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const hasPermission = await checkAccountManagementPermission();
    if (!hasPermission) {
      return { success: false, error: 'You do not have permission to manage the subscription' };
    }

    const stripeService = getStripeService();
    if (!(await stripeService.isConfigured())) {
      return { success: false, error: 'Stripe billing is not configured' };
    }

    return await stripeService.revertPremiumTrial(session.user.tenant);
  } catch (error) {
    logger.error('[revertPremiumTrialAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel Premium trial',
    };
  }
}

/**
 * Send a Premium trial request email to Nine Minds.
 * Called by tenants who want to try Premium.
 */
export async function sendPremiumTrialRequestAction(
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession();
    if (!session?.user?.tenant) {
      return { success: false, error: 'Not authenticated' };
    }

    const knex = await getConnection(session.user.tenant);
    const tenant = await knex('tenants')
      .where('tenant', session.user.tenant)
      .select('tenant', 'client_name', 'email', 'plan')
      .first();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    // Send email to Nine Minds support
    const { sendPremiumTrialRequestEmail } = await import('@alga-psa/email');
    await sendPremiumTrialRequestEmail({
      tenantId: session.user.tenant,
      tenantName: tenant.client_name || 'Unknown',
      tenantEmail: tenant.email || session.user.email,
      currentPlan: tenant.plan || 'unknown',
      requestedByName: session.user.name || 'Unknown',
      requestedByEmail: session.user.email || '',
      message,
    });

    logger.info(`[sendPremiumTrialRequestAction] Premium trial request sent for tenant ${session.user.tenant}`);
    return { success: true };
  } catch (error) {
    logger.error('[sendPremiumTrialRequestAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send trial request',
    };
  }
}

/**
 * StripeService - Handles all Stripe integration logic for AlgaPSA
 *
 * Phase 1: License purchasing for Nine Minds customers
 * Phase 2: Multi-tenant billing with Stripe Connect
 *
 * Key responsibilities:
 * - Customer management (create, import, sync)
 * - Checkout session creation (embedded mode)
 * - Subscription management (create, update, cancel)
 * - Webhook event processing
 * - Database synchronization
 */

import Stripe from 'stripe';
import { Knex } from 'knex';
import { getConnection } from '@/lib/db/db';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { startTenantDeletionWorkflow } from '@ee/lib/tenant-management/workflowClient';
import type { TenantTier } from '@alga-psa/types';
import { tierFromStripeProduct } from './stripeTierMapping';

// Stripe configuration with secret provider support
async function getStripeConfig() {
  const secretProvider = await getSecretProviderInstance();

  // Get secrets using the secret provider system (supports env, filesystem, vault)
  // Try secret provider first, fall back to environment variables
  let secretKey = await secretProvider.getAppSecret('stripe_secret_key');
  if (!secretKey && process.env.STRIPE_SECRET_KEY) {
    secretKey = process.env.STRIPE_SECRET_KEY;
  }

  let webhookSecret = await secretProvider.getAppSecret('stripe_webhook_secret');
  if (!webhookSecret && process.env.STRIPE_WEBHOOK_SECRET) {
    webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  }

  let publishableKey = await secretProvider.getAppSecret('stripe_publishable_key');
  if (!publishableKey && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  }

  // These are non-sensitive config, can come from env vars
  const masterTenantId = process.env.MASTER_BILLING_TENANT_ID;
  const licenseProductId = process.env.STRIPE_LICENSE_PRODUCT_ID;
  const licensePriceId = process.env.STRIPE_LICENSE_PRICE_ID;

  // Tier-specific prices (optional — null means legacy single-item mode)
  const proBasePriceId = process.env.STRIPE_PRO_BASE_PRICE_ID || null;
  const proUserPriceId = process.env.STRIPE_PRO_USER_PRICE_ID || null;
  const soloBasePriceId = process.env.STRIPE_SOLO_BASE_PRICE_ID || null;
  const premiumBasePriceId = process.env.STRIPE_PREMIUM_BASE_PRICE_ID || null;
  const premiumUserPriceId = process.env.STRIPE_PREMIUM_USER_PRICE_ID || null;

  // Annual prices (pay for 10 months, get 12 — ~17% discount)
  const proBaseAnnualPriceId = process.env.STRIPE_PRO_BASE_ANNUAL_PRICE_ID || null;
  const proUserAnnualPriceId = process.env.STRIPE_PRO_USER_ANNUAL_PRICE_ID || null;
  const soloBaseAnnualPriceId = process.env.STRIPE_SOLO_BASE_ANNUAL_PRICE_ID || null;
  const premiumBaseAnnualPriceId = process.env.STRIPE_PREMIUM_BASE_ANNUAL_PRICE_ID || null;
  const premiumUserAnnualPriceId = process.env.STRIPE_PREMIUM_USER_ANNUAL_PRICE_ID || null;
  const aiAddOnPriceId = process.env.STRIPE_AI_ADDON_PRICE_ID || null;
  const aiAddOnAnnualPriceId = process.env.STRIPE_AI_ADDON_ANNUAL_PRICE_ID || null;

  // Early adopters prices (grandfathered customers migrated from preview)
  const earlyAdoptersBasePriceId = process.env.STRIPE_EARLY_ADOPTERS_BASE_PRICE_ID || null;
  const earlyAdoptersUserPriceId = process.env.STRIPE_EARLY_ADOPTERS_USER_PRICE_ID || null;
  const earlyAdoptersBaseAnnualPriceId = process.env.STRIPE_EARLY_ADOPTERS_BASE_ANNUAL_PRICE_ID || null;
  const earlyAdoptersUserAnnualPriceId = process.env.STRIPE_EARLY_ADOPTERS_USER_ANNUAL_PRICE_ID || null;

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not found in secrets or environment');
  }

  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET not found in secrets or environment');
  }

  if (!publishableKey) {
    throw new Error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY not found in secrets or environment');
  }

  if (!masterTenantId) {
    throw new Error('MASTER_BILLING_TENANT_ID environment variable is required');
  }

  return {
    secretKey,
    webhookSecret,
    publishableKey,
    masterTenantId,
    licenseProductId,
    licensePriceId,
    proBasePriceId,
    proUserPriceId,
    soloBasePriceId,
    premiumBasePriceId,
    premiumUserPriceId,
    proBaseAnnualPriceId,
    proUserAnnualPriceId,
    soloBaseAnnualPriceId,
    premiumBaseAnnualPriceId,
    premiumUserAnnualPriceId,
    aiAddOnPriceId,
    aiAddOnAnnualPriceId,
    earlyAdoptersBasePriceId,
    earlyAdoptersUserPriceId,
    earlyAdoptersBaseAnnualPriceId,
    earlyAdoptersUserAnnualPriceId,
  };
}

// Database types
interface StripeCustomer {
  tenant: string;
  stripe_customer_id: string;
  stripe_customer_external_id: string;
  billing_tenant: string | null;
  email: string;
  name: string | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

interface StripeProduct {
  tenant: string;
  stripe_product_id: string;
  stripe_product_external_id: string;
  billing_tenant: string | null;
  name: string;
  description: string | null;
  product_type: 'license' | 'service' | 'addon';
  is_active: boolean;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

interface StripePrice {
  tenant: string;
  stripe_price_id: string;
  stripe_price_external_id: string;
  stripe_product_id: string;
  unit_amount: number;
  currency: string;
  recurring_interval: 'month' | 'year' | null;
  recurring_interval_count: number;
  is_active: boolean;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

interface StripeSubscription {
  tenant: string;
  stripe_subscription_id: string;
  stripe_subscription_external_id: string;
  stripe_subscription_item_id: string | null;
  stripe_customer_id: string;
  stripe_price_id: string;
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  quantity: number;
  stripe_base_item_id: string | null;
  stripe_base_price_id: string | null;
  billing_interval: 'month' | 'year';
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at: Date | null;
  canceled_at: Date | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

type TierPriceIds = {
  basePriceId: string;
  userPriceId: string | null;
};

export class StripeService {
  private stripe!: Stripe;
  private config!: Awaited<ReturnType<typeof getStripeConfig>>;
  private initPromise: Promise<void> | null = null;

  private async initialize() {
    this.config = await getStripeConfig();
    this.stripe = new Stripe(this.config.secretKey, {
      apiVersion: '2024-12-18.acacia' as any,
      typescript: true,
    });
  }

  private async ensureInitialized() {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }

    await this.initPromise;
  }

  /**
   * Get the initialized Stripe client
   * Use this instead of directly accessing this.stripe to ensure initialization is complete
   */
  async getStripeClient(): Promise<Stripe> {
    await this.ensureInitialized();
    return this.stripe;
  }

  /**
   * Returns true if Stripe can be initialized in the current environment.
   * This is useful for gating optional billing UX in dev/test stacks.
   */
  async isConfigured(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get or import a Stripe customer for a tenant
   *
   * Strategy:
   * 1. Check if customer exists in our database
   * 2. If not, query Stripe API by tenant email
   * 3. Import customer and subscription data
   * 4. Return customer record
   */
  async getOrImportCustomer(tenantId: string): Promise<StripeCustomer> {
    await this.ensureInitialized();
    const knex = await getConnection(tenantId);

    // 1. Check database first
    let customer = await knex<StripeCustomer>('stripe_customers')
      .where({ tenant: tenantId })
      .first();

    if (customer) {
      logger.info(`[StripeService] Customer found in database for tenant ${tenantId}`);
      return customer;
    }

    // 2. Customer not in database, fetch tenant info and search Stripe
    logger.info(`[StripeService] Customer not in database, searching Stripe for tenant ${tenantId}`);

    const tenant = await knex('tenants')
      .where({ tenant: tenantId })
      .first();

    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    // 3. Search Stripe by email
    const stripeCustomers = await this.stripe.customers.list({
      email: tenant.email,
      limit: 1,
    });

    if (stripeCustomers.data.length === 0) {
      throw new Error(
        `No Stripe customer found for tenant ${tenantId} with email ${tenant.email}. ` +
        'This tenant may need to be created via nm-store first.'
      );
    }

    const stripeCustomer = stripeCustomers.data[0];

    // 4. Import customer data
    logger.info(`[StripeService] Importing Stripe customer ${stripeCustomer.id} for tenant ${tenantId}`);
    customer = await this.importStripeCustomer(tenantId, stripeCustomer.id, knex);

    // 5. Also import their active subscriptions
    await this.importCustomerSubscriptions(tenantId, stripeCustomer.id, knex);

    return customer;
  }

  /**
   * Import a Stripe customer into our database
   */
  private async importStripeCustomer(
    tenantId: string,
    stripeCustomerId: string,
    knex?: Knex
  ): Promise<StripeCustomer> {
    const db = knex || (await getConnection(tenantId));

    // Fetch customer from Stripe
    const stripeCustomerResponse = await this.stripe.customers.retrieve(stripeCustomerId);

    if (stripeCustomerResponse.deleted) {
      throw new Error(`Stripe customer ${stripeCustomerId} has been deleted`);
    }

    // Type assertion - we've confirmed it's not deleted
    const stripeCustomer = stripeCustomerResponse as Stripe.Customer;

    // Insert into database
    const [customer] = await db<StripeCustomer>('stripe_customers')
      .insert({
        tenant: tenantId,
        stripe_customer_external_id: stripeCustomer.id,
        billing_tenant: this.config.masterTenantId,
        email: stripeCustomer.email || '',
        name: stripeCustomer.name,
        metadata: {
          imported_at: new Date().toISOString(),
          source: 'stripe_import',
        },
      })
      .returning('*');

    logger.info(`[StripeService] Imported Stripe customer ${stripeCustomerId} for tenant ${tenantId}`);
    return customer;
  }

  /**
   * Import active subscriptions for a customer
   */
  private async importCustomerSubscriptions(
    tenantId: string,
    stripeCustomerId: string,
    knex?: Knex
  ): Promise<void> {
    const db = knex || (await getConnection(tenantId));

    // Get our customer record
    const customer = await db<StripeCustomer>('stripe_customers')
      .where({
        tenant: tenantId,
        stripe_customer_external_id: stripeCustomerId
      })
      .first();

    if (!customer) {
      throw new Error(`Customer ${stripeCustomerId} not found in database`);
    }

    // Fetch active subscriptions from Stripe
    const subscriptions = await this.stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'active',
      expand: ['data.items.data.price.product'],
    });

    logger.info(
      `[StripeService] Found ${subscriptions.data.length} active subscriptions for customer ${stripeCustomerId}`
    );

    // Import each subscription
    for (const subscription of subscriptions.data) {
      await this.importSubscription(tenantId, customer.stripe_customer_id, subscription, db);
    }
  }

  /**
   * Import a single subscription into our database
   */
  private async importSubscription(
    tenantId: string,
    customerInternalId: string,
    subscription: Stripe.Subscription,
    knex?: Knex
  ): Promise<void> {
    const db = knex || (await getConnection(tenantId));

    // Find the per-user item (works for both 1-item legacy and 2-item multi-tier subscriptions)
    const subscriptionItem = this.findUserItemFromStripe(subscription.items.data);
    if (!subscriptionItem) {
      logger.warn(`[StripeService] Subscription ${subscription.id} has no items, skipping`);
      return;
    }

    // Find the base fee item (if multi-item)
    const baseItem = subscription.items.data.find(item => item.id !== subscriptionItem.id);

    const price = subscriptionItem.price;
    const product = price.product as Stripe.Product;

    // Import product if not exists
    let dbProduct = await db<StripeProduct>('stripe_products')
      .where({
        tenant: tenantId,
        stripe_product_external_id: product.id,
      })
      .first();

    if (!dbProduct) {
      const [newProduct] = await db<StripeProduct>('stripe_products')
        .insert({
          tenant: tenantId,
          stripe_product_external_id: product.id,
          billing_tenant: this.config.masterTenantId,
          name: product.name,
          description: product.description,
          product_type: 'license', // Default to license for Phase 1
          is_active: product.active,
          metadata: product.metadata,
        })
        .returning('*');
      dbProduct = newProduct;
    }

    // Import price if not exists
    let dbPrice = await db<StripePrice>('stripe_prices')
      .where({
        tenant: tenantId,
        stripe_price_external_id: price.id,
      })
      .first();

    if (!dbPrice) {
      const interval = price.recurring?.interval;
      const recurringInterval = (interval === 'month' || interval === 'year') ? interval : null;

      const [newPrice] = await db<StripePrice>('stripe_prices')
        .insert({
          tenant: tenantId,
          stripe_price_external_id: price.id,
          stripe_product_id: dbProduct.stripe_product_id,
          unit_amount: price.unit_amount || 0,
          currency: price.currency,
          recurring_interval: recurringInterval,
          recurring_interval_count: price.recurring?.interval_count || 1,
          is_active: price.active,
          metadata: price.metadata,
        })
        .returning('*');
      dbPrice = newPrice;
    }

    // Import subscription
    const existingSubscription = await db<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_subscription_external_id: subscription.id,
      })
      .first();

    if (!existingSubscription) {
      // Import base fee item's price if present
      let dbBasePrice: StripePrice | undefined;
      if (baseItem) {
        const basePrice = baseItem.price;
        const baseProduct = basePrice.product as Stripe.Product;

        // Ensure base product exists
        let dbBaseProduct = await db<StripeProduct>('stripe_products')
          .where({ tenant: tenantId, stripe_product_external_id: baseProduct.id })
          .first();
        if (!dbBaseProduct) {
          const [newProduct] = await db<StripeProduct>('stripe_products')
            .insert({
              tenant: tenantId,
              stripe_product_external_id: baseProduct.id,
              billing_tenant: this.config.masterTenantId,
              name: baseProduct.name,
              description: baseProduct.description,
              product_type: 'license',
              is_active: baseProduct.active,
              metadata: baseProduct.metadata,
            })
            .returning('*');
          dbBaseProduct = newProduct;
        }

        dbBasePrice = await db<StripePrice>('stripe_prices')
          .where({ tenant: tenantId, stripe_price_external_id: basePrice.id })
          .first();
        if (!dbBasePrice) {
          const interval = basePrice.recurring?.interval;
          const recurringInterval = (interval === 'month' || interval === 'year') ? interval : null;
          const [newPrice] = await db<StripePrice>('stripe_prices')
            .insert({
              tenant: tenantId,
              stripe_price_external_id: basePrice.id,
              stripe_product_id: dbBaseProduct.stripe_product_id,
              unit_amount: basePrice.unit_amount || 0,
              currency: basePrice.currency,
              recurring_interval: recurringInterval,
              recurring_interval_count: basePrice.recurring?.interval_count || 1,
              is_active: basePrice.active,
              metadata: basePrice.metadata,
            })
            .returning('*');
          dbBasePrice = newPrice;
        }
      }

      // Derive billing interval from the subscription item's price
      const importedInterval = price.recurring?.interval;
      const billingInterval: 'month' | 'year' = (importedInterval === 'year') ? 'year' : 'month';

      await db<StripeSubscription>('stripe_subscriptions').insert({
        tenant: tenantId,
        stripe_subscription_external_id: subscription.id,
        stripe_subscription_item_id: subscriptionItem.id,
        stripe_customer_id: customerInternalId,
        stripe_price_id: dbPrice.stripe_price_id,
        status: subscription.status as 'active' | 'canceled' | 'past_due',
        quantity: subscriptionItem.quantity || 1,
        stripe_base_item_id: baseItem?.id || null,
        stripe_base_price_id: dbBasePrice?.stripe_price_id || null,
        billing_interval: billingInterval,
        current_period_start: new Date((subscription as any).current_period_start * 1000),
        current_period_end: new Date((subscription as any).current_period_end * 1000),
        cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
        canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        metadata: subscription.metadata,
      });

      logger.info(`[StripeService] Imported subscription ${subscription.id} for tenant ${tenantId} (${baseItem ? 'multi-item' : 'single-item'})`);
    } else {
      logger.info(`[StripeService] Subscription ${subscription.id} already exists, skipping`);
    }
  }

  /**
   * Get upcoming invoice preview for subscription change
   * Shows what the customer will be charged/credited
   */
  async getUpcomingInvoicePreview(
    tenantId: string,
    newQuantity: number
  ): Promise<{
    currentQuantity: number;
    newQuantity: number;
    isIncrease: boolean;
    amountDue: number;
    currency: string;
    currentPeriodEnd: Date;
    prorationAmount: number;
    remainingAmount: number;
  } | null> {
    await this.ensureInitialized();
    logger.info(`[StripeService] Getting invoice preview for tenant ${tenantId}, new quantity: ${newQuantity}`);

    const knex = await getConnection(tenantId);
    const customer = await this.getOrImportCustomer(tenantId);

    // Get existing subscription
    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
        status: 'active',
      })
      .first();

    if (!existingSubscription || !existingSubscription.stripe_subscription_item_id) {
      return null; // No existing subscription
    }

    const currentQuantity = existingSubscription.quantity;
    const isIncrease = newQuantity > currentQuantity;

    // Get upcoming invoice from Stripe
    const upcomingInvoice = await this.stripe.invoices.createPreview({
      customer: customer.stripe_customer_external_id,
      subscription: existingSubscription.stripe_subscription_external_id,
      subscription_details: {
        items: [
          {
            id: existingSubscription.stripe_subscription_item_id,
            quantity: newQuantity,
          },
        ],
        proration_behavior: isIncrease ? 'always_invoice' : 'none',
      },
    });

    // Calculate proration amount (difference between new and old)
    const prorationAmount = upcomingInvoice.lines.data
      .filter(line => (line as any).proration)
      .reduce((sum, line) => sum + line.amount, 0);

    return {
      currentQuantity,
      newQuantity,
      isIncrease,
      amountDue: upcomingInvoice.amount_due / 100, // Convert cents to dollars
      currency: upcomingInvoice.currency,
      currentPeriodEnd: existingSubscription.current_period_end || new Date(),
      prorationAmount: prorationAmount / 100,
      remainingAmount: upcomingInvoice.amount_remaining / 100,
    };
  }

  /**
   * Update existing subscription quantity or create checkout for new subscription
   *
   * IMPORTANT: Different behavior for increases vs decreases:
   * - Increase: Immediate change with prorated charge
   * - Decrease: Scheduled for end of billing period (no immediate credit)
   *
   * Returns either an updated subscription or checkout session details
   */
  async updateOrCreateLicenseSubscription(
    tenantId: string,
    quantity: number
  ): Promise<
    | { type: 'updated'; subscription: Stripe.Subscription; scheduledChange?: boolean }
    | { type: 'checkout'; clientSecret: string; sessionId: string }
  > {
    await this.ensureInitialized();
    logger.info(`[StripeService] Update or create subscription for tenant ${tenantId}, quantity: ${quantity}`);

    const knex = await getConnection(tenantId);

    // Get or import customer
    const customer = await this.getOrImportCustomer(tenantId);

    // Check for existing active subscription for the license price
    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
        status: 'active',
      })
      .first();

    if (existingSubscription && existingSubscription.stripe_subscription_item_id) {
      const currentQuantity = existingSubscription.quantity;
      const isIncrease = quantity > currentQuantity;

      logger.info(
        `[StripeService] Found existing subscription ${existingSubscription.stripe_subscription_external_id}, ` +
        `${isIncrease ? 'increasing' : 'decreasing'} from ${currentQuantity} to ${quantity}`
      );

      if (isIncrease) {
        // INCREASE: Immediate change with prorated charge
        // IMPORTANT: payment_behavior: 'error_if_incomplete' ensures the API call fails
        // if payment cannot be collected immediately, preventing license count updates
        // when payment fails (e.g., insufficient funds, expired card)
        const updatedSubscription = await this.stripe.subscriptions.update(
          existingSubscription.stripe_subscription_external_id,
          {
            items: [
              {
                id: existingSubscription.stripe_subscription_item_id,
                quantity,
              },
            ],
            proration_behavior: 'always_invoice', // Charge prorated amount now
            payment_behavior: 'error_if_incomplete', // Fail if payment cannot be collected
            metadata: {
              tenant_id: tenantId,
            },
          }
        );

        // Update database immediately for increases
        await knex<StripeSubscription>('stripe_subscriptions')
          .where({
            stripe_subscription_id: existingSubscription.stripe_subscription_id,
          })
          .update({
            quantity,
            updated_at: knex.fn.now(),
          });

        await knex('tenants')
          .where({ tenant: tenantId })
          .update({
            licensed_user_count: quantity,
            updated_at: knex.fn.now(),
          });

        logger.info(`[StripeService] Immediately increased subscription to ${quantity} licenses`);

        return {
          type: 'updated',
          subscription: updatedSubscription,
          scheduledChange: false,
        };
      } else {
        // DECREASE: Schedule change for end of billing period
        // Use subscription schedule to delay the change
        const currentPeriodEnd = existingSubscription.current_period_end;

        if (!currentPeriodEnd) {
          throw new Error('Current period end not found for subscription');
        }

        // Check if subscription already has a schedule attached
        const stripeSubscription = await this.stripe.subscriptions.retrieve(
          existingSubscription.stripe_subscription_external_id
        );

        let schedule: Stripe.SubscriptionSchedule;

        if (stripeSubscription.schedule) {
          // Schedule already exists, retrieve and update it
          logger.info(
            `[StripeService] Found existing schedule ${stripeSubscription.schedule} for subscription`
          );
          schedule = await this.stripe.subscriptionSchedules.retrieve(
            stripeSubscription.schedule as string
          );
        } else {
          // No schedule exists, create one
          schedule = await this.stripe.subscriptionSchedules.create({
            from_subscription: existingSubscription.stripe_subscription_external_id,
          });
        }

        // Get the current phase's start date to use as anchor
        const currentPhase = schedule.phases[0];
        if (!currentPhase) {
          throw new Error('Schedule has no phases');
        }

        // Build phase items — include base fee item if this is a multi-item subscription
        // Resolve price IDs based on the subscription's actual pricing level to preserve
        // early adopters pricing. Falls back to standard tier pricing if not on early adopters.
        const tenantRecord = await knex('tenants').where('tenant', tenantId).select('plan').first();
        const tenantTierPrices = this.getSubscriptionPriceIds(existingSubscription)
          || (tenantRecord?.plan ? this.getTierPriceIds(tenantRecord.plan) : null);

        const buildPhaseItems = (qty: number): Stripe.SubscriptionScheduleUpdateParams.Phase.Item[] => {
          if (existingSubscription.stripe_base_item_id && tenantTierPrices) {
            return this.buildTierLineItems(tenantTierPrices, qty) as Stripe.SubscriptionScheduleUpdateParams.Phase.Item[];
          }

          return [{ price: this.config.licensePriceId!, quantity: qty }];
        };

        // Step 2: Update the schedule with metadata, end behavior, and phases
        await this.stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: 'release',
          metadata: {
            tenant_id: tenantId,
          },
          phases: [
            // Phase 1: Keep current quantity until period end (use existing start_date)
            {
              items: buildPhaseItems(currentQuantity),
              start_date: currentPhase.start_date,
              end_date: Math.floor(currentPeriodEnd.getTime() / 1000),
              metadata: { tenant_id: tenantId },
            },
            // Phase 2: New quantity starting next period
            {
              items: buildPhaseItems(quantity),
              metadata: { tenant_id: tenantId },
            },
          ],
        });

        logger.info(
          `[StripeService] Scheduled subscription decrease to ${quantity} licenses at period end (${currentPeriodEnd.toISOString()})`
        );

        // Don't update database quantity yet - it will be updated by webhook when schedule activates
        // But store the scheduled change in metadata
        await knex<StripeSubscription>('stripe_subscriptions')
          .where({
            stripe_subscription_id: existingSubscription.stripe_subscription_id,
          })
          .update({
            metadata: {
              ...(existingSubscription.metadata || {}),
              scheduled_quantity: quantity,
              schedule_id: schedule.id,
            },
            updated_at: knex.fn.now(),
          });

        // Fetch the updated subscription to return
        const updatedSubscription = await this.stripe.subscriptions.retrieve(
          existingSubscription.stripe_subscription_external_id
        );

        return {
          type: 'updated',
          subscription: updatedSubscription,
          scheduledChange: true,
        };
      }
    }

    // No existing subscription, create checkout session
    logger.info(`[StripeService] No existing subscription found, creating checkout session`);
    return {
      type: 'checkout',
      ...(await this.createLicenseCheckoutSession(tenantId, quantity)),
    };
  }

  /**
   * Create an embedded checkout session for license purchase
   *
   * Returns clientSecret for embedding in UI
   */
  private async createLicenseCheckoutSession(
    tenantId: string,
    quantity: number,
    interval: 'month' | 'year' = 'month',
    trialDays?: number
  ): Promise<{ clientSecret: string; sessionId: string }> {
    logger.info(`[StripeService] Creating checkout session for tenant ${tenantId}, quantity: ${quantity}, interval: ${interval}${trialDays ? `, trial: ${trialDays}d` : ''}`);

    // Get or import customer
    const customer = await this.getOrImportCustomer(tenantId);

    // Resolve line items: use tier-specific base+user pricing if configured,
    // otherwise fall back to legacy single per-user price
    const knex = await getConnection(tenantId);
    const tenant = await knex('tenants').where('tenant', tenantId).select('plan').first();
    const tierPrices = tenant?.plan ? this.getTierPriceIds(tenant.plan, interval) : null;

    let line_items: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (tierPrices) {
      line_items = this.buildTierLineItems(tierPrices, quantity);
      logger.info(
        `[StripeService] Using ${tierPrices.userPriceId ? 'multi-item' : 'flat-rate'} checkout (tier: ${tenant.plan}, interval: ${interval})`
      );
    } else {
      // Legacy single-item: per-user only
      if (!this.config.licensePriceId) {
        throw new Error('STRIPE_LICENSE_PRICE_ID environment variable is not configured');
      }
      line_items = [
        { price: this.config.licensePriceId, quantity },
      ];
      logger.info(`[StripeService] Using legacy single-item checkout`);
    }

    // Create checkout session in embedded mode
    const session = await this.stripe.checkout.sessions.create({
      customer: customer.stripe_customer_external_id,
      ui_mode: 'embedded', // IMPORTANT: Embedded mode, not redirect
      mode: 'subscription',
      line_items,
      subscription_data: {
        ...(trialDays ? { trial_period_days: trialDays } : {}),
        metadata: {
          tenant_id: tenantId,
          source: 'algapsa_license_purchase',
          billing_interval: interval,
        },
      },
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/msp/licenses/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        tenant_id: tenantId,
        license_quantity: quantity.toString(),
        billing_interval: interval,
      },
    });

    if (!session.client_secret) {
      throw new Error('Stripe checkout session created without client_secret');
    }

    logger.info(`[StripeService] Checkout session created: ${session.id}`);

    return {
      clientSecret: session.client_secret,
      sessionId: session.id,
    };
  }

  /**
   * Handle webhook event from Stripe
   *
   * Processes events and updates database accordingly
   */
  async handleWebhookEvent(event: Stripe.Event, tenantId?: string): Promise<void> {
    await this.ensureInitialized();
    logger.info(`[StripeService] Processing webhook event: ${event.type} (${event.id})`);

    // For most events, we need to determine the tenant from the event data
    const eventTenantId = tenantId || (await this.getTenantIdFromEvent(event));

    if (!eventTenantId) {
      logger.error(`[StripeService] Could not determine tenant for event ${event.id}`);
      return;
    }

    const knex = await getConnection(eventTenantId);

    // Check idempotency
    const existingEvent = await knex('stripe_webhook_events')
      .where({
        tenant: eventTenantId,
        stripe_event_id: event.id,
      })
      .first();

    if (existingEvent && existingEvent.processed) {
      logger.info(`[StripeService] Event ${event.id} already processed, skipping`);
      return;
    }

    // Record event
    await knex('stripe_webhook_events')
      .insert({
        tenant: eventTenantId,
        stripe_event_id: event.id,
        event_type: event.type,
        event_data: event.data as any,
        processed: false,
        processing_status: 'processing',
      })
      .onConflict(['tenant', 'stripe_event_id'])
      .merge();

    try {
      // Process event based on type
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event, eventTenantId, knex);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event, eventTenantId, knex);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event, eventTenantId, knex);
          break;

        default:
          logger.info(`[StripeService] Unhandled event type: ${event.type}`);
      }

      // Mark as processed
      await knex('stripe_webhook_events')
        .where({
          tenant: eventTenantId,
          stripe_event_id: event.id,
        })
        .update({
          processed: true,
          processing_status: 'completed',
          processed_at: knex.fn.now(),
        });

      logger.info(`[StripeService] Successfully processed event ${event.id}`);
    } catch (error) {
      logger.error(`[StripeService] Error processing event ${event.id}:`, error);

      // Record error
      await knex('stripe_webhook_events')
        .where({
          tenant: eventTenantId,
          stripe_event_id: event.id,
        })
        .update({
          processed: false,
          processing_status: 'failed',
          processing_error: error instanceof Error ? error.message : String(error),
        });

      throw error;
    }
  }

  /**
   * Extract tenant ID from webhook event metadata
   */
  private async getTenantIdFromEvent(event: Stripe.Event): Promise<string | null> {
    // Try to get tenant_id from metadata
    const data = event.data.object as any;

    if (data.metadata?.tenant_id) {
      return data.metadata.tenant_id;
    }

    // For subscription events, check subscription metadata
    if (data.subscription) {
      const subscription = await this.stripe.subscriptions.retrieve(data.subscription as string);
      if (subscription.metadata?.tenant_id) {
        return subscription.metadata.tenant_id;
      }
    }

    // Try to find customer in database and get tenant
    if (data.customer) {
      const knex = await getConnection();
      const customer = await knex('stripe_customers')
        .where({ stripe_customer_external_id: data.customer })
        .first();

      if (customer) {
        return customer.tenant;
      }
    }

    return null;
  }

  /**
   * Handle checkout.session.completed event
   */
  private async handleCheckoutCompleted(
    event: Stripe.Event,
    tenantId: string,
    knex: Knex
  ): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;

    logger.info(`[StripeService] Checkout completed for session ${session.id}`);

    // Fetch the subscription
    if (!session.subscription) {
      logger.error(`[StripeService] Checkout session ${session.id} has no subscription`);
      return;
    }

    const subscription = await this.stripe.subscriptions.retrieve(session.subscription as string, {
      expand: ['items.data.price.product'],
    });

    // Get customer
    const customer = await knex<StripeCustomer>('stripe_customers')
      .where({
        tenant: tenantId,
        stripe_customer_external_id: session.customer as string,
      })
      .first();

    if (!customer) {
      logger.error(`[StripeService] Customer ${session.customer} not found for tenant ${tenantId}`);
      return;
    }

    // Import subscription
    await this.importSubscription(tenantId, customer.stripe_customer_id, subscription, knex);

    // Resolve plan from any item's product (all items share the same tier product)
    const anyItem = subscription.items.data[0];
    const product = anyItem?.price?.product as Stripe.Product | undefined;
    const productName = product?.name;
    const plan = tierFromStripeProduct(productName);
    const quantity = this.getLicensedUserCountFromStripeItems(subscription.items.data, plan);

    await knex('tenants')
      .where({ tenant: tenantId })
      .update({
        licensed_user_count: quantity,
        plan,
        updated_at: knex.fn.now(),
      });

    logger.info(`[StripeService] Updated tenant ${tenantId} licensed_user_count to ${quantity}, plan to ${plan}`);
  }

  /**
   * Handle customer.subscription.updated event
   */
  private async handleSubscriptionUpdated(
    event: Stripe.Event,
    tenantId: string,
    knex: Knex
  ): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    logger.info(`[StripeService] Subscription updated: ${subscription.id}`);

    // Update subscription in database
    const subscriptionItem = this.findUserItemFromStripe(subscription.items.data);
    const quantity = subscriptionItem?.quantity || 1;

    // Get existing subscription to check for scheduled changes
    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_subscription_external_id: subscription.id,
      })
      .first();

    // Check if this update matches a scheduled quantity change
    let updatedMetadata = subscription.metadata || {};
    if (existingSubscription?.metadata?.scheduled_quantity) {
      const scheduledQuantity = existingSubscription.metadata.scheduled_quantity;

      // If the quantity now matches the scheduled quantity, the schedule has activated
      if (quantity === scheduledQuantity) {
        logger.info(
          `[StripeService] Scheduled license change activated for subscription ${subscription.id}: ` +
          `${existingSubscription.quantity} -> ${quantity}`
        );

        // Clear the scheduled change metadata
        const { scheduled_quantity, schedule_id, ...remainingMetadata } = existingSubscription.metadata;
        updatedMetadata = remainingMetadata;
      }
    }

    // Derive billing interval from the subscription item's price
    const updatedInterval = subscriptionItem?.price?.recurring?.interval;
    const billingInterval: 'month' | 'year' = (updatedInterval === 'year') ? 'year' : 'month';

    await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_subscription_external_id: subscription.id,
      })
      .update({
        status: subscription.status as 'active' | 'canceled' | 'past_due',
        quantity,
        billing_interval: billingInterval,
        current_period_start: new Date((subscription as any).current_period_start * 1000),
        current_period_end: new Date((subscription as any).current_period_end * 1000),
        cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
        canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        metadata: updatedMetadata,
        updated_at: knex.fn.now(),
      });

    // Update tenant licensed_user_count and plan if subscription is active or trialing
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      // Resolve plan from product name
      let plan: TenantTier | undefined;
      try {
        const priceId = subscriptionItem?.price?.id;
        if (priceId) {
          const price = await this.stripe.prices.retrieve(priceId, { expand: ['product'] });
          const product = price.product as Stripe.Product | undefined;
          const productName = product?.name;
          plan = tierFromStripeProduct(productName);
        }
      } catch (error) {
        logger.warn(`[StripeService] Failed to resolve tier for subscription ${subscription.id}`, error);
      }

      const quantity = this.getLicensedUserCountFromStripeItems(subscription.items.data, plan);

      const updateData: Record<string, any> = {
        licensed_user_count: quantity,
        updated_at: knex.fn.now(),
      };
      if (plan) {
        updateData.plan = plan;
      }

      await knex('tenants')
        .where({ tenant: tenantId })
        .update(updateData);

      if (subscription.status === 'trialing') {
        logger.info(`[StripeService] Tenant ${tenantId} is trialing${plan ? ` on ${plan}` : ''}, trial ends ${subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : 'unknown'}`);
      } else {
        logger.info(`[StripeService] Updated tenant ${tenantId} licensed_user_count to ${quantity}${plan ? `, plan to ${plan}` : ''}`);
      }
    }

    // Log payment failure status for visibility
    if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
      logger.warn(`[StripeService] Subscription ${subscription.id} for tenant ${tenantId} is ${subscription.status} — payment failure detected`);
    }

    // Check if this tenant has an expired Premium trial that should be reverted.
    // Skip if trial was already confirmed (premium_trial === 'confirmed').
    if (subscription.metadata?.premium_trial === 'true' && subscription.metadata?.premium_trial_end) {
      const trialEnd = new Date(subscription.metadata.premium_trial_end);
      if (trialEnd <= new Date()) {
        logger.info(`[StripeService] Premium trial expired for tenant ${tenantId}, reverting to Pro`);
        await this.revertPremiumTrial(tenantId);
      }
    }
  }

  /**
   * Handle customer.subscription.deleted event
   *
   * When a subscription is canceled/deleted:
   * 1. Mark subscription as canceled in database
   * 2. Start tenant deletion workflow (deactivates users, collects stats, awaits confirmation)
   */
  private async handleSubscriptionDeleted(
    event: Stripe.Event,
    tenantId: string,
    knex: Knex
  ): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    logger.info(`[StripeService] Subscription deleted: ${subscription.id}`);

    // Mark subscription as canceled in database
    await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_subscription_external_id: subscription.id,
      })
      .update({
        status: 'canceled',
        canceled_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

    logger.warn(`[StripeService] Subscription ${subscription.id} canceled for tenant ${tenantId}`);

    // Start tenant deletion workflow
    // This will:
    // 1. Deactivate all users
    // 2. Tag client as 'Canceled' in master tenant
    // 3. Collect tenant statistics
    // 4. Wait for confirmation signal (manual or from Alga workflow)
    // 5. Delete tenant data after confirmation (immediate/30/90 days)
    try {
      const workflowResult = await startTenantDeletionWorkflow({
        tenantId,
        triggerSource: 'stripe_webhook',
        subscriptionExternalId: subscription.id,
        reason: `Stripe subscription ${subscription.id} canceled`,
      });

      if (workflowResult.available && workflowResult.workflowId) {
        logger.info(
          `[StripeService] Started tenant deletion workflow ${workflowResult.workflowId} for tenant ${tenantId}`
        );
      } else {
        logger.warn(
          `[StripeService] Tenant deletion workflow not available: ${workflowResult.error || 'Unknown error'}. ` +
          `Tenant ${tenantId} will need manual cleanup.`
        );
      }
    } catch (error) {
      // Don't fail the webhook if workflow fails - the subscription is already canceled
      // The tenant can be cleaned up manually later
      logger.error(
        `[StripeService] Failed to start tenant deletion workflow for tenant ${tenantId}:`,
        error
      );
    }
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhookSignature(payload: string, signature: string): Promise<Stripe.Event> {
    await this.ensureInitialized();
    try {
      return this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.webhookSecret
      );
    } catch (error) {
      logger.error('[StripeService] Webhook signature verification failed:', error);
      throw new Error('Invalid webhook signature');
    }
  }

  /**
   * Get scheduled license changes for a tenant
   * Returns information about any pending license reductions
   */
  async getScheduledLicenseChanges(
    tenantId: string
  ): Promise<{
    current_quantity: number;
    scheduled_quantity: number;
    effective_date: Date;
    current_monthly_cost: number;
    scheduled_monthly_cost: number;
    monthly_savings: number;
  } | null> {
    await this.ensureInitialized();
    logger.info(`[StripeService] Getting scheduled license changes for tenant ${tenantId}`);

    const knex = await getConnection(tenantId);
    const customer = await this.getOrImportCustomer(tenantId);

    // Get existing subscription
    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
        status: 'active',
      })
      .first();

    if (!existingSubscription) {
      logger.info(`[StripeService] No active subscription found for tenant ${tenantId}`);
      return null;
    }

    // Check if there's a scheduled quantity in metadata
    const scheduledQuantity = existingSubscription.metadata?.scheduled_quantity;
    if (!scheduledQuantity || scheduledQuantity === existingSubscription.quantity) {
      logger.info(`[StripeService] No scheduled license changes for tenant ${tenantId}`);
      return null;
    }

    // Get the price per license
    const price = await knex<StripePrice>('stripe_prices')
      .where({ stripe_price_id: existingSubscription.stripe_price_id })
      .first();

    if (!price) {
      logger.error(`[StripeService] Price not found for subscription ${existingSubscription.stripe_subscription_id}`);
      return null;
    }

    const pricePerLicense = price.unit_amount / 100; // Convert cents to dollars
    const currentQuantity = existingSubscription.quantity;
    const effectiveDate = existingSubscription.current_period_end;

    if (!effectiveDate) {
      logger.error(`[StripeService] No period end date found for subscription`);
      return null;
    }

    const currentMonthlyCost = currentQuantity * pricePerLicense;
    const scheduledMonthlyCost = scheduledQuantity * pricePerLicense;
    const monthlySavings = currentMonthlyCost - scheduledMonthlyCost;

    logger.info(
      `[StripeService] Found scheduled change: ${currentQuantity} → ${scheduledQuantity} licenses, ` +
      `effective ${effectiveDate.toISOString()}`
    );

    return {
      current_quantity: currentQuantity,
      scheduled_quantity: scheduledQuantity,
      effective_date: effectiveDate,
      current_monthly_cost: currentMonthlyCost,
      scheduled_monthly_cost: scheduledMonthlyCost,
      monthly_savings: monthlySavings,
    };
  }

  /**
   * Get the price IDs for a given tier and billing interval.
   * Returns null if tier-specific pricing is not configured (legacy mode).
   *
   * NOTE: This returns STANDARD tier prices. For operations that should preserve
   * a subscription's current pricing level (e.g. early adopters), use
   * getSubscriptionPriceIds() instead.
   */
  private getTierPriceIds(
    tier: TenantTier,
    interval: 'month' | 'year' = 'month'
  ): TierPriceIds | null {
    if (interval === 'year') {
      if (tier === 'solo' && this.config.soloBaseAnnualPriceId) {
        return { basePriceId: this.config.soloBaseAnnualPriceId, userPriceId: null };
      }
      if (tier === 'premium' && this.config.premiumBaseAnnualPriceId && this.config.premiumUserAnnualPriceId) {
        return { basePriceId: this.config.premiumBaseAnnualPriceId, userPriceId: this.config.premiumUserAnnualPriceId };
      }
      if (tier === 'pro' && this.config.proBaseAnnualPriceId && this.config.proUserAnnualPriceId) {
        return { basePriceId: this.config.proBaseAnnualPriceId, userPriceId: this.config.proUserAnnualPriceId };
      }
      // Fall through to monthly if annual not configured
    }
    if (tier === 'solo' && this.config.soloBasePriceId) {
      return { basePriceId: this.config.soloBasePriceId, userPriceId: null };
    }
    if (tier === 'premium' && this.config.premiumBasePriceId && this.config.premiumUserPriceId) {
      return { basePriceId: this.config.premiumBasePriceId, userPriceId: this.config.premiumUserPriceId };
    }
    if (tier === 'pro' && this.config.proBasePriceId && this.config.proUserPriceId) {
      return { basePriceId: this.config.proBasePriceId, userPriceId: this.config.proUserPriceId };
    }
    return null;
  }

  /**
   * Get the price IDs that match a subscription's current pricing level.
   *
   * Checks if the subscription is on early adopters pricing (via metadata)
   * first, then falls back to standard tier pricing. This ensures operations
   * like quantity changes and interval switches preserve the subscriber's
   * pricing level.
   *
   * For upgrades/downgrades (changing tier), use getTierPriceIds() directly —
   * those intentionally move to standard pricing.
   */
  private getSubscriptionPriceIds(
    subscription: StripeSubscription,
    interval: 'month' | 'year' = 'month'
  ): TierPriceIds | null {
    if (this.isEarlyAdoptersSubscription(subscription)) {
      return this.getEarlyAdoptersPriceIds(interval);
    }
    return null;
  }

  /**
   * Get early adopters price IDs for a given interval.
   */
  private getEarlyAdoptersPriceIds(
    interval: 'month' | 'year' = 'month'
  ): TierPriceIds | null {
    if (interval === 'year' && this.config.earlyAdoptersBaseAnnualPriceId && this.config.earlyAdoptersUserAnnualPriceId) {
      return { basePriceId: this.config.earlyAdoptersBaseAnnualPriceId, userPriceId: this.config.earlyAdoptersUserAnnualPriceId };
    }
    if (this.config.earlyAdoptersBasePriceId && this.config.earlyAdoptersUserPriceId) {
      return { basePriceId: this.config.earlyAdoptersBasePriceId, userPriceId: this.config.earlyAdoptersUserPriceId };
    }
    return null;
  }

  /**
   * Check if a subscription is an early adopters subscription by looking
   * at the `grandfathered` metadata flag set during migration.
   */
  private isEarlyAdoptersSubscription(subscription: StripeSubscription): boolean {
    return subscription.metadata?.grandfathered === 'true';
  }

  /**
   * Check whether this subscription uses multi-item (base + per-user) billing.
   */
  private isMultiItemSubscription(sub: StripeSubscription): boolean {
    return sub.stripe_base_item_id !== null;
  }

  private buildTierLineItems(prices: TierPriceIds, quantity: number): Array<{ price: string; quantity: number }> {
    const items = [{ price: prices.basePriceId, quantity: 1 }];

    if (prices.userPriceId) {
      items.push({ price: prices.userPriceId, quantity });
    }

    return items;
  }

  /**
   * Get all known per-user price external IDs (for identifying per-user items in webhooks).
   */
  private getKnownUserPriceExternalIds(): string[] {
    const ids: string[] = [];
    if (this.config.licensePriceId) ids.push(this.config.licensePriceId);
    if (this.config.proUserPriceId) ids.push(this.config.proUserPriceId);
    if (this.config.premiumUserPriceId) ids.push(this.config.premiumUserPriceId);
    if (this.config.earlyAdoptersUserPriceId) ids.push(this.config.earlyAdoptersUserPriceId);
    if (this.config.earlyAdoptersUserAnnualPriceId) ids.push(this.config.earlyAdoptersUserAnnualPriceId);
    return ids;
  }

  /**
   * Find the per-user item from a Stripe subscription's items.
   * Works for both legacy (1-item) and multi-item (base + per-user) subscriptions.
   */
  private findUserItemFromStripe(items: Stripe.SubscriptionItem[]): Stripe.SubscriptionItem | undefined {
    if (items.length === 1) return items[0];
    const knownUserPrices = this.getKnownUserPriceExternalIds();
    return items.find(item => knownUserPrices.includes(item.price.id)) || items[0];
  }

  private getLicensedUserCountFromStripeItems(
    items: Stripe.SubscriptionItem[],
    plan?: TenantTier
  ): number {
    if (plan === 'solo') {
      return 1;
    }

    const userItem = this.findUserItemFromStripe(items);
    return userItem?.quantity || 1;
  }

  private async getActiveInternalUserCount(tenantId: string): Promise<number> {
    const knex = await getConnection(tenantId);
    const result = await knex('users')
      .where({
        tenant: tenantId,
        user_type: 'internal',
        is_inactive: false,
      })
      .count('user_id as count')
      .first();

    return parseInt((result?.count as string | undefined) || '0', 10);
  }

  /**
   * Upgrade a tenant's subscription to a new tier.
   *
   * Replaces subscription items with the target tier's prices (base + per-user),
   * preserving the current user count. Stripe handles proration automatically.
   */
  async upgradeTier(
    tenantId: string,
    targetTier: TenantTier,
    interval: 'month' | 'year' = 'month'
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized();
    logger.info(`[StripeService] Upgrading tenant ${tenantId} to ${targetTier} (${interval})`);

    const tierPrices = this.getTierPriceIds(targetTier, interval);
    if (!tierPrices) {
      return { success: false, error: `Pricing not configured for ${targetTier} tier` };
    }
    if (!tierPrices.userPriceId) {
      return { success: false, error: `Per-user pricing is not configured for ${targetTier} tier` };
    }

    const knex = await getConnection(tenantId);
    const customer = await this.getOrImportCustomer(tenantId);

    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
        status: 'active',
      })
      .first();

    if (!existingSubscription) {
      return { success: false, error: 'No active subscription found' };
    }

    const currentQuantity = existingSubscription.quantity;

    // Build the items array for the update:
    // Remove all existing items, add the target tier's items
    const itemUpdates: Stripe.SubscriptionUpdateParams.Item[] = [];

    // Remove the currently tracked primary item. For Solo this is the flat-rate base item;
    // for legacy and multi-item subscriptions this is the per-user item.
    if (existingSubscription.stripe_subscription_item_id) {
      itemUpdates.push({
        id: existingSubscription.stripe_subscription_item_id,
        deleted: true,
      });
    }

    // Remove existing base item if present
    if (existingSubscription.stripe_base_item_id) {
      itemUpdates.push({
        id: existingSubscription.stripe_base_item_id,
        deleted: true,
      });
    }

    // Add new tier items
    itemUpdates.push(
      { price: tierPrices.basePriceId, quantity: 1 },
      { price: tierPrices.userPriceId, quantity: currentQuantity },
    );

    try {
      const updatedSubscription = await this.stripe.subscriptions.update(
        existingSubscription.stripe_subscription_external_id,
        {
          items: itemUpdates,
          proration_behavior: 'always_invoice',
          payment_behavior: 'error_if_incomplete',
          metadata: { tenant_id: tenantId },
        }
      );

      // Find the new items
      const newUserItem = this.findUserItemFromStripe(updatedSubscription.items.data);
      const newBaseItem = updatedSubscription.items.data.find(
        item => item.price.id === tierPrices.basePriceId
      );

      // Look up internal price IDs
      const userPriceRecord = await knex<StripePrice>('stripe_prices')
        .where({ tenant: tenantId, stripe_price_external_id: tierPrices.userPriceId })
        .first();
      const basePriceRecord = await knex<StripePrice>('stripe_prices')
        .where({ tenant: tenantId, stripe_price_external_id: tierPrices.basePriceId })
        .first();

      // Update subscription record
      await knex<StripeSubscription>('stripe_subscriptions')
        .where({ stripe_subscription_id: existingSubscription.stripe_subscription_id })
        .update({
          stripe_subscription_item_id: newUserItem?.id || null,
          stripe_price_id: userPriceRecord?.stripe_price_id || existingSubscription.stripe_price_id,
          stripe_base_item_id: newBaseItem?.id || null,
          stripe_base_price_id: basePriceRecord?.stripe_price_id || null,
          billing_interval: interval,
          updated_at: knex.fn.now(),
        });

      // Update tenant plan
      await knex('tenants')
        .where({ tenant: tenantId })
        .update({
          plan: targetTier,
          updated_at: knex.fn.now(),
        });

      // Cancel any other active Stripe subscriptions for this customer
      // (e.g. legacy subscription that wasn't updated in-place)
      try {
        const allStripeSubs = await this.stripe.subscriptions.list({
          customer: customer.stripe_customer_external_id,
          status: 'active',
        });
        for (const sub of allStripeSubs.data) {
          if (sub.id !== existingSubscription.stripe_subscription_external_id) {
            logger.info(`[StripeService] Cancelling stale subscription ${sub.id} for tenant ${tenantId}`);
            await this.stripe.subscriptions.cancel(sub.id, { prorate: true });
            // Mark as cancelled in DB if it exists
            await knex<StripeSubscription>('stripe_subscriptions')
              .where({ tenant: tenantId, stripe_subscription_external_id: sub.id })
              .update({ status: 'canceled', canceled_at: knex.fn.now(), updated_at: knex.fn.now() });
          }
        }
      } catch (cleanupError) {
        // Don't fail the upgrade if cleanup fails — log and continue
        logger.warn(`[StripeService] Failed to clean up stale subscriptions for tenant ${tenantId}`, { error: cleanupError });
      }

      logger.info(`[StripeService] Upgraded tenant ${tenantId} to ${targetTier}`);
      return { success: true };
    } catch (error: any) {
      logger.error(`[StripeService] Failed to upgrade tenant ${tenantId}:`, error);
      return {
        success: false,
        error: error.message || 'Failed to upgrade subscription',
      };
    }
  }

  async downgradeTier(
    tenantId: string,
    interval: 'month' | 'year' = 'month'
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized();
    logger.info(`[StripeService] Downgrading tenant ${tenantId} to solo (${interval})`);

    const activeUserCount = await this.getActiveInternalUserCount(tenantId);
    if (activeUserCount > 1) {
      return {
        success: false,
        error: 'Solo downgrade requires exactly 1 active internal user',
      };
    }

    const tierPrices = this.getTierPriceIds('solo', interval);
    if (!tierPrices) {
      return { success: false, error: 'Pricing not configured for solo tier' };
    }

    const knex = await getConnection(tenantId);
    const customer = await this.getOrImportCustomer(tenantId);

    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
        status: 'active',
      })
      .first();

    if (!existingSubscription) {
      return { success: false, error: 'No active subscription found' };
    }

    const itemUpdates: Stripe.SubscriptionUpdateParams.Item[] = [];

    if (existingSubscription.stripe_subscription_item_id) {
      itemUpdates.push({
        id: existingSubscription.stripe_subscription_item_id,
        deleted: true,
      });
    }

    if (existingSubscription.stripe_base_item_id) {
      itemUpdates.push({
        id: existingSubscription.stripe_base_item_id,
        deleted: true,
      });
    }

    itemUpdates.push({ price: tierPrices.basePriceId, quantity: 1 });

    try {
      const updatedSubscription = await this.stripe.subscriptions.update(
        existingSubscription.stripe_subscription_external_id,
        {
          items: itemUpdates,
          proration_behavior: 'always_invoice',
          payment_behavior: 'error_if_incomplete',
          metadata: { tenant_id: tenantId },
        }
      );

      const soloItem = updatedSubscription.items.data.find(
        item => item.price.id === tierPrices.basePriceId
      ) || updatedSubscription.items.data[0];

      const soloPriceRecord = await knex<StripePrice>('stripe_prices')
        .where({ tenant: tenantId, stripe_price_external_id: tierPrices.basePriceId })
        .first();

      await knex<StripeSubscription>('stripe_subscriptions')
        .where({ stripe_subscription_id: existingSubscription.stripe_subscription_id })
        .update({
          stripe_subscription_item_id: soloItem?.id || null,
          stripe_price_id: soloPriceRecord?.stripe_price_id || existingSubscription.stripe_price_id,
          stripe_base_item_id: null,
          stripe_base_price_id: null,
          billing_interval: interval,
          quantity: 1,
          updated_at: knex.fn.now(),
        });

      await knex('tenants')
        .where({ tenant: tenantId })
        .update({
          plan: 'solo',
          licensed_user_count: 1,
          updated_at: knex.fn.now(),
        });

      logger.info(`[StripeService] Downgraded tenant ${tenantId} to solo`);
      return { success: true };
    } catch (error: any) {
      logger.error(`[StripeService] Failed to downgrade tenant ${tenantId}:`, error);
      return {
        success: false,
        error: error.message || 'Failed to downgrade subscription',
      };
    }
  }

  /**
   * Get a preview of what the tier upgrade will cost.
   * Fetches live prices from Stripe so the UI can show a confirmation dialog.
   */
  async getUpgradePreview(
    tenantId: string,
    targetTier: TenantTier,
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
    await this.ensureInitialized();

    const tierPrices = this.getTierPriceIds(targetTier, interval);
    if (!tierPrices) {
      return { success: false, error: `Pricing not configured for ${targetTier} tier (${interval})` };
    }

    try {
      const knex = await getConnection(tenantId);
      const customer = await this.getOrImportCustomer(tenantId);

      const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
        .where({
          tenant: tenantId,
          stripe_customer_id: customer.stripe_customer_id,
          status: 'active',
        })
        .first();

      const userCount = existingSubscription?.quantity || 1;

      // Fetch target tier prices from Stripe
      const [basePrice, userPrice] = await Promise.all([
        this.stripe.prices.retrieve(tierPrices.basePriceId),
        tierPrices.userPriceId ? this.stripe.prices.retrieve(tierPrices.userPriceId) : Promise.resolve(null),
      ]);

      const basePriceAmount = (basePrice.unit_amount || 0) / 100;
      const userPriceAmount = ((userPrice?.unit_amount) || 0) / 100;
      const newMonthly = basePriceAmount + (userPriceAmount * userCount);

      // Calculate current monthly from existing subscription
      let currentMonthly = 0;
      if (existingSubscription) {
        const currentPrice = await knex<StripePrice>('stripe_prices')
          .where({ stripe_price_id: existingSubscription.stripe_price_id })
          .first();
        const currentUserAmount = (currentPrice?.unit_amount || 0) / 100;

        if (existingSubscription.stripe_base_price_id) {
          const currentBasePrice = await knex<StripePrice>('stripe_prices')
            .where({ stripe_price_id: existingSubscription.stripe_base_price_id })
            .first();
          currentMonthly = ((currentBasePrice?.unit_amount || 0) / 100) + (currentUserAmount * userCount);
        } else {
          currentMonthly = currentUserAmount * userCount;
        }
      }

      // Get proration estimate from Stripe
      let prorationAmount: number | undefined;
      if (existingSubscription) {
        try {
          const invoice = await this.stripe.invoices.createPreview({
            customer: customer.stripe_customer_external_id,
            subscription: existingSubscription.stripe_subscription_external_id,
            subscription_details: {
              items: [
                ...(existingSubscription.stripe_subscription_item_id
                  ? [{ id: existingSubscription.stripe_subscription_item_id, deleted: true as const }]
                  : []),
                ...(existingSubscription.stripe_base_item_id
                  ? [{ id: existingSubscription.stripe_base_item_id, deleted: true as const }]
                  : []),
                ...this.buildTierLineItems(tierPrices, userCount),
              ],
              proration_behavior: 'always_invoice',
            },
          });
          prorationAmount = (invoice.amount_due || 0) / 100;
        } catch (e) {
          logger.warn('[StripeService] Could not estimate proration', { error: e });
        }
      }

      // Fetch annual pricing if available (for showing both options)
      let annualAvailable = false;
      let annualBasePrice: number | undefined;
      let annualUserPrice: number | undefined;
      let annualTotal: number | undefined;
      const annualPrices = this.getTierPriceIds(targetTier, 'year');
      if (annualPrices && (interval !== 'year' || annualPrices.basePriceId !== tierPrices.basePriceId)) {
        try {
          const [annualBase, annualUser] = await Promise.all([
            this.stripe.prices.retrieve(annualPrices.basePriceId),
            annualPrices.userPriceId ? this.stripe.prices.retrieve(annualPrices.userPriceId) : Promise.resolve(null),
          ]);
          annualBasePrice = (annualBase.unit_amount || 0) / 100;
          annualUserPrice = ((annualUser?.unit_amount) || 0) / 100;
          annualTotal = annualBasePrice + (annualUserPrice * userCount);
          annualAvailable = true;
        } catch (e) {
          logger.warn('[StripeService] Could not fetch annual prices', { error: e });
        }
      }

      return {
        success: true,
        currentMonthly,
        newBasePrice: basePriceAmount,
        newUserPrice: userPriceAmount,
        newMonthly,
        userCount,
        currency: basePrice.currency,
        prorationAmount,
        annualAvailable,
        annualBasePrice,
        annualUserPrice,
        annualTotal,
      };
    } catch (error: any) {
      logger.error(`[StripeService] Failed to get upgrade preview for tenant ${tenantId}:`, error);
      return { success: false, error: error.message || 'Failed to get upgrade preview' };
    }
  }

  /**
   * Switch billing interval (monthly <-> annual) at end of current period.
   * Uses Stripe subscription schedules so the change is deferred — no immediate proration.
   */
  async switchBillingInterval(
    tenantId: string,
    newInterval: 'month' | 'year'
  ): Promise<{ success: boolean; error?: string; effectiveDate?: string }> {
    await this.ensureInitialized();
    logger.info(`[StripeService] Switching tenant ${tenantId} billing to ${newInterval}`);

    const knex = await getConnection(tenantId);
    const customer = await this.getOrImportCustomer(tenantId);

    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
        status: 'active',
      })
      .first();

    if (!existingSubscription) {
      return { success: false, error: 'No active subscription found' };
    }

    if (existingSubscription.billing_interval === newInterval) {
      return { success: false, error: `Subscription is already billed ${newInterval}ly` };
    }

    // Resolve the target interval's price IDs, preserving early adopters pricing
    const tenantRecord = await knex('tenants').where('tenant', tenantId).select('plan').first();
    const currentTier: TenantTier = tenantRecord?.plan || 'pro';
    const newPrices = this.getSubscriptionPriceIds(existingSubscription, newInterval)
      || this.getTierPriceIds(currentTier, newInterval);
    if (!newPrices) {
      return { success: false, error: `${newInterval === 'year' ? 'Annual' : 'Monthly'} pricing not configured for ${currentTier} tier` };
    }

    try {
      // Create a subscription schedule that keeps the current phase and adds a new phase
      // at the end of the current period with the new interval prices
      const schedule = await this.stripe.subscriptionSchedules.create({
        from_subscription: existingSubscription.stripe_subscription_external_id,
      });

      // The schedule now has one phase (current). Add a second phase with the new prices.
      const currentPhase = schedule.phases[0];
      const currentQuantity = existingSubscription.quantity;

      await this.stripe.subscriptionSchedules.update(schedule.id, {
        phases: [
          {
            start_date: currentPhase.start_date,
            end_date: currentPhase.end_date,
            items: currentPhase.items.map(item => ({
              price: typeof item.price === 'string' ? item.price : item.price.id || (item.price as any),
              quantity: item.quantity,
            })),
          },
          {
            items: this.buildTierLineItems(newPrices, currentQuantity),
          },
        ],
        end_behavior: 'release',
      });

      const effectiveDate = new Date((currentPhase.end_date as number) * 1000).toISOString();

      // Store the pending interval change in metadata
      await knex<StripeSubscription>('stripe_subscriptions')
        .where({ stripe_subscription_id: existingSubscription.stripe_subscription_id })
        .update({
          metadata: {
            ...existingSubscription.metadata,
            scheduled_interval: newInterval,
            schedule_id: schedule.id,
          },
          updated_at: knex.fn.now(),
        });

      logger.info(`[StripeService] Scheduled billing interval switch to ${newInterval} for tenant ${tenantId}, effective ${effectiveDate}`);
      return { success: true, effectiveDate };
    } catch (error: any) {
      logger.error(`[StripeService] Failed to switch billing interval for tenant ${tenantId}:`, error);
      return { success: false, error: error.message || 'Failed to switch billing interval' };
    }
  }

  /**
   * Get a preview of what switching billing interval would cost.
   */
  async getIntervalSwitchPreview(
    tenantId: string,
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
    await this.ensureInitialized();

    const knex = await getConnection(tenantId);
    const customer = await this.getOrImportCustomer(tenantId);

    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
        status: 'active',
      })
      .first();

    if (!existingSubscription) {
      return { success: false, error: 'No active subscription found' };
    }

    const tenantRecord = await knex('tenants').where('tenant', tenantId).select('plan').first();
    const currentTier: TenantTier = tenantRecord?.plan || 'pro';
    const newPrices = this.getSubscriptionPriceIds(existingSubscription, newInterval)
      || this.getTierPriceIds(currentTier, newInterval);
    if (!newPrices) {
      return { success: false, error: `${newInterval === 'year' ? 'Annual' : 'Monthly'} pricing not configured for ${currentTier} tier` };
    }

    try {
      const [newBase, newUser] = await Promise.all([
        this.stripe.prices.retrieve(newPrices.basePriceId),
        newPrices.userPriceId ? this.stripe.prices.retrieve(newPrices.userPriceId) : Promise.resolve(null),
      ]);

      const userCount = existingSubscription.quantity;
      const newBaseAmount = (newBase.unit_amount || 0) / 100;
      const newUserAmount = ((newUser?.unit_amount) || 0) / 100;
      const newTotal = newBaseAmount + (newUserAmount * userCount);

      // Calculate current total
      let currentTotal = 0;
      const currentUserPrice = await knex<StripePrice>('stripe_prices')
        .where({ stripe_price_id: existingSubscription.stripe_price_id })
        .first();
      const currentUserAmount = (currentUserPrice?.unit_amount || 0) / 100;
      if (existingSubscription.stripe_base_price_id) {
        const currentBasePrice = await knex<StripePrice>('stripe_prices')
          .where({ stripe_price_id: existingSubscription.stripe_base_price_id })
          .first();
        currentTotal = ((currentBasePrice?.unit_amount || 0) / 100) + (currentUserAmount * userCount);
      } else {
        currentTotal = currentUserAmount * userCount;
      }

      // Calculate savings: compare equivalent monthly costs
      // If switching to annual, compare annual/12 vs current monthly
      // If switching to monthly, no savings (just showing the new price)
      let savingsPercent: number | undefined;
      if (newInterval === 'year') {
        const equivalentMonthly = newTotal / 12;
        savingsPercent = Math.round(((currentTotal - equivalentMonthly) / currentTotal) * 100);
      }

      return {
        success: true,
        currentInterval: existingSubscription.billing_interval || 'month',
        currentTotal,
        newTotal,
        newBasePrice: newBaseAmount,
        newUserPrice: newUserAmount,
        userCount,
        effectiveDate: existingSubscription.current_period_end?.toISOString(),
        savingsPercent,
      };
    } catch (error: any) {
      logger.error(`[StripeService] Failed to get interval switch preview:`, error);
      return { success: false, error: error.message || 'Failed to get pricing preview' };
    }
  }

  /**
   * Start a 30-day Premium trial for an existing tenant.
   *
   * Trial approach: keep Pro prices on Stripe (no billing change during trial),
   * grant Premium features via DB plan field. User must explicitly confirm
   * conversion to Premium before trial ends, or it reverts to Pro.
   *
   * Handles two cases:
   * 1. Paying Pro customer → keep Pro subscription, set plan=premium in DB
   * 2. Pro trial customer → end Pro trial first, then start Premium trial
   */
  async startPremiumTrial(
    tenantId: string
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized();
    logger.info(`[StripeService] Starting Premium trial for tenant ${tenantId}`);

    const knex = await getConnection(tenantId);

    // Validate tenant is on Pro
    const tenantRecord = await knex('tenants').where('tenant', tenantId).select('plan').first();
    if (!tenantRecord) {
      return { success: false, error: 'Tenant not found' };
    }
    if (tenantRecord.plan === 'premium') {
      return { success: false, error: 'Tenant is already on Premium' };
    }

    const customer = await this.getOrImportCustomer(tenantId);
    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
      })
      .whereIn('status', ['active', 'trialing'])
      .first();

    if (!existingSubscription) {
      return { success: false, error: 'No active or trialing subscription found' };
    }

    try {
      // If currently trialing Pro, end the trial immediately (charge for Pro)
      if (existingSubscription.status === 'trialing') {
        logger.info(`[StripeService] Ending Pro trial for tenant ${tenantId} before Premium trial`);
        await this.stripe.subscriptions.update(
          existingSubscription.stripe_subscription_external_id,
          { trial_end: 'now' }
        );
        // Wait a moment for Stripe to process
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Set Premium trial end to 30 days from now
      const premiumTrialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Update Stripe subscription metadata only (keep Pro prices unchanged)
      await this.stripe.subscriptions.update(
        existingSubscription.stripe_subscription_external_id,
        {
          metadata: {
            tenant_id: tenantId,
            premium_trial: 'true',
            premium_trial_started: new Date().toISOString(),
            premium_trial_end: premiumTrialEnd,
          },
        }
      );

      // Update local subscription record with trial metadata
      const existingMetadata = existingSubscription.metadata || {};
      await knex<StripeSubscription>('stripe_subscriptions')
        .where({ stripe_subscription_id: existingSubscription.stripe_subscription_id })
        .update({
          metadata: {
            ...existingMetadata,
            premium_trial: 'true',
            premium_trial_started: new Date().toISOString(),
            premium_trial_end: premiumTrialEnd,
          },
          updated_at: knex.fn.now(),
        });

      // Update tenant plan to premium (unlocks features)
      await knex('tenants')
        .where({ tenant: tenantId })
        .update({
          plan: 'premium',
          updated_at: knex.fn.now(),
        });

      logger.info(`[StripeService] Started 30-day Premium trial for tenant ${tenantId}, ends ${premiumTrialEnd}`);
      return { success: true };
    } catch (error: any) {
      logger.error(`[StripeService] Failed to start Premium trial for tenant ${tenantId}:`, error);
      return { success: false, error: error.message || 'Failed to start Premium trial' };
    }
  }

  /**
   * Confirm Premium trial — user explicitly agrees to convert to Premium pricing.
   *
   * Schedules the Stripe subscription item swap for the end of the current billing
   * period (via SubscriptionSchedule). The trial continues until the period ends —
   * Premium features stay active the whole time, and the user isn't charged early.
   */
  async confirmPremiumTrial(
    tenantId: string,
    interval: 'month' | 'year' = 'month'
  ): Promise<{ success: boolean; error?: string; effectiveDate?: string }> {
    await this.ensureInitialized();
    logger.info(`[StripeService] Confirming Premium trial for tenant ${tenantId}`);

    const knex = await getConnection(tenantId);
    const premiumPrices = this.getTierPriceIds('premium', interval);
    if (!premiumPrices) {
      return { success: false, error: 'Premium pricing not configured' };
    }

    const customer = await this.getOrImportCustomer(tenantId);
    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
      })
      .whereIn('status', ['active', 'trialing'])
      .first();

    if (!existingSubscription) {
      return { success: false, error: 'No active subscription found' };
    }

    // Verify this is actually a Premium trial
    const metadata = existingSubscription.metadata || {};
    if (metadata.premium_trial !== 'true') {
      return { success: false, error: 'No active Premium trial found' };
    }

    try {
      const currentQuantity = existingSubscription.quantity;

      // Create a subscription schedule from the current subscription,
      // then add a second phase with Premium prices at period end
      const schedule = await this.stripe.subscriptionSchedules.create({
        from_subscription: existingSubscription.stripe_subscription_external_id,
      });

      const currentPhase = schedule.phases[0];

      await this.stripe.subscriptionSchedules.update(schedule.id, {
        phases: [
          // Phase 1: keep current Pro prices until period end
          {
            start_date: currentPhase.start_date,
            end_date: currentPhase.end_date,
            items: currentPhase.items.map(item => ({
              price: typeof item.price === 'string' ? item.price : item.price.id || (item.price as any),
              quantity: item.quantity,
            })),
          },
          // Phase 2: switch to Premium prices
          {
            items: this.buildTierLineItems(premiumPrices, currentQuantity),
          },
        ],
        end_behavior: 'release',
      });

      const effectiveDate = new Date((currentPhase.end_date as number) * 1000).toISOString();

      // Mark trial as confirmed — prevents auto-revert, but keep premium_trial metadata
      // so the UI knows Premium features should stay active until the schedule kicks in
      const { premium_trial_end, ...remainingMetadata } = metadata;
      await knex<StripeSubscription>('stripe_subscriptions')
        .where({ stripe_subscription_id: existingSubscription.stripe_subscription_id })
        .update({
          metadata: {
            ...remainingMetadata,
            premium_trial: 'confirmed',
            premium_trial_confirmed: new Date().toISOString(),
            premium_trial_effective_date: effectiveDate,
            schedule_id: schedule.id,
          },
          updated_at: knex.fn.now(),
        });

      // Update Stripe metadata too
      await this.stripe.subscriptions.update(
        existingSubscription.stripe_subscription_external_id,
        {
          metadata: {
            tenant_id: tenantId,
            premium_trial: 'confirmed',
            premium_trial_confirmed: new Date().toISOString(),
            premium_trial_end: '',
          },
        }
      );

      logger.info(`[StripeService] Premium trial confirmed for tenant ${tenantId}, Premium billing scheduled for ${effectiveDate}`);
      return { success: true, effectiveDate };
    } catch (error: any) {
      logger.error(`[StripeService] Failed to confirm Premium trial for tenant ${tenantId}:`, error);
      return { success: false, error: error.message || 'Failed to confirm Premium upgrade' };
    }
  }

  /**
   * Revert a Premium trial — flip tenant back to Pro.
   * Called when trial expires without confirmation, or when user cancels trial.
   * Does NOT touch Stripe subscription items (they're already on Pro prices).
   */
  async revertPremiumTrial(
    tenantId: string
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized();
    logger.info(`[StripeService] Reverting Premium trial for tenant ${tenantId}`);

    const knex = await getConnection(tenantId);

    const customer = await this.getOrImportCustomer(tenantId);
    const existingSubscription = await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_customer_id: customer.stripe_customer_id,
      })
      .whereIn('status', ['active', 'trialing'])
      .first();

    if (!existingSubscription) {
      return { success: false, error: 'No active subscription found' };
    }

    try {
      // Clear trial metadata on Stripe
      await this.stripe.subscriptions.update(
        existingSubscription.stripe_subscription_external_id,
        {
          metadata: {
            tenant_id: tenantId,
            premium_trial: '',
            premium_trial_started: '',
            premium_trial_end: '',
            premium_trial_reverted: new Date().toISOString(),
          },
        }
      );

      // Clear trial metadata locally
      const metadata = existingSubscription.metadata || {};
      const { premium_trial, premium_trial_started, premium_trial_end, ...remainingMetadata } = metadata;
      await knex<StripeSubscription>('stripe_subscriptions')
        .where({ stripe_subscription_id: existingSubscription.stripe_subscription_id })
        .update({
          metadata: {
            ...remainingMetadata,
            premium_trial_reverted: new Date().toISOString(),
          },
          updated_at: knex.fn.now(),
        });

      // Revert tenant plan to pro
      await knex('tenants')
        .where({ tenant: tenantId })
        .update({
          plan: 'pro',
          updated_at: knex.fn.now(),
        });

      logger.info(`[StripeService] Reverted Premium trial for tenant ${tenantId}, back to Pro`);
      return { success: true };
    } catch (error: any) {
      logger.error(`[StripeService] Failed to revert Premium trial for tenant ${tenantId}:`, error);
      return { success: false, error: error.message || 'Failed to revert Premium trial' };
    }
  }

  /**
   * Check all tenants with active Premium trials and revert any that have expired.
   * Should be called periodically (e.g. via cron or webhook).
   */
  async checkAndRevertExpiredPremiumTrials(): Promise<{ reverted: string[]; errors: string[] }> {
    await this.ensureInitialized();
    logger.info('[StripeService] Checking for expired Premium trials');

    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const knex = await getAdminConnection();
    const reverted: string[] = [];
    const errors: string[] = [];

    try {
      // Find all subscriptions with an active premium trial that has expired
      const expiredTrials = await knex('stripe_subscriptions')
        .whereIn('status', ['active', 'trialing'])
        .whereRaw("metadata->>'premium_trial' = 'true'")
        .whereRaw("(metadata->>'premium_trial_end')::timestamptz < now()")
        .select('tenant');

      for (const sub of expiredTrials) {
        try {
          const result = await this.revertPremiumTrial(sub.tenant);
          if (result.success) {
            reverted.push(sub.tenant);
          } else {
            errors.push(`${sub.tenant}: ${result.error}`);
          }
        } catch (error: any) {
          errors.push(`${sub.tenant}: ${error.message}`);
        }
      }
    } catch (error: any) {
      logger.error('[StripeService] Error checking expired Premium trials:', error);
      errors.push(`Query error: ${error.message}`);
    }

    if (reverted.length > 0) {
      logger.info(`[StripeService] Reverted ${reverted.length} expired Premium trials: ${reverted.join(', ')}`);
    }

    return { reverted, errors };
  }

  /**
   * Get Stripe publishable key for frontend
   */
  async getPublishableKey(): Promise<string> {
    await this.ensureInitialized();
    return this.config.publishableKey;
  }
}

// Export singleton instance
let stripeServiceInstance: StripeService | null = null;

export function getStripeService(): StripeService {
  if (!stripeServiceInstance) {
    stripeServiceInstance = new StripeService();
  }
  return stripeServiceInstance;
}

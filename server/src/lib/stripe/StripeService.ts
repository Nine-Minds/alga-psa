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
import { getConnection } from '../db/db';
import logger from '@alga-psa/shared/core/logger';

// Environment variable validation
function getStripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const masterTenantId = process.env.MASTER_BILLING_TENANT_ID;
  const licenseProductId = process.env.STRIPE_LICENSE_PRODUCT_ID;
  const licensePriceId = process.env.STRIPE_LICENSE_PRICE_ID;

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }

  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
  }

  if (!publishableKey) {
    throw new Error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY environment variable is required');
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
  status: 'active' | 'canceled' | 'past_due';
  quantity: number;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at: Date | null;
  canceled_at: Date | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

export class StripeService {
  private stripe: Stripe;
  private config: ReturnType<typeof getStripeConfig>;

  constructor() {
    this.config = getStripeConfig();
    this.stripe = new Stripe(this.config.secretKey, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });
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
    const stripeCustomer = await this.stripe.customers.retrieve(stripeCustomerId);

    if (stripeCustomer.deleted) {
      throw new Error(`Stripe customer ${stripeCustomerId} has been deleted`);
    }

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

    // Get the first subscription item (for license subscriptions, there's typically only one)
    const subscriptionItem = subscription.items.data[0];
    if (!subscriptionItem) {
      logger.warn(`[StripeService] Subscription ${subscription.id} has no items, skipping`);
      return;
    }

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
      const [newPrice] = await db<StripePrice>('stripe_prices')
        .insert({
          tenant: tenantId,
          stripe_price_external_id: price.id,
          stripe_product_id: dbProduct.stripe_product_id,
          unit_amount: price.unit_amount || 0,
          currency: price.currency,
          recurring_interval: price.recurring?.interval || null,
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
      await db<StripeSubscription>('stripe_subscriptions').insert({
        tenant: tenantId,
        stripe_subscription_external_id: subscription.id,
        stripe_subscription_item_id: subscriptionItem.id,
        stripe_customer_id: customerInternalId,
        stripe_price_id: dbPrice.stripe_price_id,
        status: subscription.status as 'active' | 'canceled' | 'past_due',
        quantity: subscriptionItem.quantity || 1,
        current_period_start: new Date(subscription.current_period_start * 1000),
        current_period_end: new Date(subscription.current_period_end * 1000),
        cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
        canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        metadata: subscription.metadata,
      });

      logger.info(`[StripeService] Imported subscription ${subscription.id} for tenant ${tenantId}`);
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
      .filter(line => line.proration)
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

        // Step 2: Update the schedule with metadata, end behavior, and phases
        await this.stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: 'release',
          metadata: {
            tenant_id: tenantId,
          },
          phases: [
            // Phase 1: Keep current quantity until period end (use existing start_date)
            {
              items: [
                {
                  price: this.config.licensePriceId!,
                  quantity: currentQuantity,
                },
              ],
              start_date: currentPhase.start_date,
              end_date: Math.floor(currentPeriodEnd.getTime() / 1000),
              metadata: {
                tenant_id: tenantId,
              },
            },
            // Phase 2: New quantity starting next period
            {
              items: [
                {
                  price: this.config.licensePriceId!,
                  quantity,
                },
              ],
              metadata: {
                tenant_id: tenantId,
              },
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
    quantity: number
  ): Promise<{ clientSecret: string; sessionId: string }> {
    logger.info(`[StripeService] Creating checkout session for tenant ${tenantId}, quantity: ${quantity}`);

    // Get or import customer
    const customer = await this.getOrImportCustomer(tenantId);

    // Validate that we have price configured
    if (!this.config.licensePriceId) {
      throw new Error('STRIPE_LICENSE_PRICE_ID environment variable is not configured');
    }

    // Create checkout session in embedded mode
    const session = await this.stripe.checkout.sessions.create({
      customer: customer.stripe_customer_external_id,
      ui_mode: 'embedded', // IMPORTANT: Embedded mode, not redirect
      mode: 'subscription',
      line_items: [
        {
          price: this.config.licensePriceId,
          quantity,
        },
      ],
      subscription_data: {
        metadata: {
          tenant_id: tenantId,
          source: 'algapsa_license_purchase',
        },
      },
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/msp/licenses/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        tenant_id: tenantId,
        license_quantity: quantity.toString(),
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

    // Update tenant licensed_user_count
    const subscriptionItem = subscription.items.data[0];
    const quantity = subscriptionItem?.quantity || 1;

    await knex('tenants')
      .where({ tenant: tenantId })
      .update({
        licensed_user_count: quantity,
        updated_at: knex.fn.now(),
      });

    logger.info(`[StripeService] Updated tenant ${tenantId} licensed_user_count to ${quantity}`);
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
    const subscriptionItem = subscription.items.data[0];
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

    await knex<StripeSubscription>('stripe_subscriptions')
      .where({
        tenant: tenantId,
        stripe_subscription_external_id: subscription.id,
      })
      .update({
        status: subscription.status as 'active' | 'canceled' | 'past_due',
        quantity,
        current_period_start: new Date(subscription.current_period_start * 1000),
        current_period_end: new Date(subscription.current_period_end * 1000),
        cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
        canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        metadata: updatedMetadata,
        updated_at: knex.fn.now(),
      });

    // Update tenant licensed_user_count if subscription is active
    if (subscription.status === 'active') {
      await knex('tenants')
        .where({ tenant: tenantId })
        .update({
          licensed_user_count: quantity,
          updated_at: knex.fn.now(),
        });

      logger.info(`[StripeService] Updated tenant ${tenantId} licensed_user_count to ${quantity}`);
    }
  }

  /**
   * Handle customer.subscription.deleted event
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

    // Optionally update tenant licensed_user_count to 0 or minimum
    // This depends on business logic - do we allow grace period?
    logger.warn(`[StripeService] Subscription ${subscription.id} canceled for tenant ${tenantId}`);
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
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
   * Get Stripe publishable key for frontend
   */
  getPublishableKey(): string {
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

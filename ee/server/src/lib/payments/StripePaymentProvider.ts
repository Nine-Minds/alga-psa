/**
 * StripePaymentProvider - Stripe implementation of PaymentProvider interface
 *
 * Handles invoice payments through Stripe Checkout Sessions.
 * This is separate from the existing StripeService which handles license management.
 *
 * Key responsibilities:
 * - Creating Stripe customers for clients
 * - Generating payment links (Checkout Sessions) for invoices
 * - Processing payment webhooks
 * - Retrieving payment status
 */

import Stripe from 'stripe';
import { Knex } from 'knex';
import { getConnection } from 'server/src/lib/db/db';
import logger from '@alga-psa/shared/core/logger';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import {
  PaymentProvider,
  PaymentProviderCapabilities,
  CreatePaymentLinkRequest,
  PaymentLinkResult,
  PaymentWebhookEvent,
  PaymentDetails,
  PaymentStatus,
  IPaymentProviderConfig,
  IClientPaymentCustomer,
  IInvoicePaymentLink,
} from 'server/src/interfaces/payment.interfaces';

/**
 * Configuration for the Stripe payment provider.
 */
interface StripePaymentConfig {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
}

/**
 * Gets Stripe configuration from tenant-specific settings or environment.
 */
async function getStripePaymentConfig(tenantId: string): Promise<StripePaymentConfig | null> {
  const knex = await getConnection();
  const secretProvider = await getSecretProviderInstance();

  // First check for tenant-specific configuration
  const config = await knex<IPaymentProviderConfig>('payment_provider_configs')
    .where({
      tenant: tenantId,
      provider_type: 'stripe',
      is_enabled: true,
    })
    .first();

  if (config?.credentials_vault_path) {
    // Use tenant-specific credentials from vault
    const secretKey = await secretProvider.getTenantSecret(tenantId, 'stripe_payment_secret_key');
    const webhookSecret = await secretProvider.getTenantSecret(tenantId, 'stripe_payment_webhook_secret');
    const publishableKey = config.configuration?.publishable_key as string;

    if (secretKey && webhookSecret && publishableKey) {
      return { secretKey, webhookSecret, publishableKey };
    }
  }

  // Fall back to global/environment configuration
  let secretKey = await secretProvider.getAppSecret('stripe_secret_key');
  if (!secretKey && process.env.STRIPE_SECRET_KEY) {
    secretKey = process.env.STRIPE_SECRET_KEY;
  }

  let webhookSecret = await secretProvider.getAppSecret('stripe_payment_webhook_secret');
  if (!webhookSecret && process.env.STRIPE_PAYMENT_WEBHOOK_SECRET) {
    webhookSecret = process.env.STRIPE_PAYMENT_WEBHOOK_SECRET;
  }
  // Fall back to the main webhook secret if payment-specific not set
  if (!webhookSecret) {
    webhookSecret = await secretProvider.getAppSecret('stripe_webhook_secret');
    if (!webhookSecret && process.env.STRIPE_WEBHOOK_SECRET) {
      webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    }
  }

  let publishableKey = await secretProvider.getAppSecret('stripe_publishable_key');
  if (!publishableKey && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  }

  if (!secretKey || !webhookSecret || !publishableKey) {
    return null;
  }

  return { secretKey, webhookSecret, publishableKey };
}

export class StripePaymentProvider implements PaymentProvider {
  readonly providerType = 'stripe';

  private stripe: Stripe | null = null;
  private config: StripePaymentConfig | null = null;
  private tenantId: string;
  private initPromise: Promise<void> | null = null;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Initializes the Stripe client with tenant configuration.
   */
  private async initialize(): Promise<void> {
    if (this.stripe) return;

    this.config = await getStripePaymentConfig(this.tenantId);
    if (!this.config) {
      throw new Error('Stripe payment configuration not found for tenant');
    }

    this.stripe = new Stripe(this.config.secretKey, {
      apiVersion: '2024-12-18.acacia' as any,
      typescript: true,
    });
  }

  /**
   * Ensures the provider is initialized before use.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
  }

  /**
   * Gets the Stripe client, initializing if needed.
   */
  private async getStripe(): Promise<Stripe> {
    await this.ensureInitialized();
    if (!this.stripe) {
      throw new Error('Stripe client not initialized');
    }
    return this.stripe;
  }

  /**
   * Gets the webhook secret, initializing if needed.
   */
  private async getWebhookSecret(): Promise<string> {
    await this.ensureInitialized();
    if (!this.config?.webhookSecret) {
      throw new Error('Stripe webhook secret not configured');
    }
    return this.config.webhookSecret;
  }

  capabilities(): PaymentProviderCapabilities {
    return {
      supportsPaymentLinks: true,
      supportsHostedCheckout: true,
      supportsEmbeddedCheckout: true,
      supportsWebhooks: true,
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'NZD'],
      supportsPartialPayments: false, // Not implementing partial payments initially
      supportsRefunds: true,
      supportsSavedPaymentMethods: true,
    };
  }

  /**
   * Gets or creates a Stripe customer for a client.
   */
  async getOrCreateCustomer(clientId: string, email: string, name: string): Promise<string> {
    const stripe = await this.getStripe();
    const knex = await getConnection();

    // Check if we already have a mapping
    const existingMapping = await knex<IClientPaymentCustomer>('client_payment_customers')
      .where({
        tenant: this.tenantId,
        client_id: clientId,
        provider_type: 'stripe',
      })
      .first();

    if (existingMapping) {
      // Verify the customer still exists in Stripe
      try {
        const customer = await stripe.customers.retrieve(existingMapping.external_customer_id);
        if (!customer.deleted) {
          return existingMapping.external_customer_id;
        }
      } catch (error) {
        logger.warn('[StripePaymentProvider] Existing customer not found in Stripe, creating new', {
          tenantId: this.tenantId,
          clientId,
          oldCustomerId: existingMapping.external_customer_id,
        });
      }
    }

    // Search for existing customer by email in Stripe
    const existingCustomers = await stripe.customers.list({
      email,
      limit: 1,
    });

    let customerId: string;

    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
      logger.info('[StripePaymentProvider] Found existing Stripe customer by email', {
        tenantId: this.tenantId,
        clientId,
        customerId,
        email,
      });
    } else {
      // Create new customer in Stripe
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          tenant_id: this.tenantId,
          client_id: clientId,
          source: 'alga_psa_invoice_payment',
        },
      });
      customerId = customer.id;
      logger.info('[StripePaymentProvider] Created new Stripe customer', {
        tenantId: this.tenantId,
        clientId,
        customerId,
        email,
      });
    }

    // Store or update the mapping
    await knex<IClientPaymentCustomer>('client_payment_customers')
      .insert({
        tenant: this.tenantId,
        client_id: clientId,
        provider_type: 'stripe',
        external_customer_id: customerId,
        email,
        metadata: { name },
        updated_at: knex.fn.now(),
      } as any)
      .onConflict(['tenant', 'client_id', 'provider_type'])
      .merge(['external_customer_id', 'email', 'metadata', 'updated_at']);

    return customerId;
  }

  /**
   * Creates a payment link (Stripe Checkout Session) for an invoice.
   */
  async createPaymentLink(request: CreatePaymentLinkRequest): Promise<PaymentLinkResult> {
    const stripe = await this.getStripe();
    const knex = await getConnection();

    // Get or create customer
    const customerId = await this.getOrCreateCustomer(
      request.clientId,
      request.clientEmail,
      request.clientName
    );

    // Calculate expiration (default 24 hours, max 24 hours for Stripe Checkout)
    const expiresAt = request.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000);
    const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: request.currency.toLowerCase(),
            product_data: {
              name: request.description,
              description: `Payment for Invoice`,
            },
            unit_amount: request.amount, // Already in cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        ...request.metadata,
        tenant_id: this.tenantId,
        invoice_id: request.invoiceId,
        client_id: request.clientId,
      },
      success_url: request.successUrl,
      cancel_url: request.cancelUrl || request.successUrl.replace('/payment-success', ''),
      expires_at: expiresAtUnix,
      payment_intent_data: {
        metadata: {
          ...request.metadata,
          tenant_id: this.tenantId,
          invoice_id: request.invoiceId,
          client_id: request.clientId,
        },
      },
    });

    // Store the payment link
    const linkRecord: Partial<IInvoicePaymentLink> = {
      tenant: this.tenantId,
      invoice_id: request.invoiceId,
      provider_type: 'stripe',
      external_link_id: session.id,
      url: session.url!,
      amount: request.amount,
      currency: request.currency.toUpperCase(),
      status: 'active',
      expires_at: expiresAt.toISOString(),
      metadata: {
        stripe_customer_id: customerId,
        payment_intent: session.payment_intent,
      },
    };

    // Check for existing active link and mark it as replaced
    await knex('invoice_payment_links')
      .where({
        tenant: this.tenantId,
        invoice_id: request.invoiceId,
        provider_type: 'stripe',
        status: 'active',
      })
      .update({
        status: 'cancelled',
        metadata: knex.raw(`metadata || '{"replaced": true}'::jsonb`),
      });

    // Insert new link
    await knex<IInvoicePaymentLink>('invoice_payment_links').insert(linkRecord as any);

    logger.info('[StripePaymentProvider] Created payment link', {
      tenantId: this.tenantId,
      invoiceId: request.invoiceId,
      sessionId: session.id,
      amount: request.amount,
      currency: request.currency,
    });

    return {
      paymentLinkId: session.id, // Use session ID as link ID
      externalLinkId: session.id,
      url: session.url!,
      expiresAt,
      provider: 'stripe',
    };
  }

  /**
   * Verifies the signature of a Stripe webhook payload.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    // Note: This is synchronous but we need the webhook secret
    // In practice, this should be called after initialization
    if (!this.config?.webhookSecret) {
      throw new Error('Stripe webhook secret not configured');
    }

    try {
      // Stripe's constructEvent throws if signature is invalid
      Stripe.webhooks.constructEvent(payload, signature, this.config.webhookSecret);
      return true;
    } catch (error) {
      logger.warn('[StripePaymentProvider] Webhook signature verification failed', {
        tenantId: this.tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Parses a Stripe webhook payload into a PaymentWebhookEvent.
   */
  parseWebhookEvent(payload: string): PaymentWebhookEvent {
    const event = JSON.parse(payload) as Stripe.Event;

    let invoiceId: string | undefined;
    let amount: number | undefined;
    let currency: string | undefined;
    let status: PaymentStatus = 'pending';
    let paymentIntentId: string | undefined;
    let customerId: string | undefined;

    // Extract data based on event type
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        invoiceId = session.metadata?.invoice_id;
        amount = session.amount_total || undefined;
        currency = session.currency?.toUpperCase();
        customerId = session.customer as string;
        paymentIntentId = session.payment_intent as string;

        if (session.payment_status === 'paid') {
          status = 'succeeded';
        } else if (session.payment_status === 'unpaid') {
          status = 'pending';
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        invoiceId = paymentIntent.metadata?.invoice_id;
        amount = paymentIntent.amount;
        currency = paymentIntent.currency?.toUpperCase();
        customerId = paymentIntent.customer as string;
        paymentIntentId = paymentIntent.id;
        status = 'succeeded';
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        invoiceId = paymentIntent.metadata?.invoice_id;
        amount = paymentIntent.amount;
        currency = paymentIntent.currency?.toUpperCase();
        customerId = paymentIntent.customer as string;
        paymentIntentId = paymentIntent.id;
        status = 'failed';
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        invoiceId = session.metadata?.invoice_id;
        customerId = session.customer as string;
        status = 'cancelled';
        break;
      }

      default:
        // For other events, try to extract common fields
        const obj = event.data.object as any;
        invoiceId = obj.metadata?.invoice_id;
        customerId = obj.customer;
        break;
    }

    return {
      eventId: event.id,
      eventType: event.type,
      provider: 'stripe',
      payload: event,
      invoiceId,
      amount,
      currency,
      status,
      paymentIntentId,
      customerId,
    };
  }

  /**
   * Retrieves details about a specific payment.
   */
  async getPaymentDetails(paymentId: string): Promise<PaymentDetails> {
    const stripe = await this.getStripe();

    // paymentId could be a PaymentIntent ID or Charge ID
    let paymentIntent: Stripe.PaymentIntent;

    if (paymentId.startsWith('pi_')) {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentId, {
        expand: ['latest_charge'],
      });
    } else if (paymentId.startsWith('ch_')) {
      const charge = await stripe.charges.retrieve(paymentId);
      if (!charge.payment_intent) {
        throw new Error('Charge has no associated payment intent');
      }
      paymentIntent = await stripe.paymentIntents.retrieve(charge.payment_intent as string, {
        expand: ['latest_charge'],
      });
    } else {
      throw new Error(`Invalid payment ID format: ${paymentId}`);
    }

    const charge = paymentIntent.latest_charge as Stripe.Charge | null;

    return {
      paymentId: paymentIntent.id,
      status: this.mapPaymentIntentStatus(paymentIntent.status),
      amount: paymentIntent.amount,
      currency: paymentIntent.currency.toUpperCase(),
      createdAt: new Date(paymentIntent.created * 1000),
      completedAt: paymentIntent.status === 'succeeded'
        ? new Date(paymentIntent.created * 1000)
        : undefined,
      paymentMethodType: charge?.payment_method_details?.type,
      cardLast4: charge?.payment_method_details?.card?.last4,
      cardBrand: charge?.payment_method_details?.card?.brand,
      receiptUrl: charge?.receipt_url || undefined,
      metadata: paymentIntent.metadata,
    };
  }

  /**
   * Retrieves the current status of a payment link/checkout session.
   */
  async getPaymentLinkStatus(externalLinkId: string): Promise<PaymentDetails | null> {
    const stripe = await this.getStripe();

    try {
      const session = await stripe.checkout.sessions.retrieve(externalLinkId, {
        expand: ['payment_intent'],
      });

      if (!session.payment_intent) {
        // Session exists but no payment yet
        return {
          paymentId: session.id,
          status: session.status === 'expired' ? 'cancelled' : 'pending',
          amount: session.amount_total || 0,
          currency: session.currency?.toUpperCase() || 'USD',
          createdAt: new Date(session.created * 1000),
          metadata: session.metadata || undefined,
        };
      }

      const paymentIntent = session.payment_intent as Stripe.PaymentIntent;

      return {
        paymentId: paymentIntent.id,
        status: this.mapPaymentIntentStatus(paymentIntent.status),
        amount: paymentIntent.amount,
        currency: paymentIntent.currency.toUpperCase(),
        createdAt: new Date(paymentIntent.created * 1000),
        completedAt: paymentIntent.status === 'succeeded'
          ? new Date(paymentIntent.created * 1000)
          : undefined,
        metadata: paymentIntent.metadata,
      };
    } catch (error) {
      logger.warn('[StripePaymentProvider] Failed to get payment link status', {
        tenantId: this.tenantId,
        externalLinkId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Maps Stripe PaymentIntent status to our PaymentStatus.
   */
  private mapPaymentIntentStatus(status: Stripe.PaymentIntent.Status): PaymentStatus {
    switch (status) {
      case 'succeeded':
        return 'succeeded';
      case 'processing':
        return 'processing';
      case 'requires_action':
      case 'requires_confirmation':
      case 'requires_payment_method':
        return 'requires_action';
      case 'canceled':
        return 'cancelled';
      default:
        return 'pending';
    }
  }

  /**
   * Creates a static instance for webhook verification (before tenant is known).
   */
  static async createForWebhookVerification(): Promise<StripePaymentProvider> {
    // For initial webhook verification, we use a temporary instance
    // The actual tenant will be determined from the event payload
    const provider = new StripePaymentProvider('system');
    await provider.ensureInitialized();
    return provider;
  }

  /**
   * Gets the publishable key for client-side Stripe initialization.
   */
  async getPublishableKey(): Promise<string> {
    await this.ensureInitialized();
    if (!this.config?.publishableKey) {
      throw new Error('Stripe publishable key not configured');
    }
    return this.config.publishableKey;
  }
}

/**
 * Factory function to create a StripePaymentProvider for a tenant.
 */
export function createStripePaymentProvider(tenantId: string): StripePaymentProvider {
  return new StripePaymentProvider(tenantId);
}

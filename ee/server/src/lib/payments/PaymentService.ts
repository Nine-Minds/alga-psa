/**
 * PaymentService - Orchestration layer for payment operations
 *
 * This service coordinates between payment providers, invoice system,
 * and transaction recording. It provides a high-level API for:
 * - Checking payment provider availability
 * - Creating payment links for invoices
 * - Processing payment webhooks
 * - Recording payments and updating invoice status
 */

import { Knex } from 'knex';
import { getConnection } from 'server/src/lib/db/db';
import logger from '@alga-psa/shared/core/logger';
import {
  PaymentProvider,
  PaymentLinkResult,
  PaymentWebhookEvent,
  WebhookProcessingResult,
  PaymentSettings,
  DEFAULT_PAYMENT_SETTINGS,
  IPaymentProviderConfig,
  IInvoicePaymentLink,
  IPaymentWebhookEvent,
  PaymentDetails,
  CreatePaymentLinkRequest,
} from 'server/src/interfaces/payment.interfaces';
import { PaymentProviderRegistry, PAYMENT_PROVIDER_TYPES } from './PaymentProviderRegistry';
import { createStripePaymentProvider } from './StripePaymentProvider';
import { recordTransaction } from 'server/src/lib/utils/transactionUtils';

/**
 * Invoice data needed for payment operations.
 */
interface InvoiceData {
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  total_amount: number;
  currency?: string;
  status: string;
}

/**
 * Client data needed for payment operations.
 */
interface ClientData {
  company_id: string;
  company_name: string;
  billing_email?: string;
  location_email?: string;
}

export class PaymentService {
  private tenantId: string;
  private knex!: Knex;
  private provider: PaymentProvider | null = null;

  private constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Creates a PaymentService instance for a tenant.
   */
  static async create(tenantId: string): Promise<PaymentService> {
    const service = new PaymentService(tenantId);
    service.knex = await getConnection();

    // Initialize provider if configured
    await service.initializeProvider();

    return service;
  }

  /**
   * Initializes the payment provider based on tenant configuration.
   */
  private async initializeProvider(): Promise<void> {
    const config = await this.getProviderConfig();
    if (!config) {
      logger.debug('[PaymentService] No payment provider configured', {
        tenantId: this.tenantId,
      });
      return;
    }

    // Currently only Stripe is supported
    if (config.provider_type === PAYMENT_PROVIDER_TYPES.STRIPE) {
      this.provider = createStripePaymentProvider(this.tenantId);
    }
  }

  /**
   * Gets the enabled payment provider configuration.
   */
  private async getProviderConfig(): Promise<IPaymentProviderConfig | null> {
    const config = await this.knex<IPaymentProviderConfig>('payment_provider_configs')
      .where({
        tenant: this.tenantId,
        is_enabled: true,
      })
      .orderBy('is_default', 'desc')
      .first();

    return config || null;
  }

  /**
   * Checks if a payment provider is configured and enabled.
   */
  async hasEnabledProvider(): Promise<boolean> {
    const config = await this.getProviderConfig();
    return config !== null;
  }

  /**
   * Gets the current payment settings for the tenant.
   */
  async getPaymentSettings(): Promise<PaymentSettings> {
    const config = await this.getProviderConfig();
    if (!config) {
      return DEFAULT_PAYMENT_SETTINGS;
    }

    const settings = config.settings as Partial<PaymentSettings> | undefined;
    return {
      ...DEFAULT_PAYMENT_SETTINGS,
      ...settings,
      defaultProvider: config.provider_type,
    };
  }

  /**
   * Gets or creates a payment link for an invoice.
   * Returns existing active link if one exists and is not expired.
   */
  async getOrCreatePaymentLink(invoiceId: string): Promise<PaymentLinkResult | null> {
    if (!this.provider) {
      logger.debug('[PaymentService] No payment provider configured', {
        tenantId: this.tenantId,
        invoiceId,
      });
      return null;
    }

    // Check for existing active payment link
    const existingLink = await this.knex<IInvoicePaymentLink>('invoice_payment_links')
      .where({
        tenant: this.tenantId,
        invoice_id: invoiceId,
        provider_type: this.provider.providerType,
        status: 'active',
      })
      .where('expires_at', '>', new Date().toISOString())
      .first();

    if (existingLink) {
      logger.debug('[PaymentService] Using existing payment link', {
        tenantId: this.tenantId,
        invoiceId,
        linkId: existingLink.link_id,
      });

      return {
        paymentLinkId: existingLink.link_id,
        externalLinkId: existingLink.external_link_id,
        url: existingLink.url,
        expiresAt: existingLink.expires_at ? new Date(existingLink.expires_at) : undefined,
        provider: existingLink.provider_type,
      };
    }

    // Get invoice and client data
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }

    if (invoice.status === 'paid' || invoice.status === 'cancelled') {
      logger.debug('[PaymentService] Invoice not payable', {
        tenantId: this.tenantId,
        invoiceId,
        status: invoice.status,
      });
      return null;
    }

    const client = await this.getClient(invoice.client_id);
    if (!client) {
      throw new Error(`Client not found: ${invoice.client_id}`);
    }

    const clientEmail = client.billing_email || client.location_email;
    if (!clientEmail) {
      throw new Error(`No email address for client: ${client.company_name}`);
    }

    // Get payment settings for expiration
    const settings = await this.getPaymentSettings();
    const expiresAt = new Date(Date.now() + settings.paymentLinkExpirationHours * 60 * 60 * 1000);

    // Build success URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const successUrl = `${baseUrl}/portal/invoices/${invoiceId}/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/portal/invoices/${invoiceId}`;

    // Create payment link
    const request: CreatePaymentLinkRequest = {
      invoiceId,
      amount: invoice.total_amount,
      currency: invoice.currency || 'USD',
      description: `Invoice ${invoice.invoice_number}`,
      clientId: client.company_id,
      clientEmail,
      clientName: client.company_name,
      metadata: {
        tenant_id: this.tenantId,
        invoice_id: invoiceId,
        invoice_number: invoice.invoice_number,
        client_id: client.company_id,
      },
      expiresAt,
      successUrl,
      cancelUrl,
    };

    const result = await this.provider.createPaymentLink(request);

    logger.info('[PaymentService] Created payment link', {
      tenantId: this.tenantId,
      invoiceId,
      paymentLinkId: result.paymentLinkId,
    });

    return result;
  }

  /**
   * Processes a payment webhook event.
   */
  async processWebhookEvent(event: PaymentWebhookEvent): Promise<WebhookProcessingResult> {
    // Check for duplicate event (idempotency)
    const existingEvent = await this.knex<IPaymentWebhookEvent>('payment_webhook_events')
      .where({
        tenant: this.tenantId,
        provider_type: event.provider,
        external_event_id: event.eventId,
      })
      .first();

    if (existingEvent?.processed) {
      logger.debug('[PaymentService] Webhook event already processed', {
        tenantId: this.tenantId,
        eventId: event.eventId,
        eventType: event.eventType,
      });
      return {
        success: true,
        paymentRecorded: false,
      };
    }

    // Store the event for tracking
    const eventRecord: Partial<IPaymentWebhookEvent> = {
      tenant: this.tenantId,
      provider_type: event.provider,
      external_event_id: event.eventId,
      event_type: event.eventType,
      event_data: event.payload as Record<string, unknown>,
      invoice_id: event.invoiceId,
      processed: false,
      processing_status: 'processing',
    };

    if (!existingEvent) {
      await this.knex<IPaymentWebhookEvent>('payment_webhook_events').insert(eventRecord as any);
    } else {
      await this.knex<IPaymentWebhookEvent>('payment_webhook_events')
        .where({ event_id: existingEvent.event_id })
        .update({ processing_status: 'processing' });
    }

    try {
      const result = await this.handleWebhookEvent(event);

      // Update event as processed
      await this.knex<IPaymentWebhookEvent>('payment_webhook_events')
        .where({
          tenant: this.tenantId,
          provider_type: event.provider,
          external_event_id: event.eventId,
        })
        .update({
          processed: true,
          processing_status: 'completed',
          processed_at: this.knex.fn.now(),
          invoice_id: event.invoiceId || result.invoiceId,
        });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update event as failed
      await this.knex<IPaymentWebhookEvent>('payment_webhook_events')
        .where({
          tenant: this.tenantId,
          provider_type: event.provider,
          external_event_id: event.eventId,
        })
        .update({
          processing_status: 'failed',
          processing_error: errorMessage,
        });

      logger.error('[PaymentService] Webhook processing failed', {
        tenantId: this.tenantId,
        eventId: event.eventId,
        eventType: event.eventType,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handles specific webhook event types.
   */
  private async handleWebhookEvent(event: PaymentWebhookEvent): Promise<WebhookProcessingResult> {
    switch (event.eventType) {
      case 'checkout.session.completed':
        return this.handleCheckoutCompleted(event);

      case 'payment_intent.succeeded':
        return this.handlePaymentSucceeded(event);

      case 'payment_intent.payment_failed':
        return this.handlePaymentFailed(event);

      case 'checkout.session.expired':
        return this.handleCheckoutExpired(event);

      default:
        logger.debug('[PaymentService] Unhandled webhook event type', {
          tenantId: this.tenantId,
          eventType: event.eventType,
        });
        return { success: true, paymentRecorded: false };
    }
  }

  /**
   * Handles checkout.session.completed event.
   */
  private async handleCheckoutCompleted(event: PaymentWebhookEvent): Promise<WebhookProcessingResult> {
    if (event.status !== 'succeeded' || !event.invoiceId) {
      return { success: true, paymentRecorded: false };
    }

    // Record the payment
    const result = await this.recordPaymentFromWebhook(event);

    // Update payment link status
    await this.updatePaymentLinkStatus(event.invoiceId, 'completed');

    return result;
  }

  /**
   * Handles payment_intent.succeeded event.
   */
  private async handlePaymentSucceeded(event: PaymentWebhookEvent): Promise<WebhookProcessingResult> {
    if (!event.invoiceId) {
      logger.warn('[PaymentService] Payment succeeded without invoice_id', {
        tenantId: this.tenantId,
        eventId: event.eventId,
        paymentIntentId: event.paymentIntentId,
      });
      return { success: true, paymentRecorded: false };
    }

    // Check if already recorded (from checkout.session.completed)
    const existingPayment = await this.knex('invoice_payments')
      .where({
        tenant: this.tenantId,
        invoice_id: event.invoiceId,
        reference_number: event.paymentIntentId,
      })
      .first();

    if (existingPayment) {
      logger.debug('[PaymentService] Payment already recorded', {
        tenantId: this.tenantId,
        invoiceId: event.invoiceId,
        paymentIntentId: event.paymentIntentId,
      });
      return { success: true, paymentRecorded: false, paymentId: existingPayment.payment_id };
    }

    return this.recordPaymentFromWebhook(event);
  }

  /**
   * Handles payment_intent.payment_failed event.
   */
  private async handlePaymentFailed(event: PaymentWebhookEvent): Promise<WebhookProcessingResult> {
    logger.warn('[PaymentService] Payment failed', {
      tenantId: this.tenantId,
      invoiceId: event.invoiceId,
      paymentIntentId: event.paymentIntentId,
    });

    // Could trigger notification to tenant about failed payment
    // For now, just log it

    return { success: true, paymentRecorded: false };
  }

  /**
   * Handles checkout.session.expired event.
   */
  private async handleCheckoutExpired(event: PaymentWebhookEvent): Promise<WebhookProcessingResult> {
    if (event.invoiceId) {
      await this.updatePaymentLinkStatus(event.invoiceId, 'expired');
    }
    return { success: true, paymentRecorded: false };
  }

  /**
   * Records a payment from a webhook event.
   */
  private async recordPaymentFromWebhook(event: PaymentWebhookEvent): Promise<WebhookProcessingResult> {
    if (!event.invoiceId || !event.amount || !event.paymentIntentId) {
      throw new Error('Missing required payment data from webhook');
    }

    const invoice = await this.getInvoice(event.invoiceId);
    if (!invoice) {
      throw new Error(`Invoice not found: ${event.invoiceId}`);
    }

    // Use transaction for atomicity
    const paymentId = await this.knex.transaction(async (trx) => {
      // Insert payment record
      const [payment] = await trx('invoice_payments')
        .insert({
          tenant: this.tenantId,
          invoice_id: event.invoiceId,
          amount: event.amount,
          payment_method: `stripe_${event.provider}`,
          payment_date: new Date(),
          reference_number: event.paymentIntentId,
          notes: `Stripe payment via ${event.eventType}`,
        })
        .returning('payment_id');

      // Calculate total payments
      const totalPayments = await trx('invoice_payments')
        .where({
          tenant: this.tenantId,
          invoice_id: event.invoiceId,
        })
        .sum('amount as total')
        .first();

      const totalPaid = parseInt(totalPayments?.total || '0', 10);

      // Update invoice status
      let newStatus = invoice.status;
      if (totalPaid >= invoice.total_amount) {
        newStatus = 'paid';
      } else if (totalPaid > 0) {
        newStatus = 'partially_applied';
      }

      if (newStatus !== invoice.status) {
        await trx('invoices')
          .where({
            tenant: this.tenantId,
            invoice_id: event.invoiceId,
          })
          .update({
            status: newStatus,
            updated_at: trx.fn.now(),
          });
      }

      // Record transaction
      await recordTransaction(
        trx,
        {
          clientId: invoice.client_id,
          invoiceId: event.invoiceId,
          amount: event.amount!,
          type: 'payment',
          description: `Payment received via Stripe - ${event.paymentIntentId}`,
          metadata: {
            payment_provider: 'stripe',
            stripe_payment_intent_id: event.paymentIntentId,
            stripe_event_id: event.eventId,
            currency: event.currency,
          },
        },
        this.tenantId
      );

      logger.info('[PaymentService] Payment recorded', {
        tenantId: this.tenantId,
        invoiceId: event.invoiceId,
        paymentId: payment.payment_id,
        amount: event.amount,
        newStatus,
      });

      return payment.payment_id;
    });

    return {
      success: true,
      paymentRecorded: true,
      paymentId,
      invoiceId: event.invoiceId,
    };
  }

  /**
   * Updates the status of a payment link.
   */
  private async updatePaymentLinkStatus(
    invoiceId: string,
    status: 'completed' | 'expired' | 'cancelled'
  ): Promise<void> {
    await this.knex<IInvoicePaymentLink>('invoice_payment_links')
      .where({
        tenant: this.tenantId,
        invoice_id: invoiceId,
        status: 'active',
      })
      .update({
        status,
        completed_at: status === 'completed' ? this.knex.fn.now() : undefined,
      });
  }

  /**
   * Gets an invoice by ID.
   */
  private async getInvoice(invoiceId: string): Promise<InvoiceData | null> {
    return this.knex<InvoiceData>('invoices')
      .where({
        tenant: this.tenantId,
        invoice_id: invoiceId,
      })
      .first();
  }

  /**
   * Gets a client by ID.
   */
  private async getClient(clientId: string): Promise<ClientData | null> {
    return this.knex<ClientData>('companies')
      .where({
        tenant: this.tenantId,
        company_id: clientId,
      })
      .first();
  }

  /**
   * Gets payment details for an invoice.
   */
  async getInvoicePaymentStatus(invoiceId: string): Promise<PaymentDetails | null> {
    if (!this.provider) {
      return null;
    }

    const link = await this.knex<IInvoicePaymentLink>('invoice_payment_links')
      .where({
        tenant: this.tenantId,
        invoice_id: invoiceId,
        provider_type: this.provider.providerType,
      })
      .orderBy('created_at', 'desc')
      .first();

    if (!link) {
      return null;
    }

    return this.provider.getPaymentLinkStatus(link.external_link_id);
  }

  /**
   * Gets the active payment link for an invoice.
   */
  async getActivePaymentLink(invoiceId: string): Promise<IInvoicePaymentLink | null> {
    return this.knex<IInvoicePaymentLink>('invoice_payment_links')
      .where({
        tenant: this.tenantId,
        invoice_id: invoiceId,
        status: 'active',
      })
      .where('expires_at', '>', new Date().toISOString())
      .first() || null;
  }

  /**
   * Gets the provider type if configured.
   */
  getProviderType(): string | null {
    return this.provider?.providerType || null;
  }
}

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import type { WebhookProcessingResult } from '@alga-psa/types';

async function loadEnterprisePayments(): Promise<{
  PaymentService: any;
  createStripePaymentProvider: any;
} | null> {
  try {
    const mod = await import('@enterprise/lib/payments');
    return {
      PaymentService: (mod as any).PaymentService,
      createStripePaymentProvider: (mod as any).createStripePaymentProvider,
    };
  } catch (error) {
    logger.debug('[Stripe Payment Webhook] enterprise payments module not available', { error });
    return null;
  }
}

/**
 * POST /api/webhooks/stripe/payments
 *
 * Stripe webhook endpoint for processing invoice payment events.
 * This is separate from the license management webhook at /api/webhooks/stripe.
 *
 * Events handled:
 * - checkout.session.completed: Payment completed via Checkout
 * - payment_intent.succeeded: Payment intent succeeded
 * - payment_intent.payment_failed: Payment failed
 * - checkout.session.expired: Checkout session expired
 *
 * Security:
 * - Verifies Stripe webhook signature
 * - Uses payment_webhook_events table for idempotency
 *
 * Configuration required in Stripe Dashboard:
 * 1. Go to Developers → Webhooks
 * 2. Add endpoint: https://your-domain.com/api/webhooks/stripe/payments
 * 3. Select events:
 *    - checkout.session.completed
 *    - payment_intent.succeeded
 *    - payment_intent.payment_failed
 *    - checkout.session.expired
 * 4. Store webhook signing secret in the secret provider
 */

async function getWebhookSecret(): Promise<string> {
  const secretProvider = await getSecretProviderInstance();

  // Try payment-specific webhook secret first
  let webhookSecret = await secretProvider.getAppSecret('stripe_payment_webhook_secret');

  // Fall back to main webhook secret if payment-specific not set
  if (!webhookSecret) {
    webhookSecret = await secretProvider.getAppSecret('stripe_webhook_secret');
  }

  if (!webhookSecret) {
    throw new Error('Stripe webhook secret not configured');
  }

  return webhookSecret;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // Check if running Enterprise Edition
  const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  if (!isEE) {
    logger.warn('[Stripe Payment Webhook] Only available in Enterprise Edition');
    return NextResponse.json(
      { error: 'Stripe integration is only available in Enterprise Edition' },
      { status: 404 }
    );
  }

  try {
    // Get raw body as text (needed for signature verification)
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      logger.error('[Stripe Payment Webhook] Missing stripe-signature header');
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    // Get webhook secret
    let webhookSecret: string;
    try {
      webhookSecret = await getWebhookSecret();
    } catch {
      logger.error('[Stripe Payment Webhook] Failed to get webhook secret');
      return NextResponse.json(
        { error: 'Webhook configuration error' },
        { status: 503 }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(body, signature, webhookSecret);
      logger.info('[Stripe Payment Webhook] Signature verified', {
        eventId: event.id,
        eventType: event.type,
      });
    } catch (error) {
      logger.error('[Stripe Payment Webhook] Signature verification failed:', error);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Check for license-order events FIRST (before tenant_id routing).
    // License orders carry is_license_order: 'true' in session metadata.
    if (isLicenseOrderEvent(event)) {
      const licenseResult = await handleLicenseOrderWebhook(event);
      const processingTime = Date.now() - startTime;
      logger.info('[Stripe Payment Webhook] License order event processed', {
        eventId: event.id,
        eventType: event.type,
        success: licenseResult.success,
        processingTimeMs: processingTime,
      });
      return NextResponse.json({
        received: true,
        processed: licenseResult.success,
        purpose: 'license_order',
        processingTimeMs: processingTime,
        ...(licenseResult.error ? { error: licenseResult.error } : {}),
      });
    }

    // Extract tenant ID from event metadata
    const tenantId = extractTenantId(event);
    if (!tenantId) {
      logger.warn('[Stripe Payment Webhook] No tenant_id in event metadata', {
        eventId: event.id,
        eventType: event.type,
      });
      // Return 200 to acknowledge - this might be a non-payment event
      return NextResponse.json({
        received: true,
        processed: false,
        reason: 'no_tenant_id',
      });
    }

    const result = await processStripePaymentWebhookPayload(tenantId, body);

    const processingTime = Date.now() - startTime;

    if (result.success) {
      logger.info('[Stripe Payment Webhook] Event processed successfully', {
        eventId: event.id,
        eventType: event.type,
        tenantId,
        paymentRecorded: result.paymentRecorded,
        processingTimeMs: processingTime,
      });

      return NextResponse.json({
        received: true,
        processed: true,
        eventId: event.id,
        paymentRecorded: result.paymentRecorded,
        processingTimeMs: processingTime,
      });
    } else {
      logger.error('[Stripe Payment Webhook] Event processing failed', {
        eventId: event.id,
        eventType: event.type,
        tenantId,
        error: result.error,
        processingTimeMs: processingTime,
      });

      // Return 200 to acknowledge receipt even if processing failed
      // This prevents Stripe from retrying immediately
      return NextResponse.json({
        received: true,
        processed: false,
        error: 'Processing failed (logged)',
      });
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error('[Stripe Payment Webhook] Unexpected error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      processingTimeMs: processingTime,
    });

    // Return 500 for unexpected errors
    // This will cause Stripe to retry the webhook
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function processStripePaymentWebhookPayload(tenantId: string, payload: string): Promise<WebhookProcessingResult> {
  if (process.env.EDITION !== 'ee' && process.env.NEXT_PUBLIC_EDITION !== 'enterprise') {
    return { success: false, error: 'Payment integration not available' } as WebhookProcessingResult;
  }

  try {
    const ee = await loadEnterprisePayments();
    if (!ee?.PaymentService || !ee?.createStripePaymentProvider) {
      return { success: false, error: 'Payment integration not available' } as WebhookProcessingResult;
    }

    const paymentService = await ee.PaymentService.create(tenantId);
    const provider = ee.createStripePaymentProvider(tenantId);
    const webhookEvent = provider.parseWebhookEvent(payload);

    return paymentService.processWebhookEvent(webhookEvent);
  } catch (error) {
    logger.error('[Stripe Payment Webhook] processStripePaymentWebhookPayload failed', { tenantId, error });
    return { success: false, error: 'Payment webhook processing failed' } as WebhookProcessingResult;
  }
}

/**
 * Extracts tenant_id from Stripe event metadata.
 */
function extractTenantId(event: Stripe.Event): string | null {
  const obj = event.data.object as any;

  // Try direct metadata
  if (obj.metadata?.tenant_id) {
    return obj.metadata.tenant_id;
  }

  // For checkout sessions, also check payment_intent
  if (event.type.startsWith('checkout.session')) {
    const session = obj as Stripe.Checkout.Session;
    if (session.metadata?.tenant_id) {
      return session.metadata.tenant_id;
    }
  }

  // For payment intents
  if (event.type.startsWith('payment_intent')) {
    const paymentIntent = obj as Stripe.PaymentIntent;
    if (paymentIntent.metadata?.tenant_id) {
      return paymentIntent.metadata.tenant_id;
    }
  }

  return null;
}

// ── License-order webhook handling ───────────────────────────────────────────

function isLicenseOrderEvent(event: Stripe.Event): boolean {
  if (event.type !== 'checkout.session.completed') return false;
  const session = event.data.object as Stripe.Checkout.Session;
  return session.metadata?.is_license_order === 'true';
}

async function handleLicenseOrderWebhook(
  event: Stripe.Event
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata ?? {};

    const submissionId = metadata.service_request_submission_id;
    const tier = metadata.tier as 'pro' | 'premium';
    const seats = metadata.seats ? parseInt(metadata.seats, 10) : undefined;
    const transport = metadata.transport;
    const stripeSubId = (session.subscription as string) || session.id;
    const paymentIntentId = (session.payment_intent as string) || session.id;

    if (!submissionId || !tier || !transport) {
      logger.error('[License Order Webhook] Missing required metadata', { eventId: event.id, metadata });
      return { success: false, error: 'missing_metadata' };
    }

    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const knex = await getAdminConnection();

    // Intentional admin lookup: tenant is derived from the submission before tenant-owned roots can be scoped.
    const submission = await knex('service_request_submissions')
      .where({ submission_id: submissionId })
      .first('submitted_payload', 'tenant', 'client_id');

    const tenant = submission?.tenant as string | undefined;
    const clientId = (submission?.client_id as string | undefined) ?? metadata.client_id;
    if (!tenant || !clientId) {
      logger.error('[License Order Webhook] Submission not found', { submissionId });
      return { success: false, error: 'submission_not_found' };
    }

    // Idempotency via payment_webhook_events (unique on tenant+provider+external id).
    // Temporal's workflow id (license-issue:{paymentIntentId}) is the exactly-once
    // backstop; this insert prevents redundant pre-workflow work.
    const inserted = await tenantDb(knex, tenant).table('payment_webhook_events')
      .insert({
        tenant,
        provider_type: 'stripe',
        external_event_id: event.id,
        event_type: event.type,
        event_data: JSON.stringify(event),
        processed: true,
        processing_status: 'completed',
        processed_at: knex.fn.now(),
      })
      .onConflict(['tenant', 'provider_type', 'external_event_id'])
      .ignore()
      .returning('event_id');

    if (!inserted || inserted.length === 0) {
      logger.info('[License Order Webhook] Already processed (idempotent)', { eventId: event.id });
      return { success: true };
    }

    // Client name → license customer (table is `clients`, PK client_id).
    const client = await tenantDb(knex, tenant).table('clients').where({ client_id: clientId, tenant }).first('client_name');
    const customer = (client?.client_name as string | undefined) ?? 'Unknown';

    // Start the issuance Temporal workflow (idempotent via workflow id)
    const { startApplianceLicenseIssuance } = await import('@enterprise/lib/workflows/applianceLicenseIssuanceTemporal');
    await startApplianceLicenseIssuance(paymentIntentId, {
      tenant,
      submissionId,
      clientId,
      customer,
      tier,
      seats,
      transport,
      stripeSubId,
    });

    logger.info('[License Order Webhook] Issuance workflow started', {
      eventId: event.id,
      workflowId: `license-issue:${paymentIntentId}`,
      submissionId,
    });

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[License Order Webhook] Failed', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * GET /api/webhooks/stripe/payments
 *
 * Health check endpoint for Stripe payment webhook configuration
 */
export async function GET(req: NextRequest) {
  void req;
  const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  if (!isEE) {
    return NextResponse.json({
      status: 'unavailable',
      message: 'Stripe payment integration is only available in Enterprise Edition',
      edition: 'community',
    });
  }

  let webhookSecretStatus = 'missing';
  try {
    await getWebhookSecret();
    webhookSecretStatus = 'configured';
  } catch {
    webhookSecretStatus = 'missing';
  }

  return NextResponse.json({
    status: 'ok',
    message: 'Stripe payment webhook endpoint is active',
    timestamp: new Date().toISOString(),
    webhookSecret: webhookSecretStatus,
    edition: 'enterprise',
    purpose: 'invoice_payments',
  });
}

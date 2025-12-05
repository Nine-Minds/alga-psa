import { NextRequest, NextResponse } from 'next/server';
import logger from '@alga-psa/shared/core/logger';

/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook endpoint for processing subscription events
 *
 * NOTE: This endpoint is only functional in Enterprise Edition.
 * In Community Edition, it returns a 404.
 *
 * Events handled (EE only):
 * - checkout.session.completed: New license purchase completed
 * - customer.subscription.created: Subscription created
 * - customer.subscription.updated: Subscription quantity or status changed
 * - customer.subscription.deleted: Subscription canceled
 *
 * Security:
 * - Verifies Stripe webhook signature using STRIPE_WEBHOOK_SECRET
 * - Uses stripe_webhook_events table for idempotency
 *
 * Configuration required in Stripe Dashboard:
 * 1. Go to Developers → Webhooks
 * 2. Add endpoint: https://your-domain.com/api/webhooks/stripe
 * 3. Select events:
 *    - checkout.session.completed
 *    - customer.subscription.created
 *    - customer.subscription.updated
 *    - customer.subscription.deleted
 * 4. Copy webhook signing secret to STRIPE_WEBHOOK_SECRET env var
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // Check if running Enterprise Edition
  const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  if (!isEE) {
    logger.warn('[Stripe Webhook] Stripe webhooks are only available in Enterprise Edition');
    return NextResponse.json(
      { error: 'Stripe integration is only available in Enterprise Edition' },
      { status: 404 }
    );
  }

  try {
    // Dynamically import EE StripeService (only available in EE builds)
    let getStripeService: any;
    try {
      const eeModule = await import('@ee/lib/stripe/StripeService');
      getStripeService = eeModule.getStripeService;
    } catch (importError) {
      logger.error('[Stripe Webhook] Failed to import StripeService (EE module not available)');
      return NextResponse.json(
        { error: 'Stripe integration not available' },
        { status: 503 }
      );
    }

    // Get raw body as text (needed for signature verification)
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      logger.error('[Stripe Webhook] Missing stripe-signature header');
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    logger.info('[Stripe Webhook] Received webhook request', {
      signaturePresent: !!signature,
      bodyLength: body.length,
    });

    // Initialize Stripe service
    const stripeService: any = getStripeService();

    // Verify webhook signature and construct event
    let event: any;
    try {
      event = await stripeService.verifyWebhookSignature(body, signature);
      logger.info('[Stripe Webhook] Signature verified successfully', {
        eventId: event.id,
        eventType: event.type,
      });
    } catch (error) {
      logger.error('[Stripe Webhook] Signature verification failed:', error);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Log event details
    logger.info('[Stripe Webhook] Processing event', {
      id: event.id,
      type: event.type,
      created: event.created,
      livemode: event.livemode,
    });

    // Process event through StripeService
    try {
      await stripeService.handleWebhookEvent(event);
    } catch (error) {
      logger.error('[Stripe Webhook] Error processing event:', {
        eventId: event.id,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Return 200 to acknowledge receipt even if processing failed
      // This prevents Stripe from retrying immediately
      // The error is logged and recorded in stripe_webhook_events table
      return NextResponse.json(
        {
          received: true,
          processed: false,
          error: 'Processing failed (logged)',
        },
        { status: 200 }
      );
    }

    const processingTime = Date.now() - startTime;

    logger.info('[Stripe Webhook] Event processed successfully', {
      eventId: event.id,
      eventType: event.type,
      processingTimeMs: processingTime,
    });

    // Return success
    return NextResponse.json(
      {
        received: true,
        processed: true,
        eventId: event.id,
        processingTimeMs: processingTime,
      },
      { status: 200 }
    );
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error('[Stripe Webhook] Unexpected error:', {
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

/**
 * GET /api/webhooks/stripe
 *
 * Health check endpoint for Stripe webhook configuration
 * Not used by Stripe, but useful for testing connectivity
 */
export async function GET(req: NextRequest) {
  const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  if (!isEE) {
    return NextResponse.json({
      status: 'unavailable',
      message: 'Stripe integration is only available in Enterprise Edition',
      edition: 'community',
    });
  }

  let webhookSecretStatus = 'missing';
  try {
    const { getStripeService } = await import('@ee/lib/stripe/StripeService');
    const stripeService = getStripeService();
    if (stripeService.config?.webhookSecret) {
      webhookSecretStatus = 'configured';
    }
  } catch {
    webhookSecretStatus = 'missing';
  }

  return NextResponse.json({
    status: 'ok',
    message: 'Stripe webhook endpoint is active',
    timestamp: new Date().toISOString(),
    webhookSecret: webhookSecretStatus,
    edition: 'enterprise',
  });
}

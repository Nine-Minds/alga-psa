import { NextRequest, NextResponse } from 'next/server';
import { getStripeService } from '@ee/lib/stripe/StripeService';
import logger from '@alga-psa/shared/core/logger';

/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook endpoint for processing subscription events
 *
 * Events handled:
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

  try {
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
    const stripeService = getStripeService();

    // Verify webhook signature and construct event
    let event;
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
  return NextResponse.json({
    status: 'ok',
    message: 'Stripe webhook endpoint is active',
    timestamp: new Date().toISOString(),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? 'configured' : 'missing',
  });
}

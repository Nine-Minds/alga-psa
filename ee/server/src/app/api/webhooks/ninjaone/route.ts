/**
 * NinjaOne Webhook Endpoint
 *
 * Receives and processes webhook callbacks from NinjaOne RMM platform.
 * Handles device events, alerts, and status updates.
 */

import { NextRequest, NextResponse } from 'next/server';
import logger from '@alga-psa/core/logger';
import {
  handleNinjaOneWebhook,
  verifyWebhookSignature,
  findIntegrationForWebhook,
} from '../../../../lib/integrations/ninjaone/webhooks/webhookHandler';
import { verifyWebhookRequest, getWebhookAuthHeaderName } from '../../../../lib/integrations/ninjaone/webhooks/webhookRegistration';
import { NinjaOneWebhookPayload } from '../../../../interfaces/ninjaone.interfaces';

// Disable body parsing - we need the raw body for signature verification
export const runtime = 'nodejs';

/**
 * Handle POST requests from NinjaOne webhooks
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  let rawBody: string | undefined;

  try {
    // Get the raw body for signature verification
    rawBody = await request.text();

    if (!rawBody) {
      logger.warn('[NinjaOne Webhook] Empty request body');
      return NextResponse.json(
        { success: false, error: 'Empty request body' },
        { status: 400 }
      );
    }

    // Parse the payload
    let payload: NinjaOneWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      logger.warn('[NinjaOne Webhook] Invalid JSON payload', { error: parseError });
      return NextResponse.json(
        { success: false, error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!payload.organizationId) {
      logger.warn('[NinjaOne Webhook] Missing organizationId');
      return NextResponse.json(
        { success: false, error: 'Missing organizationId' },
        { status: 400 }
      );
    }

    // Find the integration to get the webhook secret
    const context = await findIntegrationForWebhook(payload.organizationId);

    if (!context) {
      logger.warn('[NinjaOne Webhook] No integration found', {
        organizationId: payload.organizationId,
      });
      // Return 200 to prevent NinjaOne from retrying
      // The organization might not be mapped yet
      return NextResponse.json(
        { success: true, processed: false, reason: 'Organization not mapped' },
        { status: 200 }
      );
    }

    // Verify webhook authentication if secret is configured
    // We support two verification methods:
    // 1. Custom header (X-Alga-Webhook-Secret) - registered via NinjaOne webhook API
    // 2. HMAC signature (X-Ninja-Signature) - standard NinjaOne signature verification
    const webhookSecret = context.integration.settings?.webhook_secret;
    if (webhookSecret) {
      const customSecret = request.headers.get(getWebhookAuthHeaderName()) || '';
      const ninjaSignature = request.headers.get('X-Ninja-Signature') || '';

      // Try custom header first (our programmatic registration)
      const customHeaderValid = customSecret && verifyWebhookRequest(
        request.headers,
        webhookSecret
      );

      // Fall back to HMAC signature verification
      const signatureValid = ninjaSignature && verifyWebhookSignature(
        rawBody,
        ninjaSignature,
        webhookSecret
      );

      if (!customHeaderValid && !signatureValid) {
        logger.warn('[NinjaOne Webhook] Invalid authentication', {
          organizationId: payload.organizationId,
          hasCustomHeader: !!customSecret,
          hasSignature: !!ninjaSignature,
        });
        return NextResponse.json(
          { success: false, error: 'Invalid authentication' },
          { status: 401 }
        );
      }
    }

    logger.info('[NinjaOne Webhook] Received webhook', {
      organizationId: payload.organizationId,
      activityType: payload.activityType,
      deviceId: payload.deviceId,
      type: payload.type,
      status: payload.status,
    });

    // Process the webhook asynchronously but respond quickly
    // NinjaOne expects a response within a few seconds
    const result = await handleNinjaOneWebhook(payload);

    const duration = Date.now() - startTime;
    logger.info('[NinjaOne Webhook] Processed webhook', {
      organizationId: payload.organizationId,
      activityType: payload.activityType,
      result,
      duration,
    });

    return NextResponse.json({
      success: result.success,
      processed: result.processed,
      action: result.action,
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('[NinjaOne Webhook] Error processing webhook', {
      error: errorMessage,
      duration,
    });

    // Return 500 for unexpected errors - NinjaOne will retry
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Handle GET requests - health check for webhook endpoint
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'healthy',
    endpoint: 'ninjaone-webhook',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle OPTIONS requests for CORS preflight
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Ninja-Signature',
      'Access-Control-Max-Age': '86400',
    },
  });
}

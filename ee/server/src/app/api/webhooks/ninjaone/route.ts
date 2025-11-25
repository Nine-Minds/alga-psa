/**
 * NinjaOne Webhook Endpoint
 *
 * Receives and processes webhook callbacks from NinjaOne RMM platform.
 * Handles device events, alerts, and status updates.
 */

import { NextRequest, NextResponse } from 'next/server';
import logger from '@shared/core/logger';
import {
  handleNinjaOneWebhook,
  verifyWebhookSignature,
  findIntegrationForWebhook,
} from '../../../../lib/integrations/ninjaone/webhooks/webhookHandler';
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

    // Verify webhook signature if secret is configured
    const signature = request.headers.get('X-Ninja-Signature') || '';
    if (context.integration.webhook_secret) {
      if (!verifyWebhookSignature(rawBody, signature, context.integration.webhook_secret)) {
        logger.warn('[NinjaOne Webhook] Invalid signature', {
          organizationId: payload.organizationId,
        });
        return NextResponse.json(
          { success: false, error: 'Invalid signature' },
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

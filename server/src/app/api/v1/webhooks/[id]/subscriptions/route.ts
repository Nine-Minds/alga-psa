/**
 * Webhook Subscriptions API Routes
 * GET /api/v1/webhooks/{id}/subscriptions - List webhook subscriptions
 * POST /api/v1/webhooks/{id}/subscriptions - Create webhook subscription
 */

import { ApiWebhookController } from 'server/src/lib/api/controllers/ApiWebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.getSubscriptions()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.createSubscription()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
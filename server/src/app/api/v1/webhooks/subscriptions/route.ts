/**
 * Webhook Global Subscriptions API Routes
 * GET /api/v1/webhooks/subscriptions - List all subscriptions
 * POST /api/v1/webhooks/subscriptions - Create new subscription
 */

import { ApiWebhookControllerV2 } from 'server/src/lib/api/controllers/ApiWebhookControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWebhookControllerV2();
    return await controller.getSubscriptions()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiWebhookControllerV2();
    return await controller.createSubscription()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
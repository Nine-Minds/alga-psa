/**
 * Webhook Analytics API Route
 * GET /api/v1/webhooks/{id}/analytics - Get analytics for specific webhook
 */

import { WebhookController } from 'server/src/lib/api/controllers/WebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WebhookController();

export async function GET(request: Request) {
  try {
    return await controller.getWebhookAnalytics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
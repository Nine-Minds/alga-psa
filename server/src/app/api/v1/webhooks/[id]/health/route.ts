/**
 * Webhook Health API Route
 * GET /api/v1/webhooks/{id}/health - Get health status for specific webhook
 */

import { ApiWebhookController } from '@product/api/controllers/ApiWebhookController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.getHealth()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
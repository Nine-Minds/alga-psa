/**
 * Webhook System Analytics API Route
 * GET /api/v1/webhooks/analytics - Get system-wide webhook analytics
 */

import { ApiWebhookController } from '@product/api/controllers/ApiWebhookController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.getAnalytics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
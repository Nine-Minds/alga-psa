/**
 * Webhook System Analytics API Route
 * GET /api/v1/webhooks/analytics - Get system-wide webhook analytics
 */

import { ApiWebhookController } from 'server/src/lib/api/controllers/ApiWebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

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
/**
 * Webhook System Analytics API Route
 * GET /api/v1/webhooks/analytics - Get system-wide webhook analytics
 */

import { ApiWebhookControllerV2 } from 'server/src/lib/api/controllers/ApiWebhookControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWebhookControllerV2();
    return await controller.getAnalytics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Webhook System Health API Route
 * GET /api/v1/webhooks/health - Get webhook system health status
 */

import { ApiWebhookController } from 'server/src/lib/api/controllers/ApiWebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.getSystemHealth()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

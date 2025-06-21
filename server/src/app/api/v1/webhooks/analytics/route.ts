/**
 * Webhook System Analytics API Route
 * GET /api/v1/webhooks/analytics - Get system-wide webhook analytics
 */

import { WebhookController } from 'server/src/lib/api/controllers/WebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WebhookController();

export async function GET(request: Request) {
  try {
    return await controller.getAnalytics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
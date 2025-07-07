/**
 * Webhook Filter Test API Route
 * POST /api/v1/webhooks/{id}/filter/test - Test event filtering for specific webhook
 */

import { ApiWebhookControllerV2 } from 'server/src/lib/api/controllers/ApiWebhookControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiWebhookControllerV2();
    return await controller.testFilter()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
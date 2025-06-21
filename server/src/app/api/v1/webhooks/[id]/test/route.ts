/**
 * Webhook Test API Route
 * POST /api/v1/webhooks/{id}/test - Test specific webhook
 */

import { WebhookController } from 'server/src/lib/api/controllers/WebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WebhookController();

export async function POST(request: Request) {
  try {
    return await controller.testById()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
/**
 * Webhook Template Create API Route
 * POST /api/v1/webhooks/templates/{id}/create - Create webhook from template
 */

import { ApiWebhookController } from 'server/src/lib/api/controllers/ApiWebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.useTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
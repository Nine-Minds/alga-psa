/**
 * Webhook Validation API Route
 * POST /api/v1/webhooks/validate - Validate webhook configuration
 */

import { ApiWebhookController } from 'server/src/lib/api/controllers/ApiWebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.validateGeneric()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
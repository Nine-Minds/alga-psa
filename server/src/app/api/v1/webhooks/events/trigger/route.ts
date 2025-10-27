/**
 * Webhook Event Trigger API Route  
 * POST /api/v1/webhooks/events/trigger - Trigger webhook events
 */

import { ApiWebhookController } from '@product/api/controllers/ApiWebhookController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.triggerEvent()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
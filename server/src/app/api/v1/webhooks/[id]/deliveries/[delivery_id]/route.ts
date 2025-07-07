/**
 * Webhook Delivery Details API Route
 * GET /api/v1/webhooks/{id}/deliveries/{delivery_id} - Get delivery details
 */

import { ApiWebhookControllerV2 } from 'server/src/lib/api/controllers/ApiWebhookControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWebhookControllerV2();
    return await controller.getDelivery()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
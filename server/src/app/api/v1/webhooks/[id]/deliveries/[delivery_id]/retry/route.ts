/**
 * Webhook Delivery Retry API Route
 * POST /api/v1/webhooks/{id}/deliveries/{delivery_id}/retry - Retry failed delivery
 */

import { ApiWebhookController } from '@product/api/controllers/ApiWebhookController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.retryDelivery()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
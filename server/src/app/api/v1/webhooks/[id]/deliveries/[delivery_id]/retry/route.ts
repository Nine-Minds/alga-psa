/**
 * Webhook Delivery Retry API Route
 * POST /api/v1/webhooks/{id}/deliveries/{delivery_id}/retry - Retry failed delivery
 */

import { WebhookController } from 'server/src/lib/api/controllers/WebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new WebhookController();
    return await controller.retryDelivery()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
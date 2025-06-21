/**
 * Webhook Signature Verification API Route
 * POST /api/v1/webhooks/verify - Verify webhook signatures
 */

import { WebhookController } from 'server/src/lib/api/controllers/WebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WebhookController();

export async function POST(request: Request) {
  try {
    return await controller.verifySignature()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
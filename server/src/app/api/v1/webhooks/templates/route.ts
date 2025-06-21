/**
 * Webhook Templates API Routes
 * GET /api/v1/webhooks/templates - List webhook templates
 * POST /api/v1/webhooks/templates - Create webhook template
 */

import { WebhookController } from 'server/src/lib/api/controllers/WebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WebhookController();

export async function GET(request: Request) {
  try {
    return await controller.listTemplates()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
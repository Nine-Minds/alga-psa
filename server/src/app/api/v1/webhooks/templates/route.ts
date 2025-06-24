/**
 * Webhook Templates API Routes
 * GET /api/v1/webhooks/templates - List webhook templates
 * POST /api/v1/webhooks/templates - Create webhook template
 */

import { WebhookController } from 'server/src/lib/api/controllers/WebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new WebhookController();
    return await controller.listTemplates()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new WebhookController();
    return await controller.createTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
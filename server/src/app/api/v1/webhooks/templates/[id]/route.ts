/**
 * Webhook Template Detail API Routes
 * GET /api/v1/webhooks/templates/{id} - Get template details
 * PUT /api/v1/webhooks/templates/{id} - Update template
 * DELETE /api/v1/webhooks/templates/{id} - Delete template
 */

import { WebhookController } from 'server/src/lib/api/controllers/WebhookController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new WebhookController();
    // Using getById for template operations - the controller will handle template-specific logic
    return await controller.getById()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new WebhookController();
    return await controller.update()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new WebhookController();
    return await controller.delete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
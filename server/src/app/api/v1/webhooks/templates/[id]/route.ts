/**
 * Webhook Template Detail API Routes
 * GET /api/v1/webhooks/templates/{id} - Get template details
 * PUT /api/v1/webhooks/templates/{id} - Update template
 * DELETE /api/v1/webhooks/templates/{id} - Delete template
 */

import { ApiWebhookController } from '@product/api/controllers/ApiWebhookController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWebhookController();
    // Using getById for template operations - the controller will handle template-specific logic
    return await controller.getById()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.update()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new ApiWebhookController();
    return await controller.delete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
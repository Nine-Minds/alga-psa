/**
 * Automation Rule Detail API Routes
 * GET /api/v1/automation/rules/{id} - Get automation rule details
 * PUT /api/v1/automation/rules/{id} - Update automation rule
 * DELETE /api/v1/automation/rules/{id} - Delete automation rule
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AutomationController();

export async function GET(request: Request) {
  try {
    return await controller.getAutomationRule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.updateAutomationRule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.deleteAutomationRule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
/**
 * Automation Rule Detail API Routes
 * GET /api/v1/automation/rules/{id} - Get automation rule details
 * PUT /api/v1/automation/rules/{id} - Update automation rule
 * DELETE /api/v1/automation/rules/{id} - Delete automation rule
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new AutomationController();
    return await controller.getAutomationRule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new AutomationController();
    return await controller.updateAutomationRule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new AutomationController();
    return await controller.deleteAutomationRule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
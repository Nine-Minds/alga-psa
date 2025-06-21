/**
 * Automation Metadata API Route
 * GET /api/v1/automation/meta - Get automation rule types and categories
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AutomationController();

export async function GET(request: Request) {
  try {
    return await controller.getAutomationMeta()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
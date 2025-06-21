/**
 * Automation Template Use API Route
 * POST /api/v1/automation/templates/{id}/use - Create automation rule from template
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AutomationController();

export async function POST(request: Request) {
  try {
    return await controller.useAutomationTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
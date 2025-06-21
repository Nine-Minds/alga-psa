/**
 * Automation Rule Execute API Route
 * POST /api/v1/automation/rules/{id}/execute - Execute automation rule manually
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AutomationController();

export async function POST(request: Request) {
  try {
    return await controller.executeAutomationRule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
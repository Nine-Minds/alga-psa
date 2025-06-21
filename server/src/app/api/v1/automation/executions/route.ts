/**
 * Automation Executions API Routes
 * GET /api/v1/automation/executions - List automation executions
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AutomationController();

export async function GET(request: Request) {
  try {
    return await controller.listAutomationExecutions()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
/**
 * Automation Execution Retry API Route
 * POST /api/v1/automation/executions/{id}/retry - Retry failed automation execution
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AutomationController();

export async function POST(request: Request) {
  try {
    return await controller.retryAutomationExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
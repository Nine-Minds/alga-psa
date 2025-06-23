/**
 * Automation Execution Retry API Route
 * POST /api/v1/automation/executions/{id}/retry - Retry failed automation execution
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new AutomationController();
    return await controller.retryAutomationExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
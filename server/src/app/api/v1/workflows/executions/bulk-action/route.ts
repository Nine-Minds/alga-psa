/**
 * Bulk Workflow Execution Actions API Route
 * POST /api/v1/workflows/executions/bulk-action - Bulk workflow execution actions
 */

import { ApiWorkflowController } from 'server/src/lib/api/controllers/ApiWorkflowController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';


export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.bulkWorkflowExecutionAction()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
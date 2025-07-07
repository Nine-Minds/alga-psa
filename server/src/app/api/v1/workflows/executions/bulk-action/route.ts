/**
 * Bulk Workflow Execution Actions API Route
 * POST /api/v1/workflows/executions/bulk-action - Bulk workflow execution actions
 */

import { ApiWorkflowControllerV2 } from 'server/src/lib/api/controllers/ApiWorkflowControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';


export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowControllerV2();
    return await controller.bulkWorkflowExecutionAction()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
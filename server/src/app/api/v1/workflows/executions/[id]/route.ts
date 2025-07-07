/**
 * Individual Workflow Execution API Routes
 * GET /api/v1/workflows/executions/{id} - Get workflow execution details
 * PUT /api/v1/workflows/executions/{id} - Update workflow execution status
 */

import { ApiWorkflowControllerV2 } from 'server/src/lib/api/controllers/ApiWorkflowControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowControllerV2();
    return await controller.getWorkflowExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new ApiWorkflowControllerV2();
    return await controller.updateWorkflowExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Individual Workflow Execution API Routes
 * GET /api/v1/workflows/executions/{id} - Get workflow execution details
 * PUT /api/v1/workflows/executions/{id} - Update workflow execution status
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.getWorkflowExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.updateWorkflowExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
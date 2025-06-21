/**
 * Individual Workflow Execution API Routes
 * GET /api/v1/workflows/executions/{id} - Get workflow execution details
 * PUT /api/v1/workflows/executions/{id} - Update workflow execution status
 */

import { WorkflowController } from 'server/src/lib/api/controllers/WorkflowController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WorkflowController();

export async function GET(request: Request) {
  try {
    return await controller.getWorkflowExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.updateWorkflowExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
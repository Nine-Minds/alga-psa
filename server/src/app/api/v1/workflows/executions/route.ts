/**
 * Workflow Executions API Routes
 * GET /api/v1/workflows/executions - List workflow executions
 * POST /api/v1/workflows/executions - Create workflow execution
 */

import { WorkflowController } from 'server/src/lib/api/controllers/WorkflowController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WorkflowController();

export async function GET(request: Request) {
  try {
    return await controller.listWorkflowExecutions()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createWorkflowExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
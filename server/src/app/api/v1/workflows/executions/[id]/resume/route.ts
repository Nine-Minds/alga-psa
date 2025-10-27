/**
 * Resume Workflow Execution API Route
 * POST /api/v1/workflows/executions/{id}/resume - Resume workflow execution
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.resumeWorkflowExecution()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
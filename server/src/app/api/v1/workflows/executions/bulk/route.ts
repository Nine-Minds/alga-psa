/**
 * Bulk Workflow Executions API Route
 * POST /api/v1/workflows/executions/bulk - Bulk create workflow executions
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';


export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.bulkCreateWorkflowExecutions()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Complete Workflow Task API Route
 * POST /api/v1/workflows/tasks/{id}/complete - Complete workflow task
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';


export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.completeWorkflowTask()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
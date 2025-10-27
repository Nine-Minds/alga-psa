/**
 * Individual Workflow Task API Routes
 * GET /api/v1/workflows/tasks/{id} - Get workflow task details
 * PUT /api/v1/workflows/tasks/{id} - Update workflow task
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';


export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.getWorkflowTask()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.updateWorkflowTask()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
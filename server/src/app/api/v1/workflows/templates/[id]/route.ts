/**
 * Individual Workflow Template API Routes
 * GET /api/v1/workflows/templates/{id} - Get workflow template details
 * PUT /api/v1/workflows/templates/{id} - Update workflow template
 * DELETE /api/v1/workflows/templates/{id} - Delete workflow template
 */

import { ApiWorkflowControllerV2 } from 'server/src/lib/api/controllers/ApiWorkflowControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';


export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowControllerV2();
    return await controller.getWorkflowTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new ApiWorkflowControllerV2();
    return await controller.updateWorkflowTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new ApiWorkflowControllerV2();
    return await controller.deleteWorkflowTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
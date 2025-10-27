/**
 * Individual Workflow API Routes
 * GET /api/v1/workflows/{id} - Get workflow registration details
 * PUT /api/v1/workflows/{id} - Update workflow registration
 * DELETE /api/v1/workflows/{id} - Delete workflow registration
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.getWorkflowRegistration()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.updateWorkflowRegistration()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.deleteWorkflowRegistration()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Individual Workflow API Routes
 * GET /api/v1/workflows/{id} - Get workflow registration details
 * PUT /api/v1/workflows/{id} - Update workflow registration
 * DELETE /api/v1/workflows/{id} - Delete workflow registration
 */

import { WorkflowController } from 'server/src/lib/api/controllers/WorkflowController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WorkflowController();

export async function GET(request: Request) {
  try {
    return await controller.getWorkflowRegistration()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.updateWorkflowRegistration()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.deleteWorkflowRegistration()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
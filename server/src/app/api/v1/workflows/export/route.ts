/**
 * Workflow Export API Route
 * GET /api/v1/workflows/export - Export workflows to various formats
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';


export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.exportWorkflows()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

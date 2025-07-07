/**
 * Workflow Export API Route
 * GET /api/v1/workflows/export - Export workflows to various formats
 */

import { ApiWorkflowControllerV2 } from 'server/src/lib/api/controllers/ApiWorkflowControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';


export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowControllerV2();
    return await controller.exportWorkflows()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Workflow Export API Route
 * GET /api/v1/workflows/export - Export workflows to various formats
 */

import { WorkflowController } from 'server/src/lib/api/controllers/WorkflowController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WorkflowController();

export async function GET(request: Request) {
  try {
    return await controller.exportWorkflows()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
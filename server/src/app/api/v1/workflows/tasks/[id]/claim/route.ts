/**
 * Claim Workflow Task API Route
 * POST /api/v1/workflows/tasks/{id}/claim - Claim workflow task for execution
 */

import { WorkflowController } from 'server/src/lib/api/controllers/WorkflowController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';


export async function POST(request: Request) {
  try {
    const controller = new WorkflowController();
    return await controller.claimWorkflowTask()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
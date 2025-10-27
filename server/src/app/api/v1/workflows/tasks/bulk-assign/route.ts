/**
 * Bulk Workflow Task Assignment API Route
 * POST /api/v1/workflows/tasks/bulk-assign - Bulk assign workflow tasks
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';


export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.bulkAssignWorkflowTasks()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
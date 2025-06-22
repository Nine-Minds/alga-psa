/**
 * Bulk Workflow Task Assignment API Route
 * POST /api/v1/workflows/tasks/bulk-assign - Bulk assign workflow tasks
 */

import { WorkflowController } from 'server/src/lib/api/controllers/WorkflowController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new WorkflowController();

export async function POST(request: Request) {
  try {
    return await controller.bulkAssignWorkflowTasks()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
/**
 * Workflow Tasks API Routes
 * GET /api/v1/workflows/tasks - List workflow tasks
 * POST /api/v1/workflows/tasks - Create workflow task
 */

import { ApiWorkflowController } from '@product/api/controllers/ApiWorkflowController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';


export async function GET(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.listWorkflowTasks()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiWorkflowController();
    return await controller.createWorkflowTask()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
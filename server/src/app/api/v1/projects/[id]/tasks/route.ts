/**
 * Project Tasks List API Routes
 * GET /api/v1/projects/{id}/tasks - List project tasks
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function GET(request: Request) {
  try {
    return await controller.listTasks()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
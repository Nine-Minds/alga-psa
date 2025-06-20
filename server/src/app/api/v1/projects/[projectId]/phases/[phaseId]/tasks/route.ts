/**
 * Project Tasks API Routes
 * POST /api/v1/projects/{projectId}/phases/{phaseId}/tasks - Create project task
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function POST(request: Request) {
  try {
    return await controller.createTask()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
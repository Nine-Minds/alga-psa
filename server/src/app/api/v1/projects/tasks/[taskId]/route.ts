/**
 * Project Task Detail API Routes
 * PUT /api/v1/projects/tasks/{taskId} - Update project task
 * DELETE /api/v1/projects/tasks/{taskId} - Delete project task
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function PUT(request: Request) {
  try {
    return await controller.updateTask()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.deleteTask()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
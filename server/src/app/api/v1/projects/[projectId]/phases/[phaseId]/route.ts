/**
 * Project Phase Detail API Routes
 * PUT /api/v1/projects/{projectId}/phases/{phaseId} - Update project phase
 * DELETE /api/v1/projects/{projectId}/phases/{phaseId} - Delete project phase
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function PUT(request: Request) {
  try {
    return await controller.updatePhase()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.deletePhase()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
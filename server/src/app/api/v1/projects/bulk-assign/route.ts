/**
 * Project Bulk Assign API Route
 * PUT /api/v1/projects/bulk-assign - Bulk assign projects
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function PUT(request: Request) {
  try {
    return await controller.bulkAssign()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
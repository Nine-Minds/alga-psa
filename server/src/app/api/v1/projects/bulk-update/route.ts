/**
 * Project Bulk Update API Route
 * PUT /api/v1/projects/bulk-update - Bulk update projects
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function PUT(request: Request) {
  try {
    return await controller.bulkUpdate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
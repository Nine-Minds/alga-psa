/**
 * Project Bulk Status Update API Route
 * PUT /api/v1/projects/bulk-status - Bulk update project status
 */

import { ProjectController } from 'server/src/lib/api/controllers/ProjectController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ProjectController();

export async function PUT(request: Request) {
  try {
    return await controller.bulkStatusUpdate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
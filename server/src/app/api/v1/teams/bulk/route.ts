/**
 * Teams Bulk Operations API Route
 * PUT /api/v1/teams/bulk - Bulk update teams
 * DELETE /api/v1/teams/bulk - Bulk delete teams
 */

import { TeamController } from 'server/src/lib/api/controllers/TeamController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TeamController();

export async function PUT(request: Request) {
  try {
    return await controller.bulkUpdate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.bulkDelete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
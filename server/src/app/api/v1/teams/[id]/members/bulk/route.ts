/**
 * Team Members Bulk Operations API Route
 * POST /api/v1/teams/[id]/members/bulk - Bulk add members
 * DELETE /api/v1/teams/[id]/members/bulk - Bulk remove members
 */

import { TeamController } from 'server/src/lib/api/controllers/TeamController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TeamController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.bulkAddMembers()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.bulkRemoveMembers()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
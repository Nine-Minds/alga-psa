/**
 * Team Permission by ID API Route
 * DELETE /api/v1/teams/[id]/permissions/[permissionId] - Revoke team permission
 */

import { TeamController } from 'server/src/lib/api/controllers/TeamController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TeamController();

export async function DELETE(request: Request, { params }: { params: { id: string; permissionId: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.delete()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
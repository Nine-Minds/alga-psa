/**
 * User Team by ID API Route
 * DELETE /api/v1/users/[id]/teams/[teamId] - Remove user from team
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function DELETE(request: Request, { params }: { params: { id: string; teamId: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.removeUserFromTeam()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
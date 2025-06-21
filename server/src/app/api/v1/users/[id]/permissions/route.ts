/**
 * User Permissions API Route
 * GET /api/v1/users/[id]/permissions - Get user effective permissions
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getUserPermissions()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
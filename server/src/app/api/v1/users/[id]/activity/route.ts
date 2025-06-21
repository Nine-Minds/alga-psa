/**
 * User Activity API Route
 * GET /api/v1/users/[id]/activity - Get user activity logs
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getUserActivity()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
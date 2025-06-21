/**
 * User Password API Route
 * PUT /api/v1/users/[id]/password - Change user password
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.changePassword()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
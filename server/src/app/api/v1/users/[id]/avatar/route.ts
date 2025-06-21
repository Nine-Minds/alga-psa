/**
 * User Avatar API Route
 * POST /api/v1/users/[id]/avatar - Upload user avatar
 * DELETE /api/v1/users/[id]/avatar - Delete user avatar
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.uploadAvatar()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.deleteAvatar()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
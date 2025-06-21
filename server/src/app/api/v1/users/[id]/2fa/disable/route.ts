/**
 * User 2FA Disable API Route
 * DELETE /api/v1/users/[id]/2fa/disable - Disable two-factor authentication
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.disable2FA()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
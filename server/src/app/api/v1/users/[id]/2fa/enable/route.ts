/**
 * User 2FA Enable API Route
 * POST /api/v1/users/[id]/2fa/enable - Enable two-factor authentication
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.enable2FA()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
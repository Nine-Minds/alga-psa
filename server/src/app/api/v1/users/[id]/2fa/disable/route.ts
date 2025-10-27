/**
 * User 2FA Disable API Route
 * DELETE /api/v1/users/[id]/2fa/disable - Disable two-factor authentication
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiUserController();
    const req = request as any;
    req.params = params;
    return await controller.disable2FA()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
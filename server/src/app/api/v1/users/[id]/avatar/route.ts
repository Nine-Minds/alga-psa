/**
 * User Avatar API Route
 * POST /api/v1/users/[id]/avatar - Upload user avatar
 * DELETE /api/v1/users/[id]/avatar - Delete user avatar
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiUserControllerV2();
    const req = request as any;
    req.params = params;
    return await controller.uploadAvatar()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiUserControllerV2();
    const req = request as any;
    req.params = params;
    return await controller.deleteAvatar()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
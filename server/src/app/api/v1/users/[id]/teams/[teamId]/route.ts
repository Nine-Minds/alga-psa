/**
 * User Team by ID API Route
 * DELETE /api/v1/users/[id]/teams/[teamId] - Remove user from team
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; teamId: string }> }) {
  try {
    const controller = new ApiUserControllerV2();
    const req = request as any;
    req.params = params;
    return await controller.delete()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
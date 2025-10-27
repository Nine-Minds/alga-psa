/**
 * Users Bulk Deactivate API Route
 * PUT /api/v1/users/bulk/deactivate - Bulk activate/deactivate users
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function PUT(request: Request) {
  try {
    const controller = new ApiUserController();
    return await controller.update()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
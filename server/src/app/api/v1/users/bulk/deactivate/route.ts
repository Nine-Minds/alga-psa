/**
 * Users Bulk Deactivate API Route
 * PUT /api/v1/users/bulk/deactivate - Bulk activate/deactivate users
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function PUT(request: Request) {
  try {
    const controller = new UserController();
    return await controller.update()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
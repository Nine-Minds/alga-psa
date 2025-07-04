/**
 * Permission Checks API Route
 * POST /api/v1/permission-checks - Check permissions
 */

import { PermissionRoleController } from 'server/src/lib/api/controllers/PermissionRoleController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new PermissionRoleController();
    return await controller.checkUserPermissions()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Permission Checks API Route
 * POST /api/v1/permission-checks - Check permissions
 */

import { ApiPermissionController } from '@/lib/api/controllers/ApiPermissionController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiPermissionController();

export async function POST(request: Request) {
  try {
    return await controller.checkUserPermissions()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
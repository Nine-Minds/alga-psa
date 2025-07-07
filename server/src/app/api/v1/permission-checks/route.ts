/**
 * Permission Checks API Route
 * POST /api/v1/permission-checks - Check permissions
 */

import { ApiPermissionControllerV2 } from '@/lib/api/controllers/ApiPermissionControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiPermissionControllerV2();

export async function POST(request: Request) {
  try {
    return await controller.checkUserPermissions()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
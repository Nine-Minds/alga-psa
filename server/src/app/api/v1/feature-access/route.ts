/**
 * Feature Access API Route
 * POST /api/v1/feature-access - Check feature access
 */

import { PermissionRoleController } from 'server/src/lib/api/controllers/PermissionRoleController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new PermissionRoleController();

export async function POST(request: Request) {
  try {
    return await controller.checkFeatureAccess()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
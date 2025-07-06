/**
 * RBAC Analytics API Route
 * GET /api/v1/rbac/analytics - Get RBAC analytics
 */

// TODO: Implement RBAC analytics in ApiRoleControllerV2 or ApiPermissionControllerV2
// The correct method should be getAccessControlMetrics() not list()
// For now, continue using PermissionRoleController
import { PermissionRoleController } from 'server/src/lib/api/controllers/PermissionRoleController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new PermissionRoleController();
    // Note: This should call getAccessControlMetrics(), not list()
    return await controller.getAccessControlMetrics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * RBAC Audit API Route
 * GET /api/v1/rbac/audit - Get RBAC audit logs
 */

// TODO: Implement RBAC audit log functionality in a dedicated audit controller
// Currently there's no specific audit method in PermissionRoleController
// This endpoint needs proper implementation
// For now, continue using PermissionRoleController but this is a placeholder
import { PermissionRoleController } from 'server/src/lib/api/controllers/PermissionRoleController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new PermissionRoleController();
    // TODO: This needs a proper audit log method implementation
    // list() is not the correct method for audit logs
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
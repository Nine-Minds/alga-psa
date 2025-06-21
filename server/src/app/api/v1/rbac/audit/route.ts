/**
 * RBAC Audit API Route
 * GET /api/v1/rbac/audit - Get RBAC audit logs
 */

import { PermissionRoleController } from 'server/src/lib/api/controllers/PermissionRoleController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new PermissionRoleController();

export async function GET(request: Request) {
  try {
    return await controller.getAuditLogs()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
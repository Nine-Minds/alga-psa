/**
 * Roles Bulk Operations API Route
 * POST /api/v1/roles/bulk - Bulk create roles
 * PUT /api/v1/roles/bulk - Bulk update roles
 * DELETE /api/v1/roles/bulk - Bulk delete roles
 */

import { PermissionRoleController } from 'server/src/lib/api/controllers/PermissionRoleController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new PermissionRoleController();

export async function POST(request: Request) {
  try {
    return await controller.bulkCreateRoles()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.bulkUpdateRoles()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.bulkDeleteRoles()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
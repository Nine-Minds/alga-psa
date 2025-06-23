/**
 * User Roles API Route
 * GET /api/v1/user-roles - List users with roles
 * POST /api/v1/user-roles - Assign roles to user
 * DELETE /api/v1/user-roles - Remove roles from user
 * PUT /api/v1/user-roles - Replace user roles
 */

import { PermissionRoleController } from 'server/src/lib/api/controllers/PermissionRoleController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new PermissionRoleController();
    return await controller.list()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new PermissionRoleController();
    return await controller.assignRolesToUser()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new PermissionRoleController();
    return await controller.removeRolesFromUser()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new PermissionRoleController();
    return await controller.replaceUserRoles()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
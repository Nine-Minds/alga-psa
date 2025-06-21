/**
 * Role Permissions API Route
 * GET /api/v1/roles/[id]/permissions - Get role permissions
 * POST /api/v1/roles/[id]/permissions - Assign permissions to role
 * DELETE /api/v1/roles/[id]/permissions - Remove permissions from role
 * PUT /api/v1/roles/[id]/permissions - Replace role permissions
 */

import { PermissionRoleController } from 'server/src/lib/api/controllers/PermissionRoleController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new PermissionRoleController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getRolePermissions()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.assignPermissionsToRole()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.removePermissionsFromRole()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.replaceRolePermissions()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
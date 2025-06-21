/**
 * User Roles API Route
 * GET /api/v1/users/[id]/roles - Get user roles
 * PUT /api/v1/users/[id]/roles - Assign roles to user
 * DELETE /api/v1/users/[id]/roles - Remove roles from user
 */

import { UserController } from 'server/src/lib/api/controllers/UserController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new UserController();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.getUserRoles()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.assignUserRoles()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const req = request as any;
    req.params = params;
    return await controller.removeUserRoles()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
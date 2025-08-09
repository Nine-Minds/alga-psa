/**
 * User Roles API Route
 * GET /api/v1/users/{id}/roles - Get roles for a specific user
 * POST /api/v1/users/{id}/roles - Assign roles to a user
 * DELETE /api/v1/users/{id}/roles - Remove roles from a user
 * PUT /api/v1/users/{id}/roles - Replace all roles for a user
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiUserController();

export async function GET(request: Request) {
  try {
    return await controller.getRoles()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.assignRoles()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.removeRoles()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.replaceRoles()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
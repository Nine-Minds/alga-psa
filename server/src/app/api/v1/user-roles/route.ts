/**
 * User Roles API Route
 * GET /api/v1/user-roles - List users with roles
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiUserControllerV2();

export async function GET(request: Request) {
  try {
    return await controller.listUsersWithRoles()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
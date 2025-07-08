/**
 * RBAC Analytics API Route
 * GET /api/v1/rbac/analytics - Get RBAC analytics
 */

import { ApiRoleController } from '@/lib/api/controllers/ApiRoleController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiRoleController();

export async function GET(request: Request) {
  try {
    return await controller.getAccessControlMetrics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
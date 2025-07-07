/**
 * RBAC Analytics API Route
 * GET /api/v1/rbac/analytics - Get RBAC analytics
 */

import { ApiRoleControllerV2 } from '@/lib/api/controllers/ApiRoleControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

const controller = new ApiRoleControllerV2();

export async function GET(request: Request) {
  try {
    return await controller.getAccessControlMetrics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
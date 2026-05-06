/**
 * [scheduleId] API Routes
 * Path: /api/v1/assets/maintenance/[scheduleId]
 */

import { ApiAssetController } from '@/lib/api/controllers/ApiAssetController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiAssetController();

export const PUT = withApiKeyRouteAuth(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.updateMaintenanceSchedule(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
});

export const DELETE = withApiKeyRouteAuth(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.deleteMaintenanceSchedule(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

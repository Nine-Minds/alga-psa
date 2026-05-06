/**
 * maintenance API Routes
 * Path: /api/v1/assets/[id]/maintenance
 */

import { ApiAssetController } from '@/lib/api/controllers/ApiAssetController';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiAssetController();

export const GET = withApiKeyRouteAuth<{ id: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.listMaintenanceSchedules(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
});

export const POST = withApiKeyRouteAuth<{ id: string }>(async (request, { params }) => {
  try {
    const resolvedParams = await params;
    const req = request as any;
    req.params = resolvedParams;
    return await controller.createMaintenanceSchedule(req, resolvedParams);
  } catch (error) {
    return handleApiError(error);
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

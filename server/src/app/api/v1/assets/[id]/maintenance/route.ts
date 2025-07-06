/**
 * Asset Maintenance API Routes
 * GET /api/v1/assets/{id}/maintenance - List maintenance schedules
 * POST /api/v1/assets/{id}/maintenance - Create maintenance schedule
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.listMaintenanceSchedules(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.createMaintenanceSchedule(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Asset Maintenance Schedule Detail API Routes
 * PUT /api/v1/assets/maintenance/{scheduleId} - Update maintenance schedule
 * DELETE /api/v1/assets/maintenance/{scheduleId} - Delete maintenance schedule
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

export async function PUT(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.updateMaintenanceSchedule(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.deleteMaintenanceSchedule(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
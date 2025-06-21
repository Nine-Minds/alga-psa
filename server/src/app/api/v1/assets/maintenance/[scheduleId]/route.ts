/**
 * Asset Maintenance Schedule Detail API Routes
 * PUT /api/v1/assets/maintenance/{scheduleId} - Update maintenance schedule
 * DELETE /api/v1/assets/maintenance/{scheduleId} - Delete maintenance schedule
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AssetController();

export async function PUT(request: Request) {
  try {
    return await controller.updateMaintenanceSchedule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.deleteMaintenanceSchedule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
/**
 * Asset Maintenance API Routes
 * GET /api/v1/assets/{id}/maintenance - List maintenance schedules
 * POST /api/v1/assets/{id}/maintenance - Create maintenance schedule
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AssetController();

export async function GET(request: Request) {
  try {
    return await controller.listMaintenanceSchedules()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createMaintenanceSchedule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
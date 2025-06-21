/**
 * Asset Maintenance History API Route
 * GET /api/v1/assets/{id}/history - Get maintenance history
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AssetController();

export async function GET(request: Request) {
  try {
    return await controller.getMaintenanceHistory()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
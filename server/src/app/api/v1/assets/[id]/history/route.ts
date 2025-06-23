/**
 * Asset Maintenance History API Route
 * GET /api/v1/assets/{id}/history - Get maintenance history
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new AssetController();
    return await controller.getMaintenanceHistory()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
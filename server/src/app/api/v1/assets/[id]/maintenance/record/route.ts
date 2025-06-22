/**
 * Asset Maintenance Record API Route
 * POST /api/v1/assets/{id}/maintenance/record - Record maintenance performed
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AssetController();

export async function POST(request: Request) {
  try {
    return await controller.recordMaintenance()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
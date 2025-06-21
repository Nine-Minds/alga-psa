/**
 * Asset Bulk Update API Route
 * PUT /api/v1/assets/bulk-update - Bulk update assets
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AssetController();

export async function PUT(request: Request) {
  try {
    return await controller.bulkUpdate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
/**
 * Asset Bulk Status Update API Route
 * PUT /api/v1/assets/bulk-status - Bulk update asset status
 */

import { AssetController } from 'server/src/lib/api/controllers/AssetController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function PUT(request: Request) {
  try {
    const controller = new AssetController();
    return await controller.bulkStatusUpdate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
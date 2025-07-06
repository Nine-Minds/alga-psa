/**
 * Asset Bulk Status Update API Route
 * PUT /api/v1/assets/bulk-status - Bulk update asset status
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

export async function PUT(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.bulkStatusUpdate(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
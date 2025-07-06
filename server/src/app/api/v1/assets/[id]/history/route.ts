/**
 * Asset Maintenance History API Route
 * GET /api/v1/assets/{id}/history - Get maintenance history
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.getMaintenanceHistory(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
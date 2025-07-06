/**
 * Asset Maintenance Record API Route
 * POST /api/v1/assets/{id}/maintenance/record - Record maintenance performed
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.recordMaintenance(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
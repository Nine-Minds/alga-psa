/**
 * Asset Detail API Routes
 * GET /api/v1/assets/{id} - Get asset details
 * PUT /api/v1/assets/{id} - Update asset
 * DELETE /api/v1/assets/{id} - Delete asset
 */

import { ApiAssetControllerV2 } from '@/lib/api/controllers/ApiAssetControllerV2';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.getById(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.update(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new ApiAssetControllerV2();
    return await controller.delete(request as any, (request as any).params);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';